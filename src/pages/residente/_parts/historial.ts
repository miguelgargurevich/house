// «Mi historial»: tipos de GET /api/me/historial y las cuentas puras que arman cifras y series de los gráficos (probadas aparte del render).
import { MAX_CATEGORIAS, CATEGORIA_OTROS } from '../../../ui/chartTema';
import type { Stat } from '../../../ui/PageHeader';
import { dinero, nombreDelMes } from '../../../ui/format';

export type EstadoMes = 'pagado' | 'en_revision' | 'parcial' | 'vencido' | 'pendiente';

export interface MesHistorial {
  recibo_id: number;
  anio: number;
  mes: number;
  unidad: { id: number; codigo: string };
  /** Moneda del condominio de la unidad: los montos de este mes van en ella. */
  moneda: string;
  total: string;
  por_concepto: { concepto: string; monto: string }[];
  pagado: string;
  saldo: string;
  estado: EstadoMes;
  fecha_vencimiento: string;
  fecha_pago: string | null;
  /** Negativo = pagó antes del vencimiento. */
  dias_vs_vencimiento: number | null;
  agua_m3: string | null;
  agua_promedio_block: string | null;
  /** Promedio del total de las unidades del mismo recibo; `null` si el servidor no lo publica (pocas unidades). */
  total_promedio_block: string | null;
}

/** Las cifras en dinero del resumen, en UNA moneda. */
export interface DineroHistorial {
  pagado: string;
  promedio_mes: string;
  deuda_actual: string;
  en_revision: string;
}

export interface ResumenHistorial {
  /** Con unidades de monedas distintas estas cuatro cifras vienen en `null` y se leen de `por_moneda` (elegir una unidad las devuelve). */
  pagado: string | null;
  promedio_mes: string | null;
  deuda_actual: string | null;
  en_revision: string | null;
  por_moneda?: Record<string, DineroHistorial>;
  meses_a_tiempo: number;
  meses_evaluados: number;
  meses_en_periodo: number;
  agua_promedio_m3: string | null;
}

export interface UnidadHistorial { id: number; codigo: string; estructura: { id: number; nombre: string | null } | null; moneda?: string }

export interface Historial {
  unidades: UnidadHistorial[];
  anios: number[];
  anio: number | null;
  /** Moneda de las unidades mostradas; `null` si son de condominios con monedas distintas. */
  moneda: string | null;
  resumen: ResumenHistorial;
  meses: MesHistorial[];
}

export interface SerieGrafico {
  label: string;
  data: (number | null)[];
  token?: 'brand' | 'muted' | 'ok' | 'warn' | 'bad';
  categoria?: number;
  punteada?: boolean;
}

/** En el Perú se dice «setiembre»: «set». */
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'] as const;

const claveDe = (m: Pick<MesHistorial, 'anio' | 'mes'>) => m.anio * 12 + m.mes;

/** Los meses distintos del periodo, en orden, con su etiqueta: «Oct» si todo es del mismo año, «Oct 26» si cruza años. */
export function ejeMeses(meses: Pick<MesHistorial, 'anio' | 'mes'>[]): { claves: number[]; labels: string[] } {
  const unicos = [...new Map(meses.map(m => [claveDe(m), m])).values()].sort((a, b) => claveDe(a) - claveDe(b));
  const variosAnios = new Set(unicos.map(m => m.anio)).size > 1;
  return {
    claves: unicos.map(claveDe),
    labels: unicos.map(m => {
      const n = MES_CORTO[m.mes - 1] ?? String(m.mes);
      const nombre = n.charAt(0).toUpperCase() + n.slice(1);
      return variosAnios ? `${nombre} ${String(m.anio).slice(-2)}` : nombre;
    }),
  };
}

/**
 * Barras apiladas: un color por concepto, sumando las unidades del residente en cada mes. Los conceptos más grandes (por total) abajo y con
 * color propio; si hay más que colores, el resto se junta en «Otros conceptos» (gris).
 */
