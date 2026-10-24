/**
 * Pago del mantenimiento de un departamento (todos los cargos de un recibo + unidad con UN pago y UN comprobante).
 *
 * Modelo: el pago se reparte en un `Pago` por cargo con saldo (monto = saldo del cargo, calculado aquí), todos con el mismo
 * `Pago.grupo`. El primero es el `grupo_principal`: lleva el comprobante y la evaluación de la IA (que compara contra el
 * TOTAL del grupo). Validar o rechazar cualquiera actúa sobre el grupo entero (`validacionPago.cerrarPago`).
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, notFound } from '../errors';
import { selectComprobante } from '../lib/cargos';
import { hoyLima } from '../lib/fechas';
import { conVistaResidente, selectEvaluacion } from '../lib/evaluacionVista';
import { cuentaCargo, estadoMantenimiento, numeroMantenimiento, repartirSaldos, sumarCuentas, tituloMantenimiento, type CuentaMantenimiento, type EstadoMantenimiento } from '../lib/mantenimientos';
import { medioDeUnidades } from '../routes/mediosPago';

export interface DatosPago {
  metodo_pago: string;
  referencia?: string | null;
  observaciones?: string | null;
  fecha_pago?: Date;
}

export interface ResultadoPago {
  grupo: string;
  /** Id del pago principal: a él se sube el comprobante (`POST /api/pagos/:id/comprobante`). */
  pago_id: number;
  total: string;
  cargos: number;
}

/** Estados que un cargo ya no admite como «abierto» (para el cierre atómico). */
const cerrados = ['pagado', 'en_revision'];

/**
 * Paga el saldo completo del mantenimiento (recibo + unidad). `por_validar` (residente: espera la junta/admin) o `validado` (lo registra
 * la administración: queda pagado de inmediato). 404 si el mantenimiento no existe; 409 si no queda nada por pagar o alguien lo tomó antes.
 */
export async function pagarMantenimiento(o: { reciboId: number; unidadId: number; usuarioId: number | null; modo: 'residente' | 'administracion'; validadorId?: number } & DatosPago): Promise<ResultadoPago> {
  return prisma.$transaction(async (tx) => {
    const cargos = await tx.reciboConceptoUnidad.findMany({
      where: { unidad_id: o.unidadId, reciboConcepto: { recibo_id: o.reciboId } },
      select: { id: true, monto: true, estado_pago: true, reciboConcepto: { select: { orden: true } } },
      orderBy: [{ reciboConcepto: { orden: 'asc' } }, { id: 'asc' }],
    });
    if (cargos.length === 0) throw notFound('Mantenimiento');
    const sumas = await tx.pago.groupBy({ by: ['recibo_concepto_unidad_id', 'estado_validacion'], where: { recibo_concepto_unidad_id: { in: cargos.map((c) => c.id) } }, _sum: { monto: true } });
    const suma = (id: number, estado: string) => sumas.find((s) => s.recibo_concepto_unidad_id === id && s.estado_validacion === estado)?._sum.monto ?? 0;
    const reparto = repartirSaldos(cargos.map((c) => ({ id: c.id, monto: c.monto, estado_pago: c.estado_pago, validado: suma(c.id, 'validado'), por_validar: suma(c.id, 'por_validar') })));
    if (reparto.length === 0) {
      const enRevision = cargos.some((c) => c.estado_pago === 'en_revision');
      throw conflict(enRevision ? 'Este mantenimiento ya tiene un pago en revisión' : 'Este mantenimiento ya fue pagado');
    }
    // Cierre atómico: sólo uno de dos pagos simultáneos logra pasar los cargos de abiertos a su nuevo estado.
    const ids = reparto.map((r) => r.cargoId);
    const cerrado = await tx.reciboConceptoUnidad.updateMany({
      where: { id: { in: ids }, OR: [{ estado_pago: null }, { estado_pago: { notIn: cerrados } }] },
      data: o.modo === 'residente' ? { estado_pago: 'en_revision', fecha_pago: null } : { estado_pago: 'pagado', fecha_pago: o.fecha_pago ?? new Date() },
    });
    if (cerrado.count !== ids.length) throw conflict('Este mantenimiento cambió mientras lo pagabas: recarga e inténtalo de nuevo');

    const grupo = randomUUID();
    const validado = o.modo === 'administracion';
    let principal = 0;
    let total = new Prisma.Decimal(0);
    for (const [i, r] of reparto.entries()) {
      const p = await tx.pago.create({
        data: {
          recibo_concepto_unidad_id: r.cargoId,
          monto: r.monto,
          usuario_id: o.usuarioId,
          metodo_pago: o.metodo_pago,
          referencia: o.referencia ?? null,
          observaciones: o.observaciones ?? null,
          ...(o.fecha_pago ? { fecha_pago: o.fecha_pago } : {}),
          estado_validacion: validado ? 'validado' : 'por_validar',
          ...(validado ? { validado_por_id: o.validadorId ?? null, validado_at: new Date() } : {}),
          grupo,
          grupo_principal: i === 0,
        },
        select: { id: true },
      });
      if (i === 0) principal = p.id;
      total = total.plus(r.monto);
    }
    return { grupo, pago_id: principal, total: total.toFixed(2), cargos: reparto.length };
  });
}

