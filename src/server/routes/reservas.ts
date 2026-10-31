import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { scopeAreasComunes, scopeReservas, scopeUnidadesReserva } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { exigirOperativo } from '../services/comercial/operativo';
import { ESTADOS_RESERVA, ESTADOS_OCUPAN, crearReserva, diaValido, formatearReserva, incluirReserva, resolverReserva, ventanaDelDia } from '../services/reservas';
import { boolQuery, idSchema, listQuerySchema, parseBody, parseId, parseOrden, parseQuery, texto, z } from '../validation';

const MAX_MOTIVO = 300;

const dia = z.string({ error: 'Es obligatorio' }).refine(diaValido, 'Fecha inválida (usa AAAA-MM-DD)');
const HHMM = z.string({ error: 'Debe ser un texto' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM (24 horas)');
const HHMM_FIN = z.string({ error: 'Debe ser un texto' }).regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Usa el formato HH:MM (24 horas)');

const crearSchema = z.object({ area_id: idSchema, unidad_id: idSchema, dia, hora_inicio: HHMM, hora_fin: HHMM_FIN });
const rechazarSchema = z.object({ motivo: texto(MAX_MOTIVO) });
const cancelarSchema = z.object({ motivo: z.string({ error: 'Debe ser un texto' }).trim().max(MAX_MOTIVO, `Máximo ${MAX_MOTIVO} caracteres`).optional() });

const filtrosSchema = listQuerySchema.extend({
  complejo_id: idSchema.optional(),
  area_id: idSchema.optional(),
  estado: z.enum(ESTADOS_RESERVA, { error: `Estado inválido (${ESTADOS_RESERVA.join(', ')})` }).optional(),
  dia: dia.optional(),
  /** true = las que aún no terminaron (pendientes y aprobadas, de hoy en adelante). */
  proximas: boolQuery.optional(),
});

const esAdmin = (u: AuthUser) => u.rol === 'admin' || u.rol === 'superadmin';
/** Reservar es cosa de propietarios e inquilinos (con una unidad suya). La administración gestiona, no reserva. */
const soloResidentes = (u: AuthUser) => {
  if (u.rol !== 'propietario' && u.rol !== 'inquilino') throw forbidden('Sólo propietarios e inquilinos reservan áreas comunes');
};

export const reservasRouter = Router();
reservasRouter.use((_req, res, next) => {
  res.locals.entidad = 'reserva';
  next();
});
// Administración y residentes; el personal → 403 (también lo repite `scopeReservas`).
reservasRouter.use(requireRole('admin', 'propietario', 'inquilino'));

/** Carga la reserva dentro del alcance de quien llama (el residente sólo alcanza las suyas); una ajena es 404. */
async function cargar(req: Request) {
  const r = await prisma.reserva.findFirst({ where: { AND: [{ id: parseId(req) }, scopeReservas(currentUser(req))] }, include: incluirReserva });
  if (!r) throw notFound('Reserva');
  return r;
}

const auditar = (res: Response, r: { id: number; area_id: number; unidad_id: number; estado: string; inicio: Date; fin: Date; area: { complejo_id: number } }, extra: Record<string, unknown> = {}) => {
  res.locals.entidadId = r.id;
  res.locals.auditDetalle = { complejo_id: r.area.complejo_id, area_id: r.area_id, unidad_id: r.unidad_id, estado: r.estado, inicio: r.inicio.toISOString(), fin: r.fin.toISOString(), ...extra } as Prisma.InputJsonValue;
};

/**
 * @openapi
 * /api/reservas:
 *   get:
 *     summary: Reservas (administración: las de sus condominios; residente: las que él pidió)
 *     tags: [Reservas]
 *     parameters:
 *       - { in: query, name: complejo_id, schema: { type: integer } }
 *       - { in: query, name: area_id, schema: { type: integer } }
 *       - { in: query, name: estado, schema: { type: string, enum: [pendiente, aprobada, rechazada, cancelada] } }
 *       - { in: query, name: dia, schema: { type: string }, description: "AAAA-MM-DD en la zona del condominio" }
 *       - { in: query, name: proximas, schema: { type: boolean }, description: "pendientes y aprobadas que aún no terminaron" }
 *       - { in: query, name: orden, schema: { type: string }, description: "inicio:asc|desc o created_at:asc|desc (por omisión inicio:desc)" }
 *     responses:
 *       200: { description: "`{ items, total, page, pageSize }`; cada reserva trae `dia`, `hora_inicio`, `hora_fin` y `zona_horaria` del condominio" }
 *       403: { description: "Personal sin acceso" }
 */
reservasRouter.get('/', async (req, res) => {
  const u = currentUser(req);
  const q = parseQuery(filtrosSchema, req);
  const and: Prisma.ReservaWhereInput[] = [scopeReservas(u)];
  if (q.complejo_id !== undefined) and.push({ area: { complejo_id: q.complejo_id } });
  if (q.area_id !== undefined) and.push({ area_id: q.area_id });
  if (q.estado) and.push({ estado: q.estado });
  if (q.proximas) and.push({ estado: { in: ESTADOS_OCUPAN }, fin: { gt: new Date() } });
  if (q.dia) {
    // El día es el de la zona de CADA condominio: se acota por zona (una consulta por zona en uso, normalmente una).
    const zonas = await prisma.complejoHabitacional.findMany({ where: { areasComunes: { some: {} } }, distinct: ['zona_horaria'], select: { zona_horaria: true } });
    and.push({ OR: zonas.map((z) => { const v = ventanaDelDia(z.zona_horaria, q.dia!); return { area: { complejo: { zona_horaria: z.zona_horaria } }, inicio: { lt: v.hasta }, fin: { gt: v.desde } }; }) });
  }
  if (q.q && esAdmin(u)) and.push({ OR: [{ unidad: { codigo: { contains: q.q, mode: 'insensitive' } } }, { usuario: { nombre: { contains: q.q, mode: 'insensitive' } } }, { area: { nombre: { contains: q.q, mode: 'insensitive' } } }] });
  const where: Prisma.ReservaWhereInput = { AND: and };
  const orden = parseOrden(q.orden, ['inicio', 'created_at'], { inicio: 'desc' });
  const [total, rows] = await Promise.all([
    prisma.reserva.count({ where }),
    prisma.reserva.findMany({ where, orderBy: [orden, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: incluirReserva }),
  ]);
  res.json({ items: rows.map(formatearReserva), total, page: q.page, pageSize: q.pageSize });
});

reservasRouter.get('/:id', async (req, res) => {
  res.json(formatearReserva(await cargar(req)));
});

/**
 * @openapi
 * /api/reservas:
 *   post:
 *     summary: Reserva un área común para una de TUS unidades (propietario o inquilino)
 *     tags: [Reservas]
 *     description: "`dia` y las horas son de pared en la zona del condominio. Sin cruce con otra reserva pendiente o aprobada del área; dentro del horario; no en el pasado; hasta `dias_anticipacion_max` días por delante; hasta `duracion_max_horas`. Si el área no requiere aprobación nace `aprobada`; si no, `pendiente`."
 *     responses:
 *       201: { description: "La reserva" }
 *       403: { description: "No eres propietario ni inquilino" }
 *       404: { description: "Área (sin unidad tuya en ese condominio) o unidad fuera de tu alcance" }
 *       409: { description: "Horario ya reservado, área desactivada o condominio en solo lectura (`SOLO_LECTURA`)" }
 *       422: { description: "Fuera de horario, en el pasado, demasiado adelante o más larga que el máximo" }
 */
reservasRouter.post('/', async (req, res) => {
  const u = currentUser(req);
  soloResidentes(u);
  const d = parseBody(crearSchema, req);
  const area = await prisma.areaComun.findFirst({ where: { AND: [{ id: d.area_id }, scopeAreasComunes(u)] }, select: { id: true, complejo_id: true } });
  if (!area) throw notFound('Área común');
  const unidad = await prisma.unidad.findFirst({ where: { AND: [{ id: d.unidad_id }, scopeUnidadesReserva(u)] }, select: { id: true, complejo_id: true } });
  if (!unidad) throw notFound('Unidad');
  if (unidad.complejo_id !== area.complejo_id) throw invalid('Esa unidad no pertenece al condominio del área', { unidad_id: 'No pertenece al condominio del área' });
  await exigirOperativo(area.complejo_id, u);
  const r = await crearReserva(u.id, d);
  auditar(res, r);
  res.status(201).json(formatearReserva(r));
});

/**
 * @openapi
 * /api/reservas/{id}/aprobar:
 *   post:
 *     summary: Aprueba una reserva pendiente (administración)
 *     tags: [Reservas]
 *     responses:
 *       200: { description: "La reserva aprobada" }
 *       404: { description: "Reserva fuera de tu alcance" }
 *       409: { description: "Ya no está pendiente, ya pasó o el condominio está en solo lectura (`SOLO_LECTURA`)" }
 */
reservasRouter.post('/:id/aprobar', requireRole('admin'), async (req, res) => {
  const u = currentUser(req);
  const r = await cargar(req);
  await exigirOperativo(r.area.complejo_id, u);
  if (r.fin.getTime() <= Date.now()) throw conflict('Esa reserva ya pasó: no se puede aprobar');
  const nueva = await resolverReserva(r.id, ['pendiente'], 'aprobada', u.id, null);
  if (!nueva) throw conflict('Esa reserva ya no está pendiente');
  res.locals.accion = 'aprobar';
  auditar(res, nueva);
  res.json(formatearReserva(nueva));
});

/**
 * @openapi
 * /api/reservas/{id}/rechazar:
 *   post:
 *     summary: Rechaza una reserva pendiente, con motivo (administración)
 *     tags: [Reservas]
 *     responses:
 *       200: { description: "La reserva rechazada (libera el horario)" }
 *       404: { description: "Reserva fuera de tu alcance" }
 *       409: { description: "Ya no está pendiente o el condominio está en solo lectura (`SOLO_LECTURA`)" }
 *       422: { description: "Falta el motivo" }
 */
reservasRouter.post('/:id/rechazar', requireRole('admin'), async (req, res) => {
  const u = currentUser(req);
  const r = await cargar(req);
  const { motivo } = parseBody(rechazarSchema, req);
  await exigirOperativo(r.area.complejo_id, u);
  const nueva = await resolverReserva(r.id, ['pendiente'], 'rechazada', u.id, motivo);
  if (!nueva) throw conflict('Esa reserva ya no está pendiente');
  res.locals.accion = 'rechazar';
  auditar(res, nueva, { motivo });
  res.json(formatearReserva(nueva));
});

/**
 * @openapi
 * /api/reservas/{id}/cancelar:
 *   post:
 *     summary: Cancela una reserva (la administración, cualquiera; el residente, las suyas que aún no empezaron)
 *     tags: [Reservas]
 *     responses:
 *       200: { description: "La reserva cancelada (libera el horario)" }
 *       404: { description: "Reserva fuera de tu alcance (incluye la de otro vecino)" }
 *       409: { description: "Ya estaba rechazada o cancelada, ya empezó/pasó, o el condominio está en solo lectura (`SOLO_LECTURA`)" }
 */
reservasRouter.post('/:id/cancelar', async (req, res) => {
  const u = currentUser(req);
  const r = await cargar(req);
  const { motivo } = parseBody(cancelarSchema, req);
  await exigirOperativo(r.area.complejo_id, u);
  const ahora = Date.now();
  // La administración cancela lo que aún no terminó; el residente, sólo lo que aún no empezó.
  if (esAdmin(u) ? r.fin.getTime() <= ahora : r.inicio.getTime() <= ahora) throw conflict(esAdmin(u) ? 'Esa reserva ya pasó' : 'Sólo puedes cancelar reservas que aún no empezaron');
  const nueva = await resolverReserva(r.id, ESTADOS_OCUPAN, 'cancelada', u.id, motivo || null);
  if (!nueva) throw conflict('Esa reserva ya estaba cancelada o rechazada');
  res.locals.accion = 'cancelar';
  auditar(res, nueva, { ...(motivo ? { motivo } : {}), por: esAdmin(u) ? 'administracion' : 'residente' });
  res.json(formatearReserva(nueva));
});
