import { formatoDinero } from '../lib/paises';

const pen = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fecha = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
const fechaUtc = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Las fechas SIN hora (emisión, vencimiento, fecha de pago) se guardan como medianoche UTC; mostradas con la hora de Lima (UTC−5) caían
 * un día antes (un recibo que vence el 15 salía «14 oct.», 24-oct). Una medianoche UTC exacta se trata como fecha de calendario; lo
 * demás (momentos con hora: última prueba, último uso) sigue en la zona del navegador.
 */
const esFechaDeCalendario = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

/** Soles: sólo para lo de House (la suscripción, Mi plan, /precios). El dinero de un condominio va con `dinero()` y SU moneda. */
export function soles(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return pen.format(Number.isFinite(n) ? n : 0);
}

/**
 * Dinero de un condominio, con el símbolo, los decimales y los separadores de SU moneda (`S/ 272.15`, `US$ 20.00`, `$ 15.000`, `1.234,50 €`).
 * `moneda` es el código ISO 4217 que trae la respuesta del servidor; sin ella cuenta como soles (así nacieron todos los condominios).
 */
export function dinero(v: number | string | null | undefined, moneda?: string | null): string {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return formatoDinero(Number.isFinite(n) ? n : 0, moneda, '\u00a0');
}

/** Para los ejes y etiquetas de los gráficos: un monto entero sin decimales (`S/ 1,200`), uno con centavos completo (`S/ 1,200.50`). */
export function dineroCorto(v: number, moneda?: string | null): string {
  return Number.isInteger(v) ? formatoDinero(v, moneda, ' ', true) : dinero(v, moneda);
}

export interface MontoEnMoneda { monto: number | string | null | undefined; moneda?: string | null }

/** Suma por moneda, en el orden en que aparecen: los montos de monedas distintas NUNCA se suman entre sí. */
export function sumaPorMoneda(filas: MontoEnMoneda[]): { moneda: string; total: number }[] {
  const por = new Map<string, number>();
  for (const f of filas) {
    const m = f.moneda ?? 'PEN';
    por.set(m, (por.get(m) ?? 0) + (Number(f.monto) || 0));
  }
  return [...por].map(([moneda, total]) => ({ moneda, total }));
}

/** «S/ 150.00» o, con varias monedas, «S/ 150.00 · US$ 20.00» (cada una por su lado). */
export function dinerosPorMoneda(filas: MontoEnMoneda[]): string {
  const s = sumaPorMoneda(filas);
  return s.length ? s.map(x => dinero(x.total, x.moneda)).join(' · ') : dinero(0);
}

export function fechaCorta(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '—';
  return (esFechaDeCalendario(d) ? fechaUtc : fecha).format(d);
}

/** Nombres de mes: en el Perú se dice «setiembre». Es el par de `src/server/lib/periodo.ts`: si cambias una lista, cambia la otra. */
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'] as const;

/** «octubre» (minúsculas). */
export const nombreDelMes = (mes: number): string => MESES[mes - 1] ?? String(mes);

/** «Octubre de 2026». */
export function periodo(mes: number, anio: number): string {
  const s = `${nombreDelMes(mes)} de ${anio}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «Mantenimiento de octubre de 2026» o, con torre, «Mantenimiento de octubre de 2026 · Block 1» (cada torre tiene su propio recibo). */
export function tituloRecibo(mes: number, anio: number, torre?: string | null): string {
  return `Mantenimiento de ${periodo(mes, anio).toLowerCase()}${torre ? ` · ${torre}` : ''}`;
}

export function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
}
