import { Prisma } from '@prisma/client';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { conflict, invalid } from '../errors';
import { formatearPago, includePago } from '../lib/cargos';
import { formatoDinero } from '../../lib/paises';
import { conTesoreroRegistrado } from '../lib/conformidad';
import { esJunta } from '../lib/junta';
import { conResumenDeGrupo, soloPrincipales } from '../services/mantenimiento';
import { conAvisoMulta } from '../services/revisionMora';
import { scopeCargosEscritura, scopePagos, scopePagosEscritura, scopePagosJunta, scopeUsuarios } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { fechaSchema, idSchema, montoSchema, textoOpcional, z } from '../validation';
import { complejoDeCargo, exigirOperativo } from '../services/comercial/operativo';

export const METODOS_PAGO = ['transferencia', 'yape', 'plin', 'efectivo', 'tarjeta'] as const;
export const ESTADOS_VALIDACION = ['por_validar', 'validado', 'rechazado'] as const;

const base = z.object({
  recibo_concepto_unidad_id: idSchema,
  monto: montoSchema,
  fecha_pago: fechaSchema.optional(),
  usuario_id: idSchema.nullish(),
  metodo_pago: z.enum(METODOS_PAGO, { error: `metodo_pago debe ser: ${METODOS_PAGO.join(', ')}` }),
  referencia: textoOpcional(120),
  observaciones: textoOpcional(500),
});

/**
 * Deja el cargo según sus pagos: pagado si lo VALIDADO lo cubre, en revisión si hay un pago por validar,
 * pendiente en otro caso. Un pago rechazado no cuenta.
 */
export async function sincronizarCargo(tx: Prisma.TransactionClient, cargoId: number) {
  const cargo = await tx.reciboConceptoUnidad.findUnique({ where: { id: cargoId }, select: { monto: true } });
  if (!cargo) return;
  const { _sum } = await tx.pago.aggregate({ where: { recibo_concepto_unidad_id: cargoId, estado_validacion: 'validado' }, _sum: { monto: true } });
  const pagado = new Prisma.Decimal(_sum.monto ?? 0).gte(cargo.monto);
  const porValidar = !pagado && (await tx.pago.count({ where: { recibo_concepto_unidad_id: cargoId, estado_validacion: 'por_validar' } })) > 0;
  await tx.reciboConceptoUnidad.update({
    where: { id: cargoId },
    data: pagado ? { estado_pago: 'pagado', fecha_pago: new Date() } : { estado_pago: porValidar ? 'en_revision' : 'pendiente', fecha_pago: null },
  });
}

async function validarRefs(d: Record<string, unknown>, user: AuthUser) {
  if (d.recibo_concepto_unidad_id != null) {
    const cargo = await assertRef(prisma.reciboConceptoUnidad, d.recibo_concepto_unidad_id as number, scopeCargosEscritura(user), 'recibo_concepto_unidad_id');
    if (d.monto != null) {
      const moneda = (await prisma.reciboConceptoUnidad.findUnique({ where: { id: cargo!.id as number }, select: { reciboConcepto: { select: { recibo: { select: { complejo: { select: { moneda: true } } } } } } } }))?.reciboConcepto?.recibo?.complejo?.moneda;
      // Un pago por validar ya reclama su monto; uno rechazado no.
      const { _sum } = await prisma.pago.aggregate({ where: { recibo_concepto_unidad_id: cargo!.id as number, estado_validacion: { not: 'rechazado' } }, _sum: { monto: true } });
      const saldo = new Prisma.Decimal(cargo!.monto as Prisma.Decimal).minus(_sum.monto ?? 0);
      if (saldo.lte(0)) throw conflict(cargo!.estado_pago === 'en_revision' ? 'Este cargo tiene un pago en revisión: valídalo o recházalo primero' : 'Este cargo ya está pagado');
      if (new Prisma.Decimal(d.monto as string).gt(saldo)) {
        throw invalid(`Datos inválidos: monto: excede el saldo del cargo (${formatoDinero(saldo, moneda)})`, { monto: 'Excede el saldo del cargo' });
      }
    }
  }
  if (d.usuario_id != null) await assertRef(prisma.usuario, d.usuario_id as number, scopeUsuarios(user), 'usuario_id');
  return d;
}

