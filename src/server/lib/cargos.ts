import { Prisma } from '@prisma/client';
import { MONEDA_POR_DEFECTO, ZONA_POR_DEFECTO } from '../../lib/paises';
import { hoyEn } from './fechas';
import { cargoSegunZona, type Reloj } from './zonas';
import { conVistaResidente, selectEvaluacion } from './evaluacionVista';

export type EstadoCargo = 'pagado' | 'pendiente' | 'vencido' | 'en_revision';

/** `hoy` es el día de HOY en la zona del condominio del recibo (`hoyEn(zona)`): vencido es desde el día siguiente al vencimiento, en SU hora. */
export function estadoCargo(estadoPago: string | null, fechaVencimiento: Date | null | undefined, hoy: Date): EstadoCargo {
  if (estadoPago === 'pagado') return 'pagado';
  if (estadoPago === 'en_revision') return 'en_revision'; // pagó y falta validar: no es moroso
  if (fechaVencimiento && fechaVencimiento < hoy) return 'vencido';
  return 'pendiente';
}

/** Cargos que aún no se pagaron ni están en revisión: son los únicos que pueden estar pendientes o vencidos. */
const abierto: Prisma.ReciboConceptoUnidadWhereInput = { OR: [{ estado_pago: null }, { estado_pago: { notIn: ['pagado', 'en_revision'] } }] };

/** «Por cobrar»: todo lo que no está pagado (incluye los cargos en revisión). */
export const noPagado: Prisma.ReciboConceptoUnidadWhereInput = { OR: [{ estado_pago: null }, { estado_pago: { not: 'pagado' } }] };

/** Filtro Prisma equivalente a `estadoCargo`: cada cargo se compara con el «hoy» de la zona de SU condominio (`reloj`, de `relojDeCondominios`). */
export function filtroEstadoCargo(estado: EstadoCargo, reloj: Reloj): Prisma.ReciboConceptoUnidadWhereInput {
  switch (estado) {
    case 'pagado':
      return { estado_pago: 'pagado' };
    case 'en_revision':
      return { estado_pago: 'en_revision' };
    case 'vencido':
      return { AND: [abierto, cargoSegunZona(reloj, (d) => ({ reciboConcepto: { recibo: { fecha_vencimiento: { lt: d.hoy } } } }))] };
    case 'pendiente':
      return { AND: [abierto, cargoSegunZona(reloj, (d) => ({ reciboConcepto: { recibo: { fecha_vencimiento: { gte: d.hoy } } } }))] };
  }
}

/** Metadatos del comprobante; `datos` (los bytes) jamás sale en una lista. */
export const selectComprobante = { id: true, nombre: true, tipo_mime: true, tamano: true, created_at: true } satisfies Prisma.ArchivoComprobanteSelect;

export const includeCargo = {
  unidad: { select: { id: true, codigo: true, estructura: { select: { id: true, nombre: true } } } },
  reciboConcepto: {
    select: {
      concepto: { select: { id: true, nombre: true } },
      recibo: { select: { id: true, mes: true, anio: true, descripcion: true, fecha_vencimiento: true, estructura: { select: { id: true, nombre: true } }, complejo: { select: { moneda: true, zona_horaria: true } } } },
    },
  },
  pagos: { orderBy: [{ fecha_pago: 'desc' }, { id: 'desc' }], include: { comprobante: { select: selectComprobante }, evaluacion: { select: { estado: true, veredicto: true } } } },
} satisfies Prisma.ReciboConceptoUnidadInclude;

type CargoConIncludes = Prisma.ReciboConceptoUnidadGetPayload<{ include: typeof includeCargo }>;

/** Aplana reciboConcepto → `concepto` y `recibo`, calcula `estado` (con el «hoy» de la zona del condominio) y pone `moneda` (la del condominio del recibo). */
export function formatearCargo(c: CargoConIncludes, ahora: Date = new Date()) {
  const { reciboConcepto, pagos, ...resto } = c;
  const { complejo, ...recibo } = reciboConcepto?.recibo ?? ({} as NonNullable<NonNullable<typeof reciboConcepto>['recibo']>);
  return {
    ...resto,
    pagos: pagos.map(conVistaResidente), // la evaluación de la IA sólo sale resumida: el detalle va en los pagos de la junta y el admin
    concepto: reciboConcepto?.concepto ? { nombre: reciboConcepto.concepto.nombre } : null,
    recibo: reciboConcepto?.recibo ? recibo : null,
    moneda: complejo?.moneda ?? MONEDA_POR_DEFECTO,
    estado: estadoCargo(c.estado_pago, reciboConcepto?.recibo?.fecha_vencimiento, hoyEn(complejo?.zona_horaria ?? ZONA_POR_DEFECTO, ahora)),
  };
}

export const decimalAString = (v: Prisma.Decimal | number | string | null | undefined): string => new Prisma.Decimal(v ?? 0).toFixed(2);

export const includePago = {
  usuario: { select: { id: true, nombre: true } },
  validado_por: { select: { id: true, nombre: true } },
  comprobante: { select: selectComprobante },
  evaluacion: { select: selectEvaluacion },
  reciboConceptoUnidad: {
    select: {
      id: true,
      unidad: { select: { id: true, codigo: true, estructura: { select: { id: true, nombre: true } }, complejo: { select: { id: true, nombre: true, moneda: true } } } },
      reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { id: true, mes: true, anio: true, estructura: { select: { id: true, nombre: true } } } } } },
    },
  },
} satisfies Prisma.PagoInclude;

type PagoConIncludes = Prisma.PagoGetPayload<{ include: typeof includePago }>;

/**
 * Aplana el cargo del pago en `unidad`, `concepto` y `recibo`. `vista` decide qué ve de la evaluación de la IA: por omisión
 * (residente) sólo un estado simple; `'completa'` es para quien valida (admin y junta) y trae alertas, extraído y comprobaciones.
 */
export function formatearPago(p: PagoConIncludes, vista: 'residente' | 'completa' = 'residente') {
  const { reciboConceptoUnidad: c, ...completo } = p;
  const resto = vista === 'completa' ? completo : conVistaResidente(completo);
  return {
    ...resto,
    unidad: c?.unidad ?? null,
    moneda: c?.unidad?.complejo?.moneda ?? MONEDA_POR_DEFECTO,
    concepto: c?.reciboConcepto?.concepto ?? null,
    recibo: c?.reciboConcepto?.recibo ?? null,
  };
}
