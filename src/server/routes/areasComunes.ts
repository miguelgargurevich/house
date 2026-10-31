import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, invalid, notFound } from '../errors';
import { scopeAreasComunes, scopeComplejos } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { exigirOperativo } from '../services/comercial/operativo';
import { bloquesOcupados, diaValido, hoyDelCondominio, minutosDe } from '../services/reservas';
import { boolQuery, idSchema, listQuerySchema, parseBody, parseId, parseQuery, texto, textoOpcional, z } from '../validation';

const HHMM = z.string({ error: 'Debe ser un texto' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM (24 horas)');
/** El cierre admite «24:00» (la medianoche que termina el día). */
const HHMM_CIERRE = z.string({ error: 'Debe ser un texto' }).regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Usa el formato HH:MM (24 horas)');
const entero = (min: number, max: number) => z.number({ error: 'Debe ser un número' }).int('Debe ser un entero').min(min, `Mínimo ${min}`).max(max, `Máximo ${max}`);
const bool = z.boolean({ error: 'Debe ser verdadero o falso' });

const campos = {
  nombre: texto(80),
  descripcion: textoOpcional(500),
  capacidad: entero(1, 10_000).nullish(),
  hora_apertura: HHMM,
  hora_cierre: HHMM_CIERRE,
  duracion_max_horas: entero(1, 24),
  dias_anticipacion_max: entero(1, 365),
  requiere_aprobacion: bool,
  activa: bool,
};

const crearSchema = z.object({
  complejo_id: idSchema,
  ...campos,
  duracion_max_horas: campos.duracion_max_horas.default(2),
  dias_anticipacion_max: campos.dias_anticipacion_max.default(30),
  requiere_aprobacion: campos.requiere_aprobacion.default(false),
  activa: campos.activa.default(true),
});

/** El condominio no se mueve al editar. */
const editarSchema = z.object(campos).partial();

const filtrosSchema = listQuerySchema.extend({
  complejo_id: idSchema.optional(),
  activa: boolQuery.optional(),
});

const dispQuerySchema = z.object({ dia: z.string({ error: 'Es obligatorio' }).refine(diaValido, 'Fecha inválida (usa AAAA-MM-DD)') });

const incluir = { complejo: { select: { id: true, nombre: true, zona_horaria: true } } } as const;

/** El área como sale de la API: con el condominio y su zona horaria (la que fija cómo se leen el horario y los días). */
const formatear = <T extends { complejo: { id: number; nombre: string; zona_horaria: string } }>(a: T) => ({ ...a, zona_horaria: a.complejo.zona_horaria });

/** El horario del área tiene que ser coherente: abre antes de cerrar. */
function exigirHorario(apertura: string, cierre: string) {
  if (minutosDe(cierre) <= minutosDe(apertura)) throw invalid('La hora de cierre debe ser posterior a la de apertura', { hora_cierre: 'Debe ser posterior a la hora de apertura' });
}

/** Los residentes sólo ven áreas activas; la administración, todas las de su alcance. */
const esAdmin = (u: AuthUser) => u.rol === 'admin' || u.rol === 'superadmin';

export const areasComunesRouter = Router();
areasComunesRouter.use((_req, res, next) => {
  res.locals.entidad = 'area_comun';
  next();
});
// Administración y residentes; el personal (seguridad, mantenimiento…) → 403. `scopeAreasComunes` repite la regla por si se monta en otro sitio.
areasComunesRouter.use(requireRole('admin', 'propietario', 'inquilino'));

/** Carga el área dentro del alcance de quien llama; una ajena (otra empresa u otro condominio) es 404. Un residente sólo alcanza áreas activas. */
async function cargar(req: Request) {
  const u = currentUser(req);
  const a = await prisma.areaComun.findFirst({ where: { AND: [{ id: parseId(req) }, scopeAreasComunes(u), esAdmin(u) ? {} : { activa: true }] }, include: incluir });
  if (!a) throw notFound('Área común');
  return a;
}

/**
 * @openapi
 * /api/areas-comunes:
 *   get:
 *     summary: Áreas comunes reservables (administración: las de sus condominios; residente: las activas de los condominios de sus unidades)
 *     tags: [Reservas]
 *     parameters:
 *       - { in: query, name: complejo_id, schema: { type: integer } }
 *       - { in: query, name: activa, schema: { type: boolean }, description: "sólo administración; el residente siempre ve las activas" }
 *     responses:
 *       200: { description: "`{ items, total, page, pageSize }`; cada área trae `zona_horaria` del condominio" }
 *       403: { description: "Personal sin acceso (seguridad, mantenimiento…)" }
 */
areasComunesRouter.get('/', async (req, res) => {
  const u = currentUser(req);
  const q = parseQuery(filtrosSchema, req);
  const where: Prisma.AreaComunWhereInput = {
    AND: [
      scopeAreasComunes(u),
      esAdmin(u) ? (q.activa !== undefined ? { activa: q.activa } : {}) : { activa: true },
      q.complejo_id !== undefined ? { complejo_id: q.complejo_id } : {},
      q.q ? { OR: [{ nombre: { contains: q.q, mode: 'insensitive' } }, { descripcion: { contains: q.q, mode: 'insensitive' } }] } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.areaComun.count({ where }),
    prisma.areaComun.findMany({ where, orderBy: [{ complejo_id: 'asc' }, { nombre: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: incluir }),
  ]);
  res.json({ items: rows.map(formatear), total, page: q.page, pageSize: q.pageSize });
});

areasComunesRouter.get('/:id', async (req, res) => {
  res.json(formatear(await cargar(req)));
});

/**
 * @openapi
 * /api/areas-comunes/{id}/disponibilidad:
 *   get:
 *     summary: Bloques ocupados de un área en un día
 *     tags: [Reservas]
 *     parameters:
 *       - { in: query, name: dia, required: true, schema: { type: string }, description: "AAAA-MM-DD en la zona del condominio" }
 *     responses:
 *       200: { description: "`{ area, dia, hoy, ocupados: [{ id, estado, hora_inicio, hora_fin, mia }] }`; pendientes y aprobadas ocupan el área. No revela quién reservó (`mia` marca las tuyas)" }
 *       404: { description: "Área fuera de tu alcance" }
 */
areasComunesRouter.get('/:id/disponibilidad', async (req, res) => {
  const u = currentUser(req);
  const area = await cargar(req);
  const { dia } = parseQuery(dispQuerySchema, req);
  const ocupados = await bloquesOcupados(area, dia, u.id);
  res.json({ area: formatear(area), dia, hoy: hoyDelCondominio(area.complejo.zona_horaria), ocupados });
});

/**
 * @openapi
 * /api/areas-comunes:
 *   post:
 *     summary: Crea un área común en un condominio de tu empresa
 *     tags: [Reservas]
 *     responses:
 *       201: { description: "El área" }
 *       404: { description: "Condominio fuera de tu alcance" }
 *       409: { description: "Ya hay un área con ese nombre en el condominio, o el condominio está en solo lectura (`SOLO_LECTURA`)" }
 *       422: { description: "Horario o límites inválidos" }
 */
areasComunesRouter.post('/', requireRole('admin'), async (req, res) => {
  const u = currentUser(req);
  const d = parseBody(crearSchema, req);
  exigirHorario(d.hora_apertura, d.hora_cierre);
  if (!(await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id: d.complejo_id }, scopeComplejos(u)] }, select: { id: true } }))) throw notFound('Condominio');
  await exigirOperativo(d.complejo_id, u);
  if (await prisma.areaComun.findFirst({ where: { complejo_id: d.complejo_id, nombre: { equals: d.nombre, mode: 'insensitive' } }, select: { id: true } })) throw conflict('Ya hay un área con ese nombre en este condominio');
  const a = await prisma.areaComun.create({ data: { ...d, descripcion: d.descripcion ?? null, capacidad: d.capacidad ?? null }, include: incluir });
  res.locals.entidadId = a.id;
  res.locals.auditDetalle = { complejo_id: a.complejo_id, nombre: a.nombre, hora_apertura: a.hora_apertura, hora_cierre: a.hora_cierre, requiere_aprobacion: a.requiere_aprobacion, activa: a.activa };
  res.status(201).json(formatear(a));
});

