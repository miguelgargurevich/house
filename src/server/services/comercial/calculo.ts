// Dinero de la suscripción. Todo con Decimal (nunca `number` para sumar dinero) y el impuesto (IGV, IVA…) se aplica UNA sola vez, sobre la base del total.
// Se redondea a los decimales de la moneda (2 en soles; 0 en pesos chilenos).
import { Prisma } from '@prisma/client';
import { MONEDA_POR_DEFECTO, decimalesDe } from '../../../lib/paises';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
/** Valores que Decimal acepta (texto, número u otro Decimal). */
type Valor = string | number | Prisma.Decimal;

export const redondear = (d: Valor, decimales = 2): Dec => new D(d).toDecimalPlaces(decimales, D.ROUND_HALF_UP);
export const dec = (v: Valor | null | undefined): Dec => new D(v ?? 0);

/** Precio que ve el público: base × (1 + tasa), con los decimales de la moneda. Si el plan ya guarda el precio con impuesto, es ese. */
export function precioConIgv(precio: Valor, tasa: Valor, igvIncluido = false, decimales = 2): Dec {
  return igvIncluido ? redondear(precio, decimales) : redondear(new D(precio).times(new D(1).plus(tasa)), decimales);
}

/** Precio sin impuesto: el que se publica (el impuesto se suma al pagar). Si el plan guarda el precio con impuesto, se le quita. */
export function precioSinIgv(precio: Valor, tasa: Valor, igvIncluido = false, decimales = 2): Dec {
  return igvIncluido ? redondear(new D(precio).div(new D(1).plus(tasa)), decimales) : redondear(precio, decimales);
}

export interface PrecioPlan { clave: string; precio_por_unidad: Valor; igv_incluido: boolean; modulos_incluidos: string[]; /** Se cobra como mínimo este número de unidades por condominio. */ unidades_minimas?: number | null }
export interface PrecioModulo { clave: string; precio_por_unidad: Valor }

export interface LineaCotizacion { concepto: string; clave: string; unidades: number; precio_unidad_base: string; base: string }
export interface Cotizacion {
  /** Moneda (ISO 4217) en que están todos los montos. */
  moneda: string;
  /** «IGV», «IVA»…: cómo se llama el impuesto de `igv` y `igv_tasa` en el país del condominio. */
  impuesto_nombre: string;
  unidades: number;
  /** Unidades que se cobran del plan: `max(unidades, mínimo del plan)`. Sin mínimo, las mismas `unidades`. */
  unidades_cobradas: number;
  /** El condominio tiene menos unidades que el mínimo del plan, así que se cobra el mínimo. */
  minimo_aplicado: boolean;
  base: string;
  /** El impuesto (IGV, IVA…) en dinero. */
  igv: string;
  /** Lo que se paga al mes (base + impuesto). */
  total_mes: string;
  total_anio: string;
  /** Tasa del impuesto en fracción (0.18 = 18 %). */
  igv_tasa: string;
  lineas: LineaCotizacion[];
}

/**
 * Cuánto cuesta un condominio al mes: max(`unidades`, mínimo del plan) × precio del plan, más `unidades` × el precio de cada módulo suelto que el
 * plan no trae (sólo suscripciones antiguas: los módulos ya no se venden sueltos; el mínimo es del plan, no de esos módulos).
 * Se suma la BASE exacta de todas las líneas y sólo al final se aplica el impuesto (no se suman precios ya redondeados). `moneda` fija los decimales
 * con que se redondea (soles por defecto); `plan.precio_por_unidad` ya viene en esa moneda.
 */
export function cotizar(p: { unidades: number; plan: PrecioPlan | null; modulosSueltos: string[]; catalogo: PrecioModulo[]; tasa: Valor; moneda?: string; impuestoNombre?: string }): Cotizacion {
  const tasa = new D(p.tasa);
  const moneda = p.moneda ?? MONEDA_POR_DEFECTO;
  const dm = decimalesDe(moneda);
  const unidades = Math.max(0, Math.trunc(p.unidades));
  const lineas: LineaCotizacion[] = [];
  let baseExacta = new D(0);
  let cobradas = unidades;
  const sumar = (concepto: string, clave: string, baseUnidad: Dec, n = unidades) => {
    const base = baseUnidad.times(n);
    baseExacta = baseExacta.plus(base);
    lineas.push({ concepto, clave, unidades: n, precio_unidad_base: baseUnidad.toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(dm), base: base.toFixed(dm) });
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
  const total = redondear(baseExacta.times(new D(1).plus(tasa)), dm);
  const igv = redondear(baseExacta.times(tasa), dm);
  const base = total.minus(igv);
  return { moneda, impuesto_nombre: p.impuestoNombre ?? 'IGV', unidades, unidades_cobradas: cobradas, minimo_aplicado: cobradas > unidades, base: base.toFixed(dm), igv: igv.toFixed(dm), total_mes: total.toFixed(dm), total_anio: total.times(12).toFixed(dm), igv_tasa: tasa.toString(), lineas };
}

/** Parte un monto pagado (con impuesto) en base + impuesto con la tasa vigente, a los decimales de su moneda. */
export function desglosarMonto(monto: Valor, tasa: Valor, moneda: string = MONEDA_POR_DEFECTO): { base: Dec; igv: Dec; total: Dec } {
  const dm = decimalesDe(moneda);
  const total = redondear(monto, dm);
  const base = redondear(total.div(new D(1).plus(tasa)), dm);
  return { base, igv: total.minus(base), total };
}
