// Plazo de respuesta de una reclamación: 15 días HÁBILES desde el día del registro (el día del registro no cuenta).
// Hábil = de lunes a viernes. NO se descuentan feriados (ni nacionales ni locales): el plazo que se muestra puede ser uno o dos días más corto que
// el real cuando hay un feriado de por medio. Es un criterio conservador a propósito: Torre responde antes, nunca después.
// Las fechas son de calendario: `Date` a las 00:00 UTC (como el resto del sistema, ver `lib/fechas.ts`).

export const PLAZO_DIAS_HABILES = 15;
const DIA_MS = 86_400_000;

const soloDia = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const esDiaHabil = (d: Date): boolean => { const s = d.getUTCDay(); return s !== 0 && s !== 6; };

/** `n` días hábiles después de `desde` (el día `desde` no cuenta; si cae en sábado o domingo, el primer hábil es el lunes). */
export function sumarDiasHabiles(desde: Date, n: number): Date {
  let d = soloDia(desde);
  let faltan = n;
  while (faltan > 0) {
    d = new Date(d.getTime() + DIA_MS);
    if (esDiaHabil(d)) faltan--;
  }
  return d;
}

/** Fecha límite de respuesta de una reclamación registrada el día `registro`. */
export const fechaLimite = (registro: Date): Date => sumarDiasHabiles(registro, PLAZO_DIAS_HABILES);

/**
 * Días hábiles que faltan de `hoy` a `limite`: 0 el mismo día del límite (vence hoy), positivo antes, NEGATIVO después (vencida: −1 = un día hábil de atraso).
 */
export function diasHabilesRestantes(hoy: Date, limite: Date): number {
  const a = soloDia(hoy);
  const b = soloDia(limite);
  const [desde, hasta, signo] = b.getTime() >= a.getTime() ? [a, b, 1] : [b, a, -1];
  let n = 0;
  for (let d = new Date(desde.getTime() + DIA_MS); d.getTime() <= hasta.getTime(); d = new Date(d.getTime() + DIA_MS)) if (esDiaHabil(d)) n++;
  return n * signo;
}

/** `2026-000001`: año y número dentro del año, con seis cifras. */
export const formatoCorrelativo = (anio: number, numero: number): string => `${anio}-${String(numero).padStart(6, '0')}`;