export function seriesPorConcepto(meses: MesHistorial[], max = MAX_CATEGORIAS): { labels: string[]; series: SerieGrafico[] } {
  const { claves, labels } = ejeMeses(meses);
  const porConcepto = new Map<string, Map<number, number>>();
  for (const m of meses) {
    for (const c of m.por_concepto) {
      const fila = porConcepto.get(c.concepto) ?? new Map<number, number>();
      fila.set(claveDe(m), (fila.get(claveDe(m)) ?? 0) + Number(c.monto));
      porConcepto.set(c.concepto, fila);
    }
  }
  const total = (f: Map<number, number>) => [...f.values()].reduce((a, v) => a + v, 0);
  const orden = [...porConcepto.entries()].sort((a, b) => total(b[1]) - total(a[1]));
  const visibles = orden.length > max ? orden.slice(0, max) : orden;
  const resto = orden.slice(visibles.length);
  const dato = (f: Map<number, number>) => claves.map(k => Math.round((f.get(k) ?? 0) * 100) / 100);
  const series: SerieGrafico[] = visibles.map(([concepto, f], i) => ({ label: concepto, data: dato(f), categoria: i }));
  if (resto.length) {
    const suma = new Map<number, number>();
    for (const [, f] of resto) for (const [k, v] of f) suma.set(k, (suma.get(k) ?? 0) + v);
    series.push({ label: 'Otros conceptos', data: dato(suma), categoria: CATEGORIA_OTROS });
  }
  return { labels, series };
}

/**
 * Agua: tu consumo y el promedio del block por mes. Con una sola unidad, dos líneas (la tuya y la de referencia, punteada); con varias,
 * un par por unidad. `hayLecturas` = false → la pantalla muestra el estado vacío en vez del gráfico.
 */
export function seriesAgua(meses: MesHistorial[]): { labels: string[]; series: SerieGrafico[]; hayLecturas: boolean } {
  const { claves, labels } = ejeMeses(meses);
  const codigos = [...new Set(meses.filter(m => m.agua_m3 !== null).map(m => m.unidad.codigo))];
  const varias = codigos.length > 1;
  const series: SerieGrafico[] = [];
  codigos.forEach((codigo, i) => {
    const propias = meses.filter(m => m.unidad.codigo === codigo);
    const valor = (k: number, campo: 'agua_m3' | 'agua_promedio_block') => {
      const v = propias.find(m => claveDe(m) === k)?.[campo];
      return v == null ? null : Number(v);
    };
    series.push({ label: varias ? `Tu consumo · ${codigo}` : 'Tu consumo', data: claves.map(k => valor(k, 'agua_m3')), ...(varias ? { categoria: i } : { token: 'brand' as const }) });
    series.push({ label: varias ? `Promedio del block · ${codigo}` : 'Promedio del block', data: claves.map(k => valor(k, 'agua_promedio_block')), punteada: true, ...(varias ? { categoria: i } : { token: 'muted' as const }) });
  });
  return { labels, series, hayLecturas: codigos.length > 0 };
}

/**
 * Puntualidad: días respecto al vencimiento en cada mes pagado (negativo = antes). Con varias unidades en el mismo mes cuenta la que pagó
 * más tarde. Dos series para que el color y la leyenda distingan «antes» de «después» (un mes tiene valor en una sola).
 */
export function seriesPuntualidad(meses: MesHistorial[]): { labels: string[]; series: SerieGrafico[]; hayPagos: boolean } {
  const { claves, labels } = ejeMeses(meses);
  const peor = claves.map(k => {
    const dias = meses.filter(m => claveDe(m) === k && m.dias_vs_vencimiento !== null).map(m => m.dias_vs_vencimiento!);
    return dias.length ? Math.max(...dias) : null;
  });
  return {
    labels,
    series: [
      { label: 'Antes del vencimiento', data: peor.map(d => (d !== null && d <= 0 ? d : null)), token: 'ok' },
      { label: 'Después del vencimiento', data: peor.map(d => (d !== null && d > 0 ? d : null)), token: 'bad' },
    ],
    hayPagos: peor.some(d => d !== null),
  };
}

/** «3 días antes», «el mismo día», «1 día después». */
export function textoDias(n: number): string {
  if (n === 0) return 'el mismo día';
  const d = Math.abs(n);
  return `${d} ${d === 1 ? 'día' : 'días'} ${n < 0 ? 'antes' : 'después'}`;
}

