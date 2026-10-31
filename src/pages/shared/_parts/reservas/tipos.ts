// Tipos y funciones puras de las reservas de áreas comunes (las usan la administración y los residentes). Sin React: se prueban en Node.

export type EstadoReserva = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada';
export type TonoEstado = 'ok' | 'warn' | 'bad' | 'neutral';

export interface AreaComun {
  id: number;
  complejo_id: number;
  nombre: string;
  descripcion: string | null;
  capacidad: number | null;
  /** «HH:MM» en la zona del condominio. */
  hora_apertura: string;
  /** «HH:MM» o «24:00». */
  hora_cierre: string;
  duracion_max_horas: number;
  dias_anticipacion_max: number;
  requiere_aprobacion: boolean;
  activa: boolean;
  zona_horaria: string;
  complejo: { id: number; nombre: string; zona_horaria: string };
}

export interface Reserva {
  id: number;
  area_id: number;
  unidad_id: number;
  inicio: string;
  fin: string;
  estado: EstadoReserva;
  motivo: string | null;
  resuelto_at: string | null;
  created_at: string;
  /** «AAAA-MM-DD» y «HH:MM» de pared en la zona del condominio. */
  dia: string;
  hora_inicio: string;
  hora_fin: string;
  zona_horaria: string;
  area: { id: number; nombre: string; complejo_id: number; complejo: { id: number; nombre: string } };
  unidad: { id: number; codigo: string };
  usuario: { id: number; nombre: string } | null;
  resuelto_por: { id: number; nombre: string } | null;
}

/** Un tramo ocupado de un área en un día (la API no dice quién: sólo si es tuyo). */
export interface Bloque { id: number; estado: EstadoReserva; hora_inicio: string; hora_fin: string; mia: boolean }

export interface Disponibilidad { area: AreaComun; dia: string; hoy: string; ocupados: Bloque[] }

export const ESTADO_LABEL: Record<EstadoReserva, string> = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada', cancelada: 'Cancelada' };
export const ESTADO_TONO: Record<EstadoReserva, TonoEstado> = { pendiente: 'warn', aprobada: 'ok', rechazada: 'bad', cancelada: 'neutral' };

/** Largo de cada casilla del selector de horas (y de la línea del día). */
export const PASO_MIN = 30;

export const minutosDe = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
export const hhmmDe = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const choca = (ocupados: Pick<Bloque, 'hora_inicio' | 'hora_fin'>[], a: number, b: number) => ocupados.some(o => a < minutosDe(o.hora_fin) && b > minutosDe(o.hora_inicio));

/**
 * Horas de inicio que se pueden elegir: casillas de `paso` minutos dentro del horario del área, sin pisar un tramo ocupado y a partir de `minimo`
 * (minutos desde la medianoche; hoy, la hora que ya pasó no se ofrece).
 */
export function iniciosLibres(area: Pick<AreaComun, 'hora_apertura' | 'hora_cierre'>, ocupados: Pick<Bloque, 'hora_inicio' | 'hora_fin'>[], minimo = 0, paso = PASO_MIN): string[] {
  const out: string[] = [];
  for (let m = minutosDe(area.hora_apertura); m + paso <= minutosDe(area.hora_cierre); m += paso) {
    if (m >= minimo && !choca(ocupados, m, m + paso)) out.push(hhmmDe(m));
  }
  return out;
}

/** Horas de fin que admite ese inicio: hasta el cierre, hasta la duración máxima y sin cruzar el siguiente tramo ocupado. */
export function finesPosibles(area: Pick<AreaComun, 'hora_cierre' | 'duracion_max_horas'>, ocupados: Pick<Bloque, 'hora_inicio' | 'hora_fin'>[], inicio: string, paso = PASO_MIN): string[] {
  const ini = minutosDe(inicio);
  const tope = Math.min(minutosDe(area.hora_cierre), ini + area.duracion_max_horas * 60);
  const out: string[] = [];
  for (let f = ini + paso; f <= tope; f += paso) {
    if (choca(ocupados, ini, f)) break;
    out.push(hhmmDe(f));
  }
  return out;
}

/** Sumar días a «AAAA-MM-DD» (calendario, sin zona). */
export const sumarDias = (dia: string, n: number): string => new Date(new Date(`${dia}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** «AAAA-MM-DD» de hoy en una zona IANA (la del condominio, no la del navegador). */
export const hoyEn = (zona: string, ahora: Date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);

/** Minutos desde la medianoche, en una zona IANA, de un instante. */
export function minutosAhoraEn(zona: string, ahora: Date = new Date()): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ahora);
  return Number(p.find(x => x.type === 'hour')!.value) * 60 + Number(p.find(x => x.type === 'minute')!.value);
}

/** «jue 5 nov» de un día de calendario. */
export const diaLargo = (dia: string): string => new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${dia}T00:00:00Z`)).replace(/,/g, '');

/** «jue 5 nov · 10:00–12:00». */
export const cuandoDe = (r: Pick<Reserva, 'dia' | 'hora_inicio' | 'hora_fin'>): string => `${diaLargo(r.dia)} · ${r.hora_inicio}–${r.hora_fin}`;

/** «Se reserva de 08:00 a 22:00 · hasta 4 h seguidas · con hasta 30 días de anticipación». */
export function reglasDe(a: Pick<AreaComun, 'hora_apertura' | 'hora_cierre' | 'duracion_max_horas' | 'dias_anticipacion_max' | 'requiere_aprobacion'>): string {
  const h = a.duracion_max_horas;
  const d = a.dias_anticipacion_max;
  return [
    `De ${a.hora_apertura} a ${a.hora_cierre}`,
    `hasta ${h} ${h === 1 ? 'hora seguida' : 'horas seguidas'}`,
    `con hasta ${d} ${d === 1 ? 'día' : 'días'} de anticipación`,
    a.requiere_aprobacion ? 'la administración debe aprobarla' : 'se confirma al instante',
  ].join(' · ');
}

/** ¿La administración todavía puede aprobar/rechazar/cancelar? (pendiente o aprobada que aún no terminó). */
export const esVigente = (r: Pick<Reserva, 'estado' | 'fin'>, ahora: Date = new Date()): boolean => (r.estado === 'pendiente' || r.estado === 'aprobada') && new Date(r.fin) > ahora;

/** ¿El residente todavía puede cancelarla? (pendiente o aprobada que aún no empezó). */
export const puedeCancelarVecino = (r: Pick<Reserva, 'estado' | 'inicio'>, ahora: Date = new Date()): boolean => (r.estado === 'pendiente' || r.estado === 'aprobada') && new Date(r.inicio) > ahora;
