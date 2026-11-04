// La deuda VENCIDA de cada unidad: la cifra de «Morosidad» y la del recordatorio a los morosos salen de aquí, así nunca difieren.
import { Prisma } from '@prisma/client';
import { diasEntre } from '../../lib/fechas';
import type { Reloj } from '../../lib/zonas';

/** Lo que se lee de cada cargo vencido para calcular la deuda (con los abonos ya validados). */
export const SELECT_DEUDA = {
  unidad_id: true,
  monto: true,
  pagos: { where: { estado_validacion: 'validado' }, select: { monto: true } },
  reciboConcepto: { select: { recibo: { select: { id: true, mes: true, anio: true, fecha_vencimiento: true, complejo: { select: { zona_horaria: true } } } } } },
} satisfies Prisma.ReciboConceptoUnidadSelect;

export type CargoDeuda = Prisma.ReciboConceptoUnidadGetPayload<{ select: typeof SELECT_DEUDA }>;

export interface DeudaUnidad {
  deuda: Prisma.Decimal;
  cargos: number;
  maxDias: number;
  /** Sus mantenimientos vencidos, uno por recibo. */
  recibos: Map<number, { mes: number; anio: number; deuda: Prisma.Decimal; dias: number }>;
}

/**
 * Por unidad, además del total, sus mantenimientos vencidos (uno por recibo). La deuda es lo que falta del cargo: un abono parcial ya validado se
 * descuenta (así cuadra con el estado de cuenta y «Mi historial»); un cargo saldado no cuenta. Cada recibo cuenta sus días con el «hoy» de su condominio.
 */
export function acumularDeuda(cargos: CargoDeuda[], reloj: Reloj): Map<number, DeudaUnidad> {
  const porUnidad = new Map<number, DeudaUnidad>();
  for (const c of cargos) {
    const venc = c.reciboConcepto?.recibo?.fecha_vencimiento;
    const hoy = reloj.hoy(c.reciboConcepto?.recibo?.complejo?.zona_horaria);
    const abonado = c.pagos.reduce((s, p) => s.plus(p.monto), new Prisma.Decimal(0));
    const debe = Prisma.Decimal.max(new Prisma.Decimal(0), new Prisma.Decimal(c.monto).minus(abonado));
    if (debe.isZero()) continue;
    const acc = porUnidad.get(c.unidad_id!) ?? { deuda: new Prisma.Decimal(0), cargos: 0, maxDias: 0, recibos: new Map() };
    acc.deuda = acc.deuda.plus(debe);
    acc.cargos += 1;
    const dias = venc ? diasEntre(venc, hoy) : 0;
    if (venc) acc.maxDias = Math.max(acc.maxDias, dias);
    const r = c.reciboConcepto?.recibo;
    if (r) {
      const m = acc.recibos.get(r.id) ?? { mes: r.mes, anio: r.anio, deuda: new Prisma.Decimal(0), dias };
      m.deuda = m.deuda.plus(debe);
      acc.recibos.set(r.id, m);
    }
    porUnidad.set(c.unidad_id!, acc);
  }
  return porUnidad;
}