/** Eje de días del gráfico de puntualidad: «5 d antes», «0», «2 d después». */
export const diasCorto = (n: number): string => (n === 0 ? 'Día del venc.' : `${Math.abs(n)} d ${n < 0 ? 'antes' : 'después'}`);

/** Las cuatro cifras de arriba, en la moneda dada (soles si no se dice). Con unidades de monedas distintas, ver `cifrasPorMoneda`. */
export function cifras(r: ResumenHistorial, anio: number | null, moneda?: string | null): Stat[] {
  const en = (v: string | null) => dinero(v, moneda);
  const deuda = Number(r.deuda_actual);
  const enRevision = Number(r.en_revision);
  const alDia = r.meses_evaluados > 0 && r.meses_a_tiempo === r.meses_evaluados;
  return [
    { label: 'Pagado', value: en(r.pagado), tone: 'ok', hint: anio ? `En ${anio}` : r.meses_en_periodo === 1 ? 'En tu único mes con recibo' : `En tus ${r.meses_en_periodo} meses con recibo` },
    { label: 'Promedio por mes', value: en(r.promedio_mes), hint: 'En los meses que pagaste' },
    { label: 'Deuda de hoy', value: en(r.deuda_actual), tone: deuda > 0 ? 'bad' : 'ok', hint: deuda > 0 ? (enRevision > 0 ? `Y ${en(r.en_revision)} en revisión` : 'Incluye la mora, si la hay') : enRevision > 0 ? `${en(r.en_revision)} en revisión` : 'Estás al día' },
    r.meses_evaluados > 0
      ? { label: 'Puntualidad', value: `A tiempo ${r.meses_a_tiempo} de ${r.meses_evaluados}`, tone: alDia ? 'ok' : r.meses_a_tiempo * 2 < r.meses_evaluados ? 'warn' : undefined, hint: r.meses_evaluados === 1 ? 'mes' : 'meses' }
      : { label: 'Puntualidad', value: '—', hint: 'Aún no hay meses para evaluar' },
  ];
}

/**
 * Las cifras con unidades de monedas distintas: las de dinero van UNA VEZ POR MONEDA (rotuladas con su código, nunca sumadas) y la puntualidad,
 * que no es dinero, una sola vez.
 */