// ---------- Detalle ----------
const includeDetalle = {
  cargos: {
    include: {
      reciboConcepto: { select: { orden: true, es_recargo: true, concepto: { select: { id: true, nombre: true } } } },
      pagos: { orderBy: [{ fecha_pago: 'desc' }, { id: 'asc' }] as Prisma.PagoOrderByWithRelationInput[], include: { comprobante: { select: selectComprobante }, evaluacion: { select: selectEvaluacion }, validado_por: { select: { id: true, nombre: true } }, usuario: { select: { id: true, nombre: true } } } },
    },
  },
} as const;

export interface DetalleMantenimiento {
  recibo_id: number;
  unidad_id: number;
  numero: string;
  titulo: string;
  mes: number;
  anio: number;
  fecha_emision: Date;
  fecha_vencimiento: Date;
  estado: EstadoMantenimiento;
  total: string;
  cobrado: string;
  en_revision: string;
  saldo: string;
  condominio: { id: number; nombre: string; direccion: string | null } | null;
  empresa: { id: number; nombre: string; ruc: string | null; direccion: string | null; telefono: string | null; email: string | null } | null;
  unidad: { id: number; codigo: string; estructura: { id: number; nombre: string | null } | null };
  propietario: { id: number; nombre: string } | null;
  inquilino: { id: number; nombre: string } | null;
  conceptos: { cargo_id: number; concepto: string; es_recargo: boolean; monto: string; cobrado: string; en_revision: string; saldo: string }[];
  pagos: PagoDeMantenimiento[];
  medios_pago: unknown[];
}

export interface PagoDeMantenimiento {
  /** Pago principal del grupo (o el pago suelto): con este id se ve el comprobante y se valida. */
  id: number;
  grupo: string | null;
  /** `true` = pago antiguo de un solo concepto (sin grupo). */
  suelto: boolean;
  monto: string;
  conceptos: string[];
  metodo_pago: string | null;
  referencia: string | null;
  fecha_pago: Date;
  estado_validacion: string;
  motivo_rechazo: string | null;
  validado_por_ia: boolean;
  registrado_por: { id: number; nombre: string } | null;
  comprobante: unknown;
  evaluacion: unknown;
}

/**
 * Detalle completo del mantenimiento (conceptos, pagos agrupados, medios de pago). El alcance lo verifica quien llama con `unidadWhere`
 * (las unidades propias del residente o `scopeUnidades` + recibo de la empresa del admin); si no coincide → 404.
 */
