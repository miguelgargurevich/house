// Dinero de la suscripción. Todo con Decimal (nunca `number` para sumar soles) y el IGV se aplica UNA sola vez, sobre la base del total.
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
/** Valores que Decimal acepta (texto, número u otro Decimal). */
type Valor = string | number | Prisma.Decimal;

export const redondear = (d: Valor): Dec => new D(d).toDecimalPlaces(2, D.ROUND_HALF_UP);
export const dec = (v: Valor | null | undefined): Dec => new D(v ?? 0);

/** Precio que ve el público: base × (1 + tasa), 2 decimales. Si el plan ya guarda el precio con IGV, es ese. */
export function precioConIgv(precio: Valor, tasa: Valor, igvIncluido = false): Dec {
  return igvIncluido ? redondear(precio) : redondear(new D(precio).times(new D(1).plus(tasa)));
}

export interface PrecioPlan { clave: string; precio_por_unidad: Valor; igv_incluido: boolean; modulos_incluidos: string[]; /** Se cobra como mínimo este número de unidades por condominio. */ unidades_minimas?: number | null }
export interface PrecioModulo { clave: string; precio_por_unidad: Valor }

export interface LineaCotizacion { concepto: string; clave: string; unidades: number; precio_unidad_base: string; base: string }
export interface Cotizacion {
  unidades: number;
  /** Unidades que se cobran del plan: `max(unidades, mínimo del plan)`. Sin mínimo, las mismas `unidades`. */
  unidades_cobradas: number;
  /** El condominio tiene menos unidades que el mínimo del plan, así que se cobra el mínimo. */
  minimo_aplicado: boolean;
  base: string;
  igv: string;
  /** Lo que se paga al mes (base + IGV). */
  total_mes: string;
  total_anio: string;
  igv_tasa: string;
  lineas: LineaCotizacion[];
}

/**
 * Cuánto cuesta un condominio al mes: max(`unidades`, mínimo del plan) × precio del plan, más `unidades` × el precio de cada módulo suelto que el
 * plan no trae (sólo suscripciones antiguas: los módulos ya no se venden sueltos; el mínimo es del plan, no de esos módulos).
 * Se suma la BASE exacta de todas las líneas y sólo al final se aplica el IGV (no se suman precios ya redondeados).
 */
export function cotizar(p: { unidades: number; plan: PrecioPlan | null; modulosSueltos: string[]; catalogo: PrecioModulo[]; tasa: Valor }): Cotizacion {
  const tasa = new D(p.tasa);
  const unidades = Math.max(0, Math.trunc(p.unidades));
  const lineas: LineaCotizacion[] = [];
  let baseExacta = new D(0);
  let cobradas = unidades;
  const sumar = (concepto: string, clave: string, baseUnidad: Dec, n = unidades) => {
    const base = baseUnidad.times(n);
    baseExacta = baseExacta.plus(base);
    lineas.push({ concepto, clave, unidades: n, precio_unidad_base: baseUnidad.toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(2), base: base.toFixed(2) });
  };
  if (p.plan && dec(p.plan.precio_por_unidad).gt(0)) {
    const unidadBase = p.plan.igv_incluido ? dec(p.plan.precio_por_unidad).div(new D(1).plus(tasa)) : dec(p.plan.precio_por_unidad);
    const minimo = Math.max(0, Math.trunc(p.plan.unidades_minimas ?? 0));
    cobradas = Math.max(unidades, minimo);
    sumar(`Plan ${p.plan.clave}`, p.plan.clave, unidadBase, cobradas);
  }
  const incluidos = new Set(p.plan?.modulos_incluidos ?? []);
  for (const clave of new Set(p.modulosSueltos)) {
    if (incluidos.has(clave)) continue;
    const m = p.catalogo.find((x) => x.clave === clave);
    if (m) sumar(`Módulo ${clave}`, clave, dec(m.precio_por_unidad));
  }
  const total = redondear(baseExacta.times(new D(1).plus(tasa)));
  const igv = redondear(baseExacta.times(tasa));
  const base = total.minus(igv);
  return { unidades, unidades_cobradas: cobradas, minimo_aplicado: cobradas > unidades, base: base.toFixed(2), igv: igv.toFixed(2), total_mes: total.toFixed(2), total_anio: total.times(12).toFixed(2), igv_tasa: tasa.toString(), lineas };
}

/** Parte un monto pagado (con IGV) en base + IGV con la tasa vigente. */
export function desglosarMonto(monto: Valor, tasa: Valor): { base: Dec; igv: Dec; total: Dec } {
  const total = redondear(monto);
  const base = redondear(total.div(new D(1).plus(tasa)));
  return { base, igv: total.minus(base), total };
}
