// «Mi historial»: tipos de GET /api/me/historial y las cuentas puras que arman cifras y series de los gráficos (probadas aparte del render).
import { MAX_CATEGORIAS, CATEGORIA_OTROS } from '../../../ui/chartTema';
import type { Stat } from '../../../ui/PageHeader';
import { soles } from '../../../ui/format';

export type EstadoMes = 'pagado' | 'en_revision' | 'parcial' | 'vencido' | 'pendiente';

export interface MesHistorial {
  recibo_id: number;
  anio: number;
  mes: number;
  unidad: { id: number; codigo: string };
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
}

export interface ResumenHistorial {
  pagado: string;
  promedio_mes: string;
  deuda_actual: string;
  en_revision: string;
  meses_a_tiempo: number;
  meses_evaluados: number;
  meses_en_periodo: number;
  agua_promedio_m3: string | null;
}

export interface UnidadHistorial { id: number; codigo: string; estructura: { id: number; nombre: string | null } | null }

export interface Historial {
  unidades: UnidadHistorial[];
  anios: number[];
  anio: number | null;
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

/** Las cuatro cifras de arriba. */
export function cifras(r: ResumenHistorial, anio: number | null): Stat[] {
  const deuda = Number(r.deuda_actual);
  const enRevision = Number(r.en_revision);
  const alDia = r.meses_evaluados > 0 && r.meses_a_tiempo === r.meses_evaluados;
  return [
    { label: 'Pagado', value: soles(r.pagado), tone: 'ok', hint: anio ? `En ${anio}` : r.meses_en_periodo === 1 ? 'En tu único mes con recibo' : `En tus ${r.meses_en_periodo} meses con recibo` },
    { label: 'Promedio por mes', value: soles(r.promedio_mes), hint: 'En los meses que pagaste' },
    { label: 'Deuda de hoy', value: soles(r.deuda_actual), tone: deuda > 0 ? 'bad' : 'ok', hint: deuda > 0 ? (enRevision > 0 ? `Y ${soles(r.en_revision)} en revisión` : 'Incluye la mora, si la hay') : enRevision > 0 ? `${soles(r.en_revision)} en revisión` : 'Estás al día' },
    r.meses_evaluados > 0
      ? { label: 'Puntualidad', value: `A tiempo ${r.meses_a_tiempo} de ${r.meses_evaluados}`, tone: alDia ? 'ok' : r.meses_a_tiempo * 2 < r.meses_evaluados ? 'warn' : undefined, hint: r.meses_evaluados === 1 ? 'mes' : 'meses' }
      : { label: 'Puntualidad', value: '—', hint: 'Aún no hay meses para evaluar' },
  ];
}
