// Reservas de áreas comunes. Las reglas viven aquí (no en la ruta) para que se prueben con un reloj inyectado y con la misma transacción que usa la API.
//
// El día y la hora de una reserva son de pared en la zona horaria del CONDOMINIO (`ComplejoHabitacional.zona_horaria`): la API recibe `dia` («2026-11-05») y
// `hora_inicio`/`hora_fin` («09:00») y los convierte a instantes UTC con esa zona (horario de verano incluido). Nunca se guarda un desfase fijo.
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, invalid, notFound } from '../errors';
import { diaEn, hoyEn, horaEn, medianocheEn } from '../lib/fechas';

export const ESTADOS_RESERVA = ['pendiente', 'aprobada', 'rechazada', 'cancelada'] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];
/** Sólo estos estados ocupan el área: una reserva rechazada o cancelada libera el horario. */
export const ESTADOS_OCUPAN: EstadoReserva[] = ['pendiente', 'aprobada'];

const DIA_MS = 86_400_000;

/** «HH:MM» (o «24:00») → minutos desde la medianoche. */
export function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

const dos = (n: number) => String(n).padStart(2, '0');

/** Minutos desde la medianoche → «HH:MM» (1440 → «24:00»). */
export const hhmmDe = (min: number): string => `${dos(Math.floor(min / 60))}:${dos(min % 60)}`;

/** ¿«2026-11-05» es un día de calendario real? */
export function diaValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  return new Date(`${dia}T00:00:00Z`).toISOString().slice(0, 10) === dia;
}

/** Suma `n` días a «AAAA-MM-DD» (calendario, sin zona). */
export const sumarDias = (dia: string, n: number): string => new Date(new Date(`${dia}T00:00:00Z`).getTime() + n * DIA_MS).toISOString().slice(0, 10);

/**
 * El instante UTC en que el reloj de pared de la zona marca `dia` + `hhmm` («24:00» = medianoche del día siguiente). `null` si esa hora no existe
 * en la zona (salto de reloj del horario de verano). Si la hora se repite (el reloj se atrasa), vale la primera.
 */
export function instanteDePared(zona: string, dia: string, hhmm: string): Date | null {
  const [y, m, d] = dia.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const pared = Date.UTC(y!, m! - 1, d!, h!, mi!);
  let t = pared;
  for (let i = 0; i < 3; i++) {
    const nuevo = t + (pared - horaEn(zona, new Date(t)).getTime());
    if (nuevo === t) break;
    t = nuevo;
  }
  return horaEn(zona, new Date(t)).getTime() === pared ? new Date(t) : null;
}

/** Los instantes en que empieza y termina el día de calendario `dia` en la zona. */
export function ventanaDelDia(zona: string, dia: string): { desde: Date; hasta: Date } {
  const [y, m, d] = dia.split('-').map(Number);
  return { desde: medianocheEn(zona, y!, m!, d!), hasta: medianocheEn(zona, y!, m!, d! + 1) };
}

/** Hora de pared de un instante en la zona: «09:30». Si es la medianoche que cierra el día `dia`, «24:00». */
export function horaDePared(zona: string, instante: Date, dia?: string): string {
  const w = horaEn(zona, instante);
  if (dia && diaEn(instante, zona) !== dia && w.getUTCHours() === 0 && w.getUTCMinutes() === 0) return '24:00';
  return `${dos(w.getUTCHours())}:${dos(w.getUTCMinutes())}`;
}

export const incluirReserva = {
  area: { select: { id: true, nombre: true, complejo_id: true, complejo: { select: { id: true, nombre: true, zona_horaria: true } } } },
  unidad: { select: { id: true, codigo: true } },
  usuario: { select: { id: true, nombre: true } },
  resuelto_por: { select: { id: true, nombre: true } },
} satisfies Prisma.ReservaInclude;

type ReservaConDatos = Prisma.ReservaGetPayload<{ include: typeof incluirReserva }>;

/** La reserva como sale de la API: instantes UTC más el día y las horas de pared de SU condominio. */
export function formatearReserva(r: ReservaConDatos) {
  const zona = r.area.complejo.zona_horaria;
  const dia = diaEn(r.inicio, zona);
  const { complejo, ...area } = r.area;
  return {
    ...r,
    area: { ...area, complejo: { id: complejo.id, nombre: complejo.nombre } },
    zona_horaria: zona,
    dia,
    hora_inicio: horaDePared(zona, r.inicio),
    hora_fin: horaDePared(zona, r.fin, dia),
  };
}

export interface DatosReserva {
  area_id: number;
  unidad_id: number;
  /** «AAAA-MM-DD» en la zona del condominio. */
  dia: string;
  /** «HH:MM» en la zona del condominio. */
  hora_inicio: string;
  /** «HH:MM» (o «24:00») en la zona del condominio. */
  hora_fin: string;
}

type AreaReglas = { id: number; activa: boolean; hora_apertura: string; hora_cierre: string; duracion_max_horas: number; dias_anticipacion_max: number; requiere_aprobacion: boolean; complejo: { zona_horaria: string } };

/**
 * Comprueba las reglas de horario de un pedido (todas 422, con el campo que falla) y devuelve los instantes UTC. No mira otras reservas.
 * `ahora` se inyecta en las pruebas.
 */
