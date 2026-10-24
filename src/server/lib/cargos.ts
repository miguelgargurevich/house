import { Prisma } from '@prisma/client';
import { hoyLima } from './fechas';

export type EstadoCargo = 'pagado' | 'pendiente' | 'vencido' | 'en_revision';

export function estadoCargo(estadoPago: string | null, fechaVencimiento: Date | null | undefined, hoy = hoyLima()): EstadoCargo {
  if (estadoPago === 'pagado') return 'pagado';
  if (estadoPago === 'en_revision') return 'en_revision'; // pagó y falta validar: no es moroso
  if (fechaVencimiento && fechaVencimiento < hoy) return 'vencido';
  return 'pendiente';
}

/** Cargos que aún no se pagaron ni están en revisión: son los únicos que pueden estar pendientes o vencidos. */
const abierto: Prisma.ReciboConceptoUnidadWhereInput = { OR: [{ estado_pago: null }, { estado_pago: { notIn: ['pagado', 'en_revision'] } }] };

/** «Por cobrar»: todo lo que no está pagado (incluye los cargos en revisión). */
export const noPagado: Prisma.ReciboConceptoUnidadWhereInput = { OR: [{ estado_pago: null }, { estado_pago: { not: 'pagado' } }] };

/** Filtro Prisma equivalente a `estadoCargo`. */
export function filtroEstadoCargo(estado: EstadoCargo, hoy = hoyLima()): Prisma.ReciboConceptoUnidadWhereInput {
  switch (estado) {
    case 'pagado':
      return { estado_pago: 'pagado' };
    case 'en_revision':
      return { estado_pago: 'en_revision' };
    case 'vencido':
      return { AND: [abierto, { reciboConcepto: { recibo: { fecha_vencimiento: { lt: hoy } } } }] };
    case 'pendiente':
      return { AND: [abierto, { reciboConcepto: { recibo: { fecha_vencimiento: { gte: hoy } } } }] };
  }
}

/** Metadatos del comprobante; `datos` (los bytes) jamás sale en una lista. */
export const selectComprobante = { id: true, nombre: true, tipo_mime: true, tamano: true, created_at: true } satisfies Prisma.ArchivoComprobanteSelect;

export const includeCargo = {
  unidad: { select: { id: true, codigo: true } },
  reciboConcepto: {
    select: {
      concepto: { select: { id: true, nombre: true } },
      recibo: { select: { id: true, mes: true, anio: true, descripcion: true, fecha_vencimiento: true } },
    },
  },
  pagos: { orderBy: [{ fecha_pago: 'desc' }, { id: 'desc' }], include: { comprobante: { select: selectComprobante } } },
} satisfies Prisma.ReciboConceptoUnidadInclude;

type CargoConIncludes = Prisma.ReciboConceptoUnidadGetPayload<{ include: typeof includeCargo }>;

/** Aplana reciboConcepto → `concepto` y `recibo` y calcula `estado`. */
export function formatearCargo(c: CargoConIncludes) {
  const { reciboConcepto, ...resto } = c;
  return {
    ...resto,
    concepto: reciboConcepto?.concepto ? { nombre: reciboConcepto.concepto.nombre } : null,
    recibo: reciboConcepto?.recibo ?? null,
    estado: estadoCargo(c.estado_pago, reciboConcepto?.recibo?.fecha_vencimiento),
  };
}

export const decimalAString = (v: Prisma.Decimal | number | string | null | undefined): string => new Prisma.Decimal(v ?? 0).toFixed(2);

export const includePago = {
  usuario: { select: { id: true, nombre: true } },
  validado_por: { select: { id: true, nombre: true } },
  comprobante: { select: selectComprobante },
  reciboConceptoUnidad: {
    select: {
      id: true,
      unidad: { select: { id: true, codigo: true } },
      reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { id: true, mes: true, anio: true } } } },
    },
  },
} satisfies Prisma.PagoInclude;

type PagoConIncludes = Prisma.PagoGetPayload<{ include: typeof includePago }>;

/** Aplana el cargo del pago en `unidad`, `concepto` y `recibo`. */
export function formatearPago(p: PagoConIncludes) {
  const { reciboConceptoUnidad: c, ...resto } = p;
  return {
    ...resto,
    unidad: c?.unidad ?? null,
    concepto: c?.reciboConcepto?.concepto ?? null,
    recibo: c?.reciboConcepto?.recibo ?? null,
  };
}