export async function detalleMantenimiento(reciboId: number, unidadId: number, o: { reciboWhere?: Prisma.ReciboWhereInput; unidadWhere?: Prisma.UnidadWhereInput; vista: 'residente' | 'completa' }): Promise<DetalleMantenimiento> {
  const [recibo, unidad] = await Promise.all([
    prisma.recibo.findFirst({ where: { AND: [{ id: reciboId }, o.reciboWhere ?? {}] }, include: { complejo: { select: { id: true, nombre: true, direccion: true } }, empresa: { select: { id: true, nombre: true, ruc: true, direccion: true, telefono: true, email: true } } } }),
    prisma.unidad.findFirst({ where: { AND: [{ id: unidadId }, o.unidadWhere ?? {}] }, include: { estructura: { select: { id: true, nombre: true } }, propietario: { select: { id: true, nombre: true } }, inquilino: { select: { id: true, nombre: true } } } }),
  ]);
  if (!recibo || !unidad) throw notFound('Mantenimiento');
  const conceptosDb = await prisma.reciboConcepto.findMany({ where: { recibo_id: reciboId }, select: { id: true } });
  if (conceptosDb.length === 0) throw notFound('Mantenimiento');
  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: { unidad_id: unidadId, recibo_concepto_id: { in: conceptosDb.map((c) => c.id) } },
    include: includeDetalle.cargos.include,
  });
  if (cargos.length === 0) throw notFound('Mantenimiento');
  cargos.sort((a, b) => (a.reciboConcepto?.orden ?? 0) - (b.reciboConcepto?.orden ?? 0) || a.id - b.id);

  const sumaPagos = (c: (typeof cargos)[number], estado: string) => c.pagos.filter((p) => p.estado_validacion === estado).reduce((a, p) => a.plus(p.monto), new Prisma.Decimal(0));
  const cuentas = cargos.map((c) => ({ monto: c.monto, estado_pago: c.estado_pago, validado: sumaPagos(c, 'validado'), por_validar: sumaPagos(c, 'por_validar') }));
  const resumen: CuentaMantenimiento = sumarCuentas(cuentas);

  // Pagos: uno por grupo (el principal lleva el comprobante); los pagos sueltos antiguos se muestran tal cual.
  const porGrupo = new Map<string, { principal?: (typeof cargos)[number]['pagos'][number]; monto: Prisma.Decimal; conceptos: string[]; alguno: (typeof cargos)[number]['pagos'][number] }>();
  const pagos: PagoDeMantenimiento[] = [];
  const dePago = (p: (typeof cargos)[number]['pagos'][number], monto: Prisma.Decimal, conceptos: string[], suelto: boolean): PagoDeMantenimiento => {
    const base = { ...p, evaluacion: p.evaluacion };
    const vista = o.vista === 'completa' ? base : conVistaResidente(base);
    return {
      id: p.id, grupo: p.grupo, suelto, monto: monto.toFixed(2), conceptos, metodo_pago: p.metodo_pago, referencia: p.referencia, fecha_pago: p.fecha_pago,
      estado_validacion: p.estado_validacion, motivo_rechazo: p.motivo_rechazo, validado_por_ia: p.validado_por_ia,
      registrado_por: p.usuario ?? null, comprobante: p.comprobante, evaluacion: vista.evaluacion,
    };
  };
  for (const c of cargos) {
    const nombre = c.reciboConcepto?.concepto?.nombre ?? 'Concepto';
    for (const p of c.pagos) {
      if (p.grupo == null) {
        pagos.push(dePago(p, p.monto, [nombre], true));
        continue;
      }
      const g = porGrupo.get(p.grupo) ?? { monto: new Prisma.Decimal(0), conceptos: [], alguno: p };
      g.monto = g.monto.plus(p.monto);
      g.conceptos.push(nombre);
      if (p.grupo_principal) g.principal = p;
      porGrupo.set(p.grupo, g);
    }
  }
  for (const g of porGrupo.values()) pagos.push(dePago(g.principal ?? g.alguno, g.monto, g.conceptos, false));
  pagos.sort((a, b) => b.fecha_pago.getTime() - a.fecha_pago.getTime() || b.id - a.id);

  const medios = unidad.complejo_id != null
    ? await prisma.medioPago.findMany({ where: { activo: true, ...medioDeUnidades([unidad]) }, orderBy: [{ orden: 'asc' }, { id: 'asc' }], omit: { qr_datos: true, creado_por_id: true, documento_titular: true } })
    : [];
  medios.sort((a, b) => Number(b.estructura_id != null) - Number(a.estructura_id != null));

  return {
    recibo_id: recibo.id,
    unidad_id: unidad.id,
    numero: numeroMantenimiento(recibo.anio, recibo.mes, unidad.codigo),
    titulo: tituloMantenimiento(recibo.anio, recibo.mes, unidad.codigo),
    mes: recibo.mes,
    anio: recibo.anio,
    fecha_emision: recibo.fecha_emision,
    fecha_vencimiento: recibo.fecha_vencimiento,
    estado: estadoMantenimiento(resumen, recibo.fecha_vencimiento, hoyLima()),
    ...resumen,
    condominio: recibo.complejo,
    empresa: recibo.empresa,
    unidad: { id: unidad.id, codigo: unidad.codigo, estructura: unidad.estructura },
    propietario: unidad.propietario,
    inquilino: unidad.inquilino,
    conceptos: cargos.map((c, i) => {
      const x = cuentaCargo(cuentas[i]);
      return { cargo_id: c.id, concepto: c.reciboConcepto?.concepto?.nombre ?? 'Concepto', es_recargo: c.reciboConcepto?.es_recargo ?? false, monto: x.total.toFixed(2), cobrado: x.cobrado.toFixed(2), en_revision: x.en_revision.toFixed(2), saldo: x.saldo.toFixed(2) };
    }),
    pagos,
    medios_pago: medios.map((m) => ({
      id: m.id, tipo: m.tipo, ambito: m.estructura_id != null ? 'block' : 'condominio', banco: m.banco, tipo_cuenta: m.tipo_cuenta,
      numero_cuenta: m.numero_cuenta, cci: m.cci, titular: m.titular, celular: m.celular, tiene_qr: m.qr_tipo_mime != null,
    })),
  };
}

