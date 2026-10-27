const pen = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fecha = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
const fechaUtc = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Las fechas SIN hora (emisión, vencimiento, fecha de pago) se guardan como medianoche UTC; mostradas con la hora de Lima (UTC−5) caían
 * un día antes (un recibo que vence el 15 salía «14 oct.», 24-oct). Una medianoche UTC exacta se trata como fecha de calendario; lo
 * demás (momentos con hora: última prueba, último uso) sigue en la zona del navegador.
 */
const esFechaDeCalendario = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

export function soles(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return pen.format(Number.isFinite(n) ? n : 0);
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
