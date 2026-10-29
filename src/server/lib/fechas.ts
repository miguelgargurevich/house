import { ZONA_POR_DEFECTO } from '../../lib/paises';

/**
 * El «hoy» de un condominio es el de SU zona horaria (`ComplejoHabitacional.zona_horaria`, IANA). Todo sale de `Intl`: la zona se
 * consulta en cada instante, así que el horario de verano se respeta solo (nunca hay un desfase fijo guardado). Las fechas de calendario
 * (vencimiento, emisión) se guardan a las 00:00 UTC y se comparan como día; `hoyEn` devuelve el día de hoy en ese mismo formato.
 */
const DIA_MS = 86_400_000;

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(zona: string): Intl.DateTimeFormat {
  let f = formatos.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatos.set(zona, f);
  }
  return f;
}

/** La hora de pared de ese instante en la zona, como si fuera UTC (ms). */
function paredEn(zona: string, t: number): number {
  const v: Record<string, number> = {};
  for (const p of formato(zona).formatToParts(new Date(t))) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return Date.UTC(v.year!, v.month! - 1, v.day!, v.hour!, v.minute!, v.second!);
}

/** La hora de pared de un instante en la zona, como un `Date` cuyos campos UTC son los de esa hora (para escribir «14:32» sin desfases). */
export function horaEn(zona: string, instante: Date): Date {
  return new Date(paredEn(zona, instante.getTime()));
}

/** Desfase (ms) de la zona respecto a UTC en ese instante: −5 h en Lima; en Madrid, +1 h en invierno y +2 h en verano. */
function desfaseEn(zona: string, t: number): number {
  return paredEn(zona, t) - Math.floor(t / 1000) * 1000;
}

/** Fecha (00:00 UTC) del día de hoy en la zona. Un cargo está vencido si su vencimiento es anterior a esta fecha. */
export function hoyEn(zona: string, ahora: Date = new Date()): Date {
  const d = new Date(paredEn(zona, ahora.getTime()));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** «2026-10-31»: el día de un instante según la zona. */
export function diaEn(fecha: Date, zona: string): string {
  return hoyEn(zona, fecha).toISOString().slice(0, 10);
}

/**
 * El instante en que empieza el día (`anio`, `mes` 1–12, `dia`) en la zona. Si el reloj salta a medianoche (Santiago el 6-sep-2026: de 23:59 a
 * 01:00) ese día no tiene 00:00 y empieza en el salto; si se atrasa a medianoche, vale la primera vez.
 */
export function medianocheEn(zona: string, anio: number, mes: number, dia: number): Date {
  const pared = Date.UTC(anio, mes - 1, dia);
  const antes = desfaseEn(zona, pared - DIA_MS);
  const despues = desfaseEn(zona, pared + DIA_MS);
  const validos = [...new Set([antes, despues])].map((o) => pared - o).filter((t) => t + desfaseEn(zona, t) === pared);
  return new Date(validos.length ? Math.min(...validos) : pared - antes);
}

export function inicioMesEn(zona: string, ahora: Date = new Date()): Date {
  const h = hoyEn(zona, ahora);
  return medianocheEn(zona, h.getUTCFullYear(), h.getUTCMonth() + 1, 1);
}

export function inicioAnioEn(zona: string, ahora: Date = new Date()): Date {
  return medianocheEn(zona, hoyEn(zona, ahora).getUTCFullYear(), 1, 1);
}

/** Los `n` meses que terminan en `anio`/`mes` (el más viejo primero), con sus límites en la zona. `mes` va de 1 a 12. */
export function mesesHasta(n: number, anioFin: number, mesFin: number, zona: string = ZONA_POR_DEFECTO): { clave: string; anio: number; mes: number; desde: Date; hasta: Date }[] {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anioFin, mesFin - 1 - i, 1));
    const anio = d.getUTCFullYear();
    const mes = d.getUTCMonth() + 1;
    out.push({
      clave: `${anio}-${String(mes).padStart(2, '0')}`,
      anio,
      mes,
      desde: medianocheEn(zona, anio, mes, 1),
      hasta: medianocheEn(zona, anio, mes + 1, 1),
    });
  }
  return out;
}

/** Los `n` meses que terminan en el mes de hoy en la zona. */
export function mesesAtrasEn(zona: string, n: number, ahora: Date = new Date()): ReturnType<typeof mesesHasta> {
  const h = hoyEn(zona, ahora);
  return mesesHasta(n, h.getUTCFullYear(), h.getUTCMonth() + 1, zona);
}

// Atajos de Lima (la zona con la que nacieron todos los condominios y la de lo que no tiene condominio, como la suscripción a House).
export const hoyLima = (ahora: Date = new Date()): Date => hoyEn(ZONA_POR_DEFECTO, ahora);
export const inicioMesLima = (ahora: Date = new Date()): Date => inicioMesEn(ZONA_POR_DEFECTO, ahora);
export const inicioAnioLima = (ahora: Date = new Date()): Date => inicioAnioEn(ZONA_POR_DEFECTO, ahora);
export const mesesAtras = (n: number, ahora: Date = new Date()): ReturnType<typeof mesesHasta> => mesesAtrasEn(ZONA_POR_DEFECTO, n, ahora);

export function diasEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / 86_400_000);
}