export function cifrasPorMoneda(r: ResumenHistorial, anio: number | null): Stat[] {
  const porMoneda = Object.entries(r.por_moneda ?? {}).flatMap(([moneda, d]) =>
    cifras({ ...r, ...d }, anio, moneda).slice(0, 3).map(s => ({ ...s, label: `${s.label} (${moneda})` })),
  );
  return [...porMoneda, cifras({ ...r, pagado: '0', promedio_mes: '0', deuda_actual: '0', en_revision: '0' }, anio)[3]!];
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Pestañas de gráficos: comparar con el block, por concepto, acumulado, costo del agua y puntualidad. Todo puro: la pantalla sólo dibuja.
// ---------------------------------------------------------------------------------------------------------------------------------------

/** Con menos meses que éstos una línea no cuenta nada: la pantalla avisa «aún no hay meses suficientes» en vez de dibujarla. */
export const MIN_MESES_GRAFICO = 2;

/** Meses distintos del periodo (dos unidades en el mismo mes cuentan uno). */
export const cuentaMeses = (meses: Pick<MesHistorial, 'anio' | 'mes'>[]): number => new Set(meses.map(claveDe)).size;

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Suma de `valor` por cada mes del eje, en el orden del eje. */
function sumaPorMes(meses: MesHistorial[], valor: (m: MesHistorial) => number): number[] {
  const { claves } = ejeMeses(meses);
  const por = new Map<number, number>();
  for (const m of meses) por.set(claveDe(m), (por.get(claveDe(m)) ?? 0) + valor(m));
  return claves.map(k => centavos(por.get(k) ?? 0));
}

/** Lo que ese mes suma un concepto (0 si no lo trae). */
const montoDeConcepto = (m: MesHistorial, concepto: string): number => m.por_concepto.filter(c => c.concepto === concepto).reduce((a, c) => a + Number(c.monto), 0);

/** Lo que suma cada concepto en todo el periodo (todas las unidades), del más grande al más chico. */
function totalesPorConcepto(meses: MesHistorial[]): [string, number][] {
  const por = new Map<string, number>();
  for (const m of meses) for (const c of m.por_concepto) por.set(c.concepto, (por.get(c.concepto) ?? 0) + Number(c.monto));
  return [...por.entries()].map(([c, v]): [string, number] => [c, centavos(v)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
}

// ── Comparar con tu block ──

/**
 * Tu total de cada mes contra el promedio del total de las unidades del mismo recibo (el servidor sólo lo manda si es seguro). El promedio es POR
 * UNIDAD: con dos unidades tuyas en el mismo mes, tu total sumado no se puede comparar con él → `variasUnidades` (la pantalla pide elegir una).
 */
export function seriesComparacionBlock(meses: MesHistorial[]): { labels: string[]; series: SerieGrafico[]; hayPromedio: boolean; variasUnidades: boolean } {
  const { claves, labels } = ejeMeses(meses);
  const filasPorMes = new Map<number, number>();
  for (const m of meses) filasPorMes.set(claveDe(m), (filasPorMes.get(claveDe(m)) ?? 0) + 1);
  const variasUnidades = [...filasPorMes.values()].some(n => n > 1);
  const hayPromedio = meses.some(m => m.total_promedio_block !== null);
  if (variasUnidades || !hayPromedio) return { labels, series: [], hayPromedio, variasUnidades };
  const valor = (k: number, campo: 'total' | 'total_promedio_block') => {
    const v = meses.find(m => claveDe(m) === k)?.[campo];
    return v == null ? null : Number(v);
  };
  return {
    labels,
    series: [
      { label: 'Tu total', data: claves.map(k => valor(k, 'total')), token: 'brand' },
      { label: 'Promedio del block', data: claves.map(k => valor(k, 'total_promedio_block')), token: 'muted', punteada: true },
    ],
    hayPromedio,
    variasUnidades,
  };
}

export interface ComparacionBlock { mes: string; tuyo: number; promedio: number; diferencia: number; pct: number | null }

/** El último mes del periodo con promedio publicado, tu total contra él. `null` si ningún mes lo tiene o si hay varias unidades en ese mes. */
export function comparacionUltimoMes(meses: MesHistorial[]): ComparacionBlock | null {
  const con = meses.filter(m => m.total_promedio_block !== null);
  if (!con.length) return null;
  const k = Math.max(...con.map(claveDe));
  const delMes = con.filter(m => claveDe(m) === k);
  if (meses.filter(m => claveDe(m) === k).length > 1) return null;
  const m = delMes[0]!;
  const tuyo = Number(m.total);
  const promedio = Number(m.total_promedio_block);
  const diferencia = centavos(tuyo - promedio);
  return { mes: nombreDelMes(m.mes), tuyo, promedio, diferencia, pct: promedio > 0 ? Math.round((diferencia / promedio) * 100) : null };
}

/** «Tu mantenimiento de octubre fue S/ 120.00, S/ 20.00 más que el promedio de tu block (S/ 100.00): 20 % más.» */
export function textoComparacion(c: ComparacionBlock, moneda?: string | null): string {
  const base = `Tu mantenimiento de ${c.mes} fue ${dinero(c.tuyo, moneda)}`;
  if (Math.abs(c.diferencia) < 0.005) return `${base}, igual que el promedio de tu block.`;
  const cuanto = `${dinero(Math.abs(c.diferencia), moneda)} ${c.diferencia > 0 ? 'más' : 'menos'} que el promedio de tu block (${dinero(c.promedio, moneda)})`;
  return c.pct === null ? `${base}, ${cuanto}.` : `${base}, ${cuanto}: ${Math.abs(c.pct)} % ${c.diferencia > 0 ? 'más' : 'menos'}.`;
}

// ── Por concepto ──

/** Los conceptos del periodo, el que más pesa primero (para el selector). */
export const conceptosDelPeriodo = (meses: MesHistorial[]): string[] => totalesPorConcepto(meses).map(([c]) => c);

/** La línea de UN concepto: su monto mes a mes (un mes sin ese concepto es 0, no un hueco: ese mes no pagaste nada de él). */
export function serieDeConcepto(meses: MesHistorial[], concepto: string): { labels: string[]; series: SerieGrafico[] } {
  const { labels } = ejeMeses(meses);
  return { labels, series: [{ label: concepto, data: sumaPorMes(meses, m => montoDeConcepto(m, concepto)), token: 'brand' }] };
}

export interface TablaConceptos {
  labels: string[];
  filas: { concepto: string; montos: number[]; total: number }[];
  /** Total de cada mes (suma de todos los conceptos) y del periodo. */
  totales: number[];
  totalGeneral: number;
}

/** Concepto × meses, el concepto que más pesa primero. */
export function tablaConceptos(meses: MesHistorial[]): TablaConceptos {
  const { labels } = ejeMeses(meses);
  const filas = totalesPorConcepto(meses).map(([concepto, total]) => ({
    concepto,
    montos: sumaPorMes(meses, m => montoDeConcepto(m, concepto)),
    total,
  }));
  return { labels, filas, totales: sumaPorMes(meses, m => m.por_concepto.reduce((a, c) => a + Number(c.monto), 0)), totalGeneral: centavos(filas.reduce((a, f) => a + f.total, 0)) };
}

export interface PesoConcepto { concepto: string; monto: number; /** Porcentaje del total del periodo, con un decimal. */ pct: number }

/** Cuánto pesa cada concepto en el total del periodo (sólo montos positivos: un descuento no es «peso»). Sin nada que repartir, vacío. */
export function pesoPorConcepto(meses: MesHistorial[]): PesoConcepto[] {
  const positivos = totalesPorConcepto(meses).filter(([, v]) => v > 0);
  const total = positivos.reduce((a, [, v]) => a + v, 0);
  return total > 0 ? positivos.map(([concepto, monto]) => ({ concepto, monto, pct: Math.round((monto / total) * 1000) / 10 })) : [];
}

export interface MasSubio { concepto: string; desde: { mes: string; monto: number }; hasta: { mes: string; monto: number }; diferencia: number; pct: number }

/**
 * El concepto que más subió: la diferencia en dinero entre su último y su primer mes CON MONTO (no el %, que premia a los montos chicos). Pide
 * que el concepto tenga monto en dos meses distintos (así, con un solo mes en el periodo nunca hay «más subió»); si nada subió, `null`.
 */
export function masSubio(meses: MesHistorial[]): MasSubio | null {
  const { labels } = ejeMeses(meses);
  let mejor: MasSubio | null = null;
  for (const [concepto] of totalesPorConcepto(meses)) {
    const montos = sumaPorMes(meses, m => montoDeConcepto(m, concepto));
    const con = montos.map((v, i) => [v, i] as const).filter(([v]) => v > 0);
    if (con.length < 2) continue;
    const [primero, ultimo] = [con[0]!, con.at(-1)!];
    const diferencia = centavos(ultimo[0] - primero[0]);
    if (diferencia <= 0 || (mejor && diferencia <= mejor.diferencia)) continue;
    mejor = { concepto, desde: { mes: labels[primero[1]]!, monto: primero[0] }, hasta: { mes: labels[ultimo[1]]!, monto: ultimo[0] }, diferencia, pct: Math.round((diferencia / primero[0]) * 100) };
  }
  return mejor;
}

// ── Acumulado ──

/** Dos líneas que suben mes a mes: lo que te cobraron y lo que pagaste; la distancia entre ellas es lo pendiente. */
export function seriesAcumulado(meses: MesHistorial[]): { labels: string[]; series: SerieGrafico[] } {
  const { labels } = ejeMeses(meses);
  const acumular = (v: number[]) => v.reduce<number[]>((acc, x) => [...acc, centavos((acc.at(-1) ?? 0) + x)], []);
  return {
    labels,
    series: [
      { label: 'Lo que te cobraron', data: acumular(sumaPorMes(meses, m => Number(m.total))), token: 'brand' },
      { label: 'Lo que pagaste', data: acumular(sumaPorMes(meses, m => Number(m.pagado))), token: 'ok' },
    ],
  };
}

export interface ResumenAcumulado { cobrado: number; pagado: number; pendiente: number; enRevision: number }

/** Lo del periodo: cobrado (suma de los totales), pagado (cobrado de verdad) y la diferencia; de ella, lo que ya enviaste y espera validación. */
export function resumenAcumulado(meses: MesHistorial[]): ResumenAcumulado {
  const suma = (f: (m: MesHistorial) => number) => centavos(meses.reduce((a, m) => a + f(m), 0));
  const cobrado = suma(m => Number(m.total));
  const pagado = suma(m => Number(m.pagado));
  return { cobrado, pagado, pendiente: centavos(cobrado - pagado), enRevision: suma(m => Math.max(0, Number(m.total) - Number(m.pagado) - Number(m.saldo))) };
}

/** «Te cobraron S/ 300.00 y pagaste S/ 200.00. La diferencia, S/ 100.00, sigue pendiente (S/ 40.00 ya lo enviaste y espera validación).» */
export function textoAcumulado(r: ResumenAcumulado, moneda?: string | null): string {
  if (r.pendiente <= 0) return `Pagaste todo lo que te cobraron en el periodo: ${dinero(r.cobrado, moneda)}.`;
  const revision = r.enRevision > 0 ? ` (${dinero(r.enRevision, moneda)} ya lo enviaste y espera validación)` : '';
  return `Te cobraron ${dinero(r.cobrado, moneda)} y pagaste ${dinero(r.pagado, moneda)}. La diferencia, ${dinero(r.pendiente, moneda)}, sigue pendiente${revision}.`;
}

// ── Agua ──

const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Lo que te cobraron por agua ese mes: el monto del ÚNICO concepto cuyo nombre dice «agua». Con ninguno o varios no se adivina: `null`. */
function montoAgua(m: MesHistorial): number | null {
  const agua = m.por_concepto.filter(c => /\bagua\b/.test(sinTildes(c.concepto)));
  return agua.length === 1 ? Number(agua[0]!.monto) : null;
}

/**
 * Costo por m³: lo que te cobraron por el concepto de agua ÷ tus m³ de ese mes (con dos unidades, ambos sumados). Sólo cuenta los meses con las dos
 * cosas; `promedio` es el del periodo (total de agua ÷ total de m³). No es la tarifa: puede incluir cargos fijos del concepto.
 */
export function costoPorM3(meses: MesHistorial[]): { labels: string[]; series: SerieGrafico[]; promedio: number | null; hayDatos: boolean } {
  const { claves, labels } = ejeMeses(meses);
  const validos = meses.flatMap(m => { const a = montoAgua(m); const l = m.agua_m3 === null ? 0 : Number(m.agua_m3); return a !== null && l > 0 ? [{ k: claveDe(m), monto: a, m3: l }] : []; });
  const data = claves.map(k => {
    const delMes = validos.filter(v => v.k === k);
    const m3 = delMes.reduce((a, v) => a + v.m3, 0);
    return m3 > 0 ? centavos(delMes.reduce((a, v) => a + v.monto, 0) / m3) : null;
  });
  const m3Total = validos.reduce((a, v) => a + v.m3, 0);
  return { labels, series: [{ label: 'Costo por m³', data, token: 'brand' }], promedio: m3Total > 0 ? centavos(validos.reduce((a, v) => a + v.monto, 0) / m3Total) : null, hayDatos: validos.length > 0 };
}

// ── Puntualidad ──

/** «Pagaste a tiempo 5 de 6 meses.» `null` si aún no hay meses para evaluar. */
export function textoPuntualidad(r: Pick<ResumenHistorial, 'meses_a_tiempo' | 'meses_evaluados'>): string | null {
  if (r.meses_evaluados <= 0) return null;
  return `Pagaste a tiempo ${r.meses_a_tiempo} de ${r.meses_evaluados} ${r.meses_evaluados === 1 ? 'mes' : 'meses'}.`;
}
