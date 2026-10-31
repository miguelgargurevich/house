import type { Plan } from '../catalogo';

type Formato = (monto: string, moneda: string) => string;

/** «S/ X por departamento desde el N»: el tramo de un plan (del catálogo); `null` si el plan no lo tiene. Sin dependencias de la app: se prueba en Node. */
export const tramoTexto = (p: Plan, moneda: string, formato: Formato): string | null =>
  p.tramo_desde != null && p.tramo_precio != null ? `${formato(p.tramo_precio, moneda)} por departamento desde el ${p.tramo_desde}` : null;

/**
 * Lo que sigue a «incluye hasta 20 departamentos» en la tarjeta de un plan con precio base, siempre del catálogo:
 * sin tramo, «; desde el 21, S/ X cada uno»; con tramo, «; del 21 al 60, S/ X cada uno; desde el 61, S/ Y».
 * Vacío si el plan no tiene mínimo o no tiene precio en la moneda del país.
 */
export const despuesDelPrecioBase = (p: Plan, moneda: string, formato: Formato): string => {
  if (p.unidades_minimas == null || p.precio_por_unidad === null) return '';
  const primero = p.unidades_minimas + 1;
  const normal = formato(p.precio_por_unidad, moneda);
  if (p.tramo_desde == null || p.tramo_precio == null) return `; desde el ${primero}, ${normal} cada uno`;
  const tramo = formato(p.tramo_precio, moneda);
  // Tramo pegado al precio base: no hay un rango «del 21 al 20», se salta.
  if (p.tramo_desde <= primero) return `; desde el ${p.tramo_desde}, ${tramo} cada uno`;
  const hasta = p.tramo_desde - 1;
  return `; ${hasta === primero ? `el ${primero}` : `del ${primero} al ${hasta}`}, ${normal} cada uno; desde el ${p.tramo_desde}, ${tramo}`;
};

/** Una fila del desglose de la calculadora: los departamentos `desde`–`hasta` (incluidos) a `precio` cada uno, y su total `monto` (sin impuesto). `base`: cae dentro del mínimo del plan. */
export interface FilaDesglose { desde: number; hasta: number; unidades: number; precio: string; monto: string; base: boolean }
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
 * Cómo sale el total del servidor, departamento por departamento: el precio base cubre los primeros `minimo` departamentos (o los
 * que haya si son menos); desde el `tramo_desde` cada uno cuesta `tramo_precio`. Todo en enteros (unidad mínima de la moneda): la suma es exacta.
 * El servidor ya dio el total; aquí sólo se reparte y se comprueba que cuadre.
 */
export function desglosar(c: CuentaCotizacion): Desglose {
  const dm = c.decimales;
  const precio = aMinimos(c.precio, dm);
  // Igual que el servidor: un tramo desde el 1 o antes no existe (hace falta un primer tramo).
  const desde = c.tramo_desde != null && c.tramo_precio != null && c.tramo_desde >= 2 ? Math.trunc(c.tramo_desde) : null;
  const tramoPrecio = desde !== null ? aMinimos(c.tramo_precio as string, dm) : precio;
  const cobradas = Math.max(0, Math.trunc(c.cobradas));
  const minimo = Math.min(cobradas, Math.max(0, Math.trunc(c.minimo ?? 0)));
  const total = aMinimos(c.total, dm);
  const n = Math.max(1, Math.trunc(c.unidades));
  if (cobradas < 1) return { filas: [], cuadra: false, promedio: deMinimos(0, dm) };
  // Un corte donde empieza un precio distinto: el 1, el primero después del mínimo y el del tramo.
  const cortes = new Set<number>([1]);
  if (minimo >= 1 && minimo < cobradas) cortes.add(minimo + 1);
  if (desde !== null && desde <= cobradas) cortes.add(desde);
  const inicios = [...cortes].sort((a, b) => a - b);
  let suma = 0;
  const filas: FilaDesglose[] = inicios.map((ini, i) => {
    const fin = i + 1 < inicios.length ? inicios[i + 1] - 1 : cobradas;
    const unidades = fin - ini + 1;
    const p = desde !== null && ini >= desde ? tramoPrecio : precio;
    const monto = unidades * p;
    suma += monto;
    return { desde: ini, hasta: fin, unidades, precio: deMinimos(p, dm), monto: deMinimos(monto, dm), base: minimo >= 1 && ini <= minimo };
  });
  return { filas, cuadra: suma === total, promedio: deMinimos(Math.floor((2 * total + n) / (2 * n)), dm) };
}

/**
 * Texto de una fila del desglose: «Precio base · incluye hasta N departamentos» (si el condominio tiene N o menos), «Departamentos 1 al N · precio base»
 * (si tiene más), o «Departamentos D al H · U × precio» (y «Departamento D · precio» si es uno solo).
 */
export function etiquetaDeFila(f: FilaDesglose, n: number, minimo: number, moneda: string, formato: Formato): string {
  if (f.desde === 1 && f.base && n <= minimo) return `Precio base · incluye hasta ${minimo} departamentos`;
  if (f.desde === 1 && f.base) return `Departamentos 1 al ${f.hasta} · precio base`;
  const precio = formato(f.precio, moneda);
  return f.unidades === 1 ? `Departamento ${f.desde} · ${precio}` : `Departamentos ${f.desde} al ${f.hasta} · ${f.unidades} × ${precio}`;
}

/** La nota bajo el desglose cuando el condominio tiene el mínimo del plan o menos; `null` si no aplica (sin mínimo, o más departamentos). */
export const notaDelMinimo = (n: number, minimo: number): string | null => (minimo > 0 && n <= minimo ? `Tu condominio tiene ${n}: pagas el precio base.` : null);