/**
 * @openapi
 * /api/areas-comunes/{id}:
 *   patch:
 *     summary: Edita un área (o la desactiva con `activa: false`)
 *     tags: [Reservas]
 *     description: Desactivar o cambiar el horario NO toca las reservas que ya existen; sólo rige para las nuevas. También acepta PUT.
 *     responses:
 *       200: { description: "El área" }
 *       404: { description: "Área fuera de tu alcance" }
 *       409: { description: "Nombre repetido o condominio en solo lectura (`SOLO_LECTURA`)" }
 */
const editar = async (req: Request, res: Response) => {
  const u = currentUser(req);
  const a = await cargar(req);
  const d = parseBody(editarSchema, req);
  exigirHorario(d.hora_apertura ?? a.hora_apertura, d.hora_cierre ?? a.hora_cierre);
  await exigirOperativo(a.complejo_id, u);
  if (d.nombre !== undefined && d.nombre.toLowerCase() !== a.nombre.toLowerCase() && (await prisma.areaComun.findFirst({ where: { complejo_id: a.complejo_id, id: { not: a.id }, nombre: { equals: d.nombre, mode: 'insensitive' } }, select: { id: true } }))) throw conflict('Ya hay un área con ese nombre en este condominio');
  const nuevo = await prisma.areaComun.update({ where: { id: a.id }, data: d, include: incluir });
  res.locals.entidadId = a.id;
  res.locals.auditDetalle = { complejo_id: a.complejo_id, campos: Object.keys(d), ...(d.activa !== undefined && d.activa !== a.activa ? { activa: d.activa } : {}) };
  res.json(formatear(nuevo));
};
areasComunesRouter.put('/:id', requireRole('admin'), editar);
areasComunesRouter.patch('/:id', requireRole('admin'), editar);
