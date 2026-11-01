import type { Plan } from '../catalogo';

type Formato = (monto: string, moneda: string) => string;

/** «S/ X por departamento desde el N»: el tramo de un plan (del catálogo); `null` si el plan no lo tiene. Sin dependencias de la app: se prueba en Node. */
export const tramoTexto = (p: Plan, moneda: string, formato: Formato): string | null =>
  p.tramo_desde != null && p.tramo_precio != null ? `${formato(p.tramo_precio, moneda)} por departamento desde el ${p.tramo_desde}` : null;

/**
 * Lo que sigue al mínimo en soles de la tarjeta de un plan con tramo, siempre del catálogo: «; desde el departamento 61, S/ X cada uno».
 * Vacío si el plan no tiene tramo o no tiene precio en la moneda del país. Un tramo desde el 1 o antes no existe (igual que el servidor).
 */
export const tramoDeTarjeta = (p: Plan, moneda: string, formato: Formato): string =>
  p.tramo_desde != null && p.tramo_desde >= 2 && p.tramo_precio != null && p.precio_por_unidad !== null
    ? `; desde el departamento ${p.tramo_desde}, ${formato(p.tramo_precio, moneda)} cada uno`
    : '';

/** Una fila del desglose de la calculadora: los departamentos `desde`–`hasta` (incluidos) a `precio` cada uno, y su total `monto` (sin impuesto). */
export interface FilaDesglose { desde: number; hasta: number; unidades: number; precio: string; monto: string }
export interface Desglose {
  filas: FilaDesglose[];
  /** La suma de las filas es EXACTAMENTE el total del servidor (al centavo). Si no cuadra, la calculadora no muestra el desglose. */
  cuadra: boolean;
  /** Total sin impuesto ÷ departamentos reales, con los decimales de la moneda (redondeo a la mitad hacia arriba). */
  promedio: string;
}
export interface CuentaCotizacion {
  /** Departamentos reales del condominio (lo que escribió quien calcula). */
  unidades: number;
  /** Departamentos cobrados: los reales, o el mínimo del plan si son menos. */
  cobradas: number;
  /** Mínimo de departamentos del plan; null = sin mínimo. */
  minimo: number | null;
  /** Precio por departamento sin impuesto (catálogo, en la moneda del país). */
  precio: string;
  /** Tramo del plan en esa moneda (sin impuesto); null = precio único. */
  tramo_desde: number | null;
  tramo_precio: string | null;
  /** Total sin impuesto que dio el servidor (`total_mes`). */
  total: string;
  /** Decimales de la moneda (2 en soles, 0 en pesos chilenos). */
  decimales: number;
}

/** Monto en la unidad mínima de la moneda («60.00» con 2 decimales → 6000). Un monto con a lo sumo esos decimales se convierte sin error. */
const aMinimos = (monto: string, decimales: number): number => Math.round(Number(monto) * 10 ** decimales);
/** Vuelve de la unidad mínima a texto con los decimales de la moneda («6000» con 2 → «60.00»). */
const deMinimos = (m: number, decimales: number): string => {
  const s = String(Math.abs(m)).padStart(decimales + 1, '0');
  return decimales ? `${s.slice(0, -decimales)}.${s.slice(-decimales)}` : s;
};

/**
 * Cómo sale el total del servidor, departamento por departamento: todos cuestan el precio del plan y, desde el `tramo_desde`, cada uno cuesta
 * `tramo_precio`. Con menos departamentos que el mínimo se cobra el mínimo: una sola fila, «Monto mínimo del plan». Todo en enteros (unidad mínima
 * de la moneda): la suma es exacta. El servidor ya dio el total; aquí sólo se reparte y se comprueba que cuadre.
 */
export function desglosar(c: CuentaCotizacion): Desglose {
  const dm = c.decimales;
  const precio = aMinimos(c.precio, dm);
  // Igual que el servidor: un tramo desde el 1 o antes no existe (hace falta un primer tramo).
  const desde = c.tramo_desde != null && c.tramo_precio != null && c.tramo_desde >= 2 ? Math.trunc(c.tramo_desde) : null;
  const tramoPrecio = desde !== null ? aMinimos(c.tramo_precio as string, dm) : precio;
  const cobradas = Math.max(0, Math.trunc(c.cobradas));
  const minimo = Math.max(0, Math.trunc(c.minimo ?? 0));
  const total = aMinimos(c.total, dm);
  const n = Math.max(1, Math.trunc(c.unidades));
  if (cobradas < 1) return { filas: [], cuadra: false, promedio: deMinimos(0, dm) };
  // Un corte donde empieza el precio del tramo: sin tramo hay una sola fila.
  const inicios = desde !== null && desde <= cobradas ? [1, desde] : [1];
  let suma = 0;
  const filas: FilaDesglose[] = inicios.map((ini, i) => {
    const fin = i + 1 < inicios.length ? inicios[i + 1] - 1 : cobradas;
    const unidades = fin - ini + 1;
    const p = desde !== null && ini >= desde ? tramoPrecio : precio;
    const monto = unidades * p;
    suma += monto;
    return { desde: ini, hasta: fin, unidades, precio: deMinimos(p, dm), monto: deMinimos(monto, dm) };
  });
  const cuadra = suma === total;
  // Con menos que el mínimo se muestra UNA fila (el mínimo del plan); la comprobación de arriba ya se hizo sobre las filas reales.
  const mostradas = n < minimo ? [{ desde: 1, hasta: cobradas, unidades: cobradas, precio: deMinimos(precio, dm), monto: deMinimos(total, dm) }] : filas;
  return { filas: mostradas, cuadra, promedio: deMinimos(Math.floor((2 * total + n) / (2 * n)), dm) };
}

/**
 * Texto de una fila del desglose: «N departamentos × precio» (todos al mismo precio), «Departamentos 1 al 60 · 60 × precio» y «Departamentos 61 al N · k × precio»
 * (con tramo), «Departamento D · precio» si es uno solo, o «Monto mínimo del plan» si el condominio tiene menos departamentos que el mínimo.
 */
export function etiquetaDeFila(f: FilaDesglose, n: number, minimo: number, moneda: string, formato: Formato): string {
  if (n < minimo) return 'Monto mínimo del plan';
  const precio = formato(f.precio, moneda);
  if (f.desde === 1 && f.hasta === n) return `${n} ${n === 1 ? 'departamento' : 'departamentos'} × ${precio}`;
  return f.unidades === 1 ? `Departamento ${f.desde} · ${precio}` : `Departamentos ${f.desde} al ${f.hasta} · ${f.unidades} × ${precio}`;
}

/** La nota bajo el desglose cuando el condominio tiene menos departamentos que el mínimo del plan: «pagas el mínimo de S/ X al mes». `null` si no aplica. */
export const notaDelMinimo = (n: number, minimo: number, montoMinimo: string): string | null =>
  minimo > 0 && n < minimo ? `Tu condominio tiene ${n} ${n === 1 ? 'departamento' : 'departamentos'}: pagas el mínimo de ${montoMinimo} al mes.` : null;
