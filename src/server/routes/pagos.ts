import { Prisma } from '@prisma/client';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { conflict, invalid } from '../errors';
import { formatearPago, includePago } from '../lib/cargos';
import { scopeCargos, scopePagos, scopeUsuarios } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { fechaSchema, idSchema, montoSchema, textoOpcional, z } from '../validation';

export const METODOS_PAGO = ['transferencia', 'yape', 'plin', 'efectivo', 'tarjeta'] as const;

const base = z.object({
  recibo_concepto_unidad_id: idSchema,
  monto: montoSchema,
  fecha_pago: fechaSchema.optional(),
  usuario_id: idSchema.nullish(),
  metodo_pago: z.enum(METODOS_PAGO, { error: `metodo_pago debe ser: ${METODOS_PAGO.join(', ')}` }),
  referencia: textoOpcional(120),
  observaciones: textoOpcional(500),
});

/** Marca el cargo como pagado cuando lo abonado cubre su monto (y lo reabre si deja de cubrirlo). */
export async function sincronizarCargo(tx: Prisma.TransactionClient, cargoId: number) {
  const cargo = await tx.reciboConceptoUnidad.findUnique({ where: { id: cargoId }, select: { monto: true } });
  if (!cargo) return;
  const { _sum } = await tx.pago.aggregate({ where: { recibo_concepto_unidad_id: cargoId }, _sum: { monto: true } });
  const pagado = new Prisma.Decimal(_sum.monto ?? 0).gte(cargo.monto);
  await tx.reciboConceptoUnidad.update({
    where: { id: cargoId },
    data: pagado ? { estado_pago: 'pagado', fecha_pago: new Date() } : { estado_pago: 'pendiente', fecha_pago: null },
  });
}

async function validarRefs(d: Record<string, unknown>, user: AuthUser) {
  if (d.recibo_concepto_unidad_id != null) {
    const cargo = await assertRef(prisma.reciboConceptoUnidad, d.recibo_concepto_unidad_id as number, scopeCargos(user), 'recibo_concepto_unidad_id');
    if (d.monto != null) {
      const { _sum } = await prisma.pago.aggregate({ where: { recibo_concepto_unidad_id: cargo!.id as number }, _sum: { monto: true } });
      const saldo = new Prisma.Decimal(cargo!.monto as Prisma.Decimal).minus(_sum.monto ?? 0);
      if (saldo.lte(0)) throw conflict('Este cargo ya está pagado');
      if (new Prisma.Decimal(d.monto as string).gt(saldo)) {
        throw invalid(`Datos inválidos: monto: excede el saldo del cargo (S/ ${saldo.toFixed(2)})`, { monto: 'Excede el saldo del cargo' });
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
  scope: scopePagos,
  search: ['referencia', 'observaciones', 'reciboConceptoUnidad.unidad.codigo'],
  orderable: ['id', 'monto', 'fecha_pago', 'metodo_pago'],
  defaultOrder: { fecha_pago: 'desc' },
  include: includePago,
  format: (items) => items.map(formatearPago),
  filtros: {
    schema: z.object({ metodo_pago: z.enum(METODOS_PAGO).optional(), recibo_concepto_unidad_id: idSchema.optional() }),
    where: (f) => ({
      ...(f.metodo_pago ? { metodo_pago: f.metodo_pago } : {}),
      ...(f.recibo_concepto_unidad_id !== undefined ? { recibo_concepto_unidad_id: f.recibo_concepto_unidad_id } : {}),
    }),
  },
  createSchema: base,
  // El cargo de un pago no se reasigna; sólo se corrigen los datos del pago.
  updateSchema: z.object({ fecha_pago: fechaSchema.optional(), metodo_pago: base.shape.metodo_pago.optional(), referencia: textoOpcional(120), observaciones: textoOpcional(500) }),
  prepareCreate: validarRefs,
  async create(data) {
    const d = data as { recibo_concepto_unidad_id: number } & Record<string, unknown>;
    return prisma.$transaction(async (tx) => {
      const pago = await tx.pago.create({ data: d as Prisma.PagoUncheckedCreateInput });
      await sincronizarCargo(tx, d.recibo_concepto_unidad_id);
      return pago;
    });
  },
  // Al borrar un pago el cargo se reabre si deja de estar cubierto.
  async afterDelete(existing) {
    const cargoId = existing.recibo_concepto_unidad_id as number | null;
    if (cargoId != null) await prisma.$transaction((tx) => sincronizarCargo(tx, cargoId));
  },
});