export function validarPedido(area: AreaReglas, d: Pick<DatosReserva, 'dia' | 'hora_inicio' | 'hora_fin'>, ahora: Date): { inicio: Date; fin: Date } {
  const zona = area.complejo.zona_horaria;
  if (!diaValido(d.dia)) throw invalid('Datos inválidos: dia: fecha inválida (usa AAAA-MM-DD)', { dia: 'Fecha inválida (usa AAAA-MM-DD)' });
  const ini = minutosDe(d.hora_inicio);
  const fin = minutosDe(d.hora_fin);
  if (fin <= ini) throw invalid('La hora de fin debe ser posterior a la de inicio', { hora_fin: 'Debe ser posterior a la hora de inicio' });
  if (ini < minutosDe(area.hora_apertura) || fin > minutosDe(area.hora_cierre)) {
    const msg = `Esta área se reserva de ${area.hora_apertura} a ${area.hora_cierre}`;
    throw invalid(msg, { hora_inicio: msg });
  }
  if (fin - ini > area.duracion_max_horas * 60) {
    const msg = `Puedes reservar hasta ${area.duracion_max_horas} ${area.duracion_max_horas === 1 ? 'hora' : 'horas'} seguidas`;
    throw invalid(msg, { hora_fin: msg });
  }
  const inicio = instanteDePared(zona, d.dia, d.hora_inicio);
  const finI = instanteDePared(zona, d.dia, d.hora_fin);
  if (!inicio || !finI) throw invalid('Esa hora no existe ese día en la zona horaria del condominio', { hora_inicio: 'Esa hora no existe ese día' });
  if (inicio.getTime() < ahora.getTime()) throw invalid('No puedes reservar en el pasado', { dia: 'Elige un horario que aún no pasó' });
  const ultimo = sumarDias(diaEn(ahora, zona), area.dias_anticipacion_max);
  if (d.dia > ultimo) {
    const msg = `Sólo puedes reservar con ${area.dias_anticipacion_max} ${area.dias_anticipacion_max === 1 ? 'día' : 'días'} de anticipación como máximo`;
    throw invalid(msg, { dia: msg });
  }
  return { inicio, fin: finI };
}

/**
 * Crea la reserva. El cruce se comprueba dentro de una transacción que ANTES bloquea la fila del área (`FOR UPDATE`): dos pedidos al mismo tiempo para el
 * mismo horario se turnan, y el segundo ve el primero ya confirmado y recibe 409. Una reserva `pendiente` también ocupa el horario.
 */
export async function crearReserva(usuarioId: number, d: DatosReserva, ahora: Date = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AreaComun" WHERE id = ${d.area_id} FOR UPDATE`;
    // Se relee ya con el candado: lo que el administrador cambió (o desactivó) un instante antes vale.
    const area = await tx.areaComun.findUnique({ where: { id: d.area_id }, include: { complejo: { select: { zona_horaria: true } } } });
    if (!area) throw notFound('Área común');
    if (!area.activa) throw conflict('Esta área está desactivada y no admite reservas');
    const { inicio, fin } = validarPedido(area, d, ahora);
    const choque = await tx.reserva.findFirst({
      where: { area_id: area.id, estado: { in: ESTADOS_OCUPAN }, inicio: { lt: fin }, fin: { gt: inicio } },
      select: { id: true },
    });
    if (choque) throw conflict('Ese horario ya está reservado. Elige otro bloque libre');
    return tx.reserva.create({
      data: { area_id: area.id, unidad_id: d.unidad_id, usuario_id: usuarioId, inicio, fin, estado: area.requiere_aprobacion ? 'pendiente' : 'aprobada' },
      include: incluirReserva,
    });
  });
}

/** Los bloques ocupados (pendientes y aprobadas) de un área en un día de calendario de SU zona. `mia` marca los del usuario que mira. */
export async function bloquesOcupados(area: { id: number; complejo: { zona_horaria: string } }, dia: string, usuarioId: number) {
  const zona = area.complejo.zona_horaria;
  const { desde, hasta } = ventanaDelDia(zona, dia);
  const filas = await prisma.reserva.findMany({
    where: { area_id: area.id, estado: { in: ESTADOS_OCUPAN }, inicio: { lt: hasta }, fin: { gt: desde } },
    orderBy: { inicio: 'asc' },
    select: { id: true, inicio: true, fin: true, estado: true, usuario_id: true },
  });
  return filas.map((f) => ({
    id: f.id,
    estado: f.estado,
    inicio: f.inicio,
    fin: f.fin,
    // Un bloque que cruza la medianoche se recorta al día que se mira.
    hora_inicio: f.inicio < desde ? '00:00' : horaDePared(zona, f.inicio),
    hora_fin: f.fin > hasta ? '24:00' : horaDePared(zona, f.fin, dia),
    mia: f.usuario_id === usuarioId,
  }));
}

/** «Hoy» de un condominio como «AAAA-MM-DD» (el de SU zona). */
export const hoyDelCondominio = (zona: string, ahora: Date = new Date()): string => hoyEn(zona, ahora).toISOString().slice(0, 10);

/**
 * Cambia el estado de una reserva sólo si sigue en uno de `desde` (un `updateMany` condicionado: dos resoluciones a la vez no pisan una a la otra).
 * `null` = ya no estaba en ese estado.
 */
export async function resolverReserva(id: number, desde: EstadoReserva[], estado: EstadoReserva, quien: number, motivo: string | null, ahora: Date = new Date()) {
  const r = await prisma.reserva.updateMany({ where: { id, estado: { in: desde } }, data: { estado, motivo, resuelto_por_id: quien, resuelto_at: ahora } });
  if (r.count === 0) return null;
  return prisma.reserva.findUniqueOrThrow({ where: { id }, include: incluirReserva });
}