// ---------- Pagos agrupados en listas ----------
/** A cada pago con `grupo` le agrega `mantenimiento` (total del grupo, cuántos conceptos, periodo y unidad). Los sueltos quedan igual. */
export async function conResumenDeGrupo<T extends { id: number; grupo: string | null; unidad?: { id: number; codigo: string } | null; recibo?: { id: number; mes: number; anio: number } | null }>(items: T[]) {
  const grupos = [...new Set(items.map((p) => p.grupo).filter((g): g is string => g != null))];
  const sumas = grupos.length ? await prisma.pago.groupBy({ by: ['grupo'], where: { grupo: { in: grupos } }, _sum: { monto: true }, _count: { _all: true } }) : [];
  const porGrupo = new Map(sumas.map((s) => [s.grupo, s]));
  return items.map((p) => {
    const g = p.grupo != null ? porGrupo.get(p.grupo) : undefined;
    if (!g || !p.unidad || !p.recibo) return { ...p, mantenimiento: null };
    return {
      ...p,
      mantenimiento: {
        grupo: p.grupo,
        titulo: tituloMantenimiento(p.recibo.anio, p.recibo.mes, p.unidad.codigo),
        numero: numeroMantenimiento(p.recibo.anio, p.recibo.mes, p.unidad.codigo),
        recibo_id: p.recibo.id,
        unidad_id: p.unidad.id,
        total: new Prisma.Decimal(g._sum.monto ?? 0).toFixed(2),
        conceptos: g._count._all,
      },
    };
  });
}

/** Sólo el pago principal de cada grupo (o los sueltos): una fila por pago del mantenimiento. */
export const soloPrincipales: Prisma.PagoWhereInput = { OR: [{ grupo: null }, { grupo_principal: true }] };