export const pagosRouter = crudRouter({
  entidad: 'pago',
  delegate: prisma.pago,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  // La junta (presidente/tesorero) sólo LEE los pagos de su ámbito; registrar, editar y borrar siguen siendo del admin.
  readAlso: esJunta,
  scope: (u) => (u.rol === 'propietario' ? scopePagosJunta(u) : scopePagos(u)),
  writeScope: (u) => (u.rol === 'propietario' ? scopePagosJunta(u) : scopePagosEscritura(u)),
  search: ['referencia', 'observaciones', 'reciboConceptoUnidad.unidad.codigo'],
  orderable: ['id', 'monto', 'fecha_pago', 'metodo_pago'],
  defaultOrder: { fecha_pago: 'desc' },
  include: includePago,
  // Una fila por pago del mantenimiento (el principal de cada grupo); los pagos sueltos antiguos salen como siempre.
  // los lee el admin o la junta: ven la evaluación completa y la conformidad del tesorero (`conformidad`, más `tesorero_registrado`: ¿el block tiene tesorero que pueda darla?)
  // `aviso_multa`: «según el voucher pagó a tiempo; tiene la multa de …» (sólo para quien administra o la junta; el residente nunca lo ve).
  format: async (items) => conAvisoMulta(await conTesoreroRegistrado(await conResumenDeGrupo(items.map((p) => formatearPago(p, 'completa'))))),
  filtros: {
    schema: z.object({ metodo_pago: z.enum(METODOS_PAGO).optional(), recibo_concepto_unidad_id: idSchema.optional(), estado_validacion: z.enum(ESTADOS_VALIDACION).optional(), estructura_id: idSchema.optional(), complejo_id: idSchema.optional(), conformidad: z.enum(['con', 'sin'], { error: 'conformidad debe ser con o sin' }).optional() }),
    where: (f) => ({
      ...soloPrincipales,
      ...(f.metodo_pago ? { metodo_pago: f.metodo_pago } : {}),
      ...(f.estado_validacion ? { estado_validacion: f.estado_validacion } : {}),
      ...(f.conformidad ? { conformidad_at: f.conformidad === 'con' ? { not: null } : null } : {}),
      ...(f.recibo_concepto_unidad_id !== undefined ? { recibo_concepto_unidad_id: f.recibo_concepto_unidad_id } : {}),
      // Torre y condominio son de la unidad del cargo pagado.
      ...(f.estructura_id !== undefined || f.complejo_id !== undefined ? { reciboConceptoUnidad: { unidad: { ...(f.estructura_id !== undefined ? { estructura_id: f.estructura_id } : {}), ...(f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}) } } } : {}),
    }),
  },
  createSchema: base,
  // El cargo de un pago no se reasigna; sólo se corrigen los datos del pago.
  updateSchema: z.object({ fecha_pago: fechaSchema.optional(), metodo_pago: base.shape.metodo_pago.optional(), referencia: textoOpcional(120), observaciones: textoOpcional(500) }),
  operativo: async (r, u) => exigirOperativo(await complejoDeCargo(r.recibo_concepto_unidad_id as number | null), u),
  prepareCreate: validarRefs,
  async create(data, user) {
    const d = data as { recibo_concepto_unidad_id: number } & Record<string, unknown>;
    return prisma.$transaction(async (tx) => {
      // Lo registra un administrador: queda validado de inmediato.
      const pago = await tx.pago.create({ data: { ...d, estado_validacion: 'validado', validado_por_id: user.id, validado_at: new Date() } as Prisma.PagoUncheckedCreateInput });
      await sincronizarCargo(tx, d.recibo_concepto_unidad_id);
      return pago;
    });
  },
  // Corregir los datos de un pago del mantenimiento los corrige en todo el grupo.
  async afterUpdate(existing, d) {
    const grupo = existing.grupo as string | null;
    if (grupo) await prisma.pago.updateMany({ where: { grupo }, data: d as Prisma.PagoUpdateManyMutationInput });
    // Quien corrige la fecha a mano manda sobre la que leyó la IA del voucher: ninguna evaluación posterior la pisa (`services/fechaVoucher.ts`).
    if (d.fecha_pago !== undefined) await prisma.pago.updateMany({ where: grupo ? { grupo } : { id: existing.id as number }, data: { fecha_origen: 'manual', fecha_declarada: null } });
  },
  // Al borrar un pago el cargo se reabre si deja de estar cubierto; borrar el de un mantenimiento borra todo el grupo.
  async afterDelete(existing) {
    const cargos = new Set<number>();
    if (existing.recibo_concepto_unidad_id != null) cargos.add(existing.recibo_concepto_unidad_id as number);
    const grupo = existing.grupo as string | null;
    if (grupo) {
      const resto = await prisma.pago.findMany({ where: { grupo }, select: { id: true, recibo_concepto_unidad_id: true } });
      await prisma.pago.deleteMany({ where: { id: { in: resto.map((x) => x.id) } } });
      for (const x of resto) if (x.recibo_concepto_unidad_id != null) cargos.add(x.recibo_concepto_unidad_id);
    }
    if (cargos.size) await prisma.$transaction(async (tx) => { for (const id of cargos) await sincronizarCargo(tx, id); });
  },
});
