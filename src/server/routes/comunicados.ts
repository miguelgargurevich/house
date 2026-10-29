import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, invalid, notFound } from '../errors';
import { ambitoJunta, puedeGestionar } from '../lib/junta';
import { scopeComplejos, scopeComunicados } from '../lib/scope';
import { currentUser, type AuthUser } from '../middleware/auth';
import { procesarPronto } from '../services/avisos';
import { encolarComunicado, origenDe } from '../services/comunicados';
import { idSchema, listQuerySchema, parse, parseBody, parseId, texto, z } from '../validation';

const MAX_TITULO = 120;
const MAX_CUERPO = 4000;

const incluir = {
  complejo: { select: { id: true, nombre: true } },
  estructura: { select: { id: true, nombre: true } },
  autor: { select: { id: true, nombre: true, rol: true } },
} as const;

type ConAutor = { autor: { id: number; nombre: string; rol: string | null } | null };

/** El autor sale con su nombre y de qué lado escribió (`origen`), nunca con su rol crudo. */
export function formatear<T extends ConAutor>(c: T) {
  return { ...c, autor: c.autor ? { id: c.autor.id, nombre: c.autor.nombre } : null, origen: origenDe(c.autor) };
}

const crearSchema = z.object({
  /** La junta no lo manda: es su condominio. */
  complejo_id: idSchema.optional(),
  /** null o ausente = todo el condominio (la junta de un block queda forzada a su block). */
  estructura_id: idSchema.nullish(),
  titulo: texto(MAX_TITULO),
  cuerpo: texto(MAX_CUERPO),
  enviar_correo: z.boolean({ error: 'Debe ser verdadero o falso' }).default(false),
  enviar_whatsapp: z.boolean({ error: 'Debe ser verdadero o falso' }).default(false),
  fijado: z.boolean({ error: 'Debe ser verdadero o falso' }).default(false),
});

/** Editar sólo cambia el texto y el fijado: el condominio y el alcance no se mueven y NUNCA se reenvía (`enviar_*` se ignora). */
const editarSchema = z.object({
  titulo: texto(MAX_TITULO).optional(),
  cuerpo: texto(MAX_CUERPO).optional(),
  fijado: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
});

const filtrosSchema = listQuerySchema.extend({
  complejo_id: idSchema.optional(),
  estructura_id: z.union([idSchema, z.literal('ninguna')]).optional(),
  archivados: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

/** Condominio y block del comunicado nuevo, comprobando que quien lo crea lo alcanza; si no, 404 (no se revela qué existe). */
async function resolverAmbito(u: AuthUser, complejoId: number | undefined, estructuraId: number | null | undefined) {
  const junta = ambitoJunta(u);
  if (junta) {
    // La junta publica en su condominio; con block, sólo en SU block (null o ausente = su block, nunca el condominio entero).
    if (complejoId !== undefined && complejoId !== junta.complejo_id) throw notFound('Condominio');
    const estructura = junta.estructura_id != null ? (estructuraId ?? junta.estructura_id) : (estructuraId ?? null);
    if (!puedeGestionar(u, { complejo_id: junta.complejo_id, estructura_id: estructura })) throw notFound('Block');
    if (estructura != null && !(await prisma.estructura.findFirst({ where: { id: estructura, complejo_id: junta.complejo_id }, select: { id: true } }))) throw notFound('Block');
    return { complejo_id: junta.complejo_id, estructura_id: estructura };
  }
  if (complejoId == null) throw invalid('Datos inválidos: complejo_id: es obligatorio', { complejo_id: 'Obligatorio' });
  if (!(await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id: complejoId }, scopeComplejos(u)] }, select: { id: true } }))) throw notFound('Condominio');
  const estructura = estructuraId ?? null;
  if (estructura != null && !(await prisma.estructura.findFirst({ where: { id: estructura, complejo_id: complejoId }, select: { id: true } }))) throw notFound('Block');
  return { complejo_id: complejoId, estructura_id: estructura };
}

export const comunicadosRouter = Router();
comunicadosRouter.use((_req, res, next) => {
  res.locals.entidad = 'comunicado';
  next();
});
// Sólo administradora y junta (presidente/tesorero): `scopeComunicados` lanza 403 a los demás (secretario, vocal, residentes, personal).
comunicadosRouter.use((req, _res, next) => {
  scopeComunicados(currentUser(req));
  next();
});

/**
 * @openapi
 * /api/comunicados/ambitos:
 *   get:
 *     summary: Condominios y blocks donde quien llama puede publicar comunicados
 *     tags: [Comunicados]
 *     responses:
 *       200: { description: "`{ complejos: [{ id, nombre, estructuras }], fijo }`; `fijo` = la junta de un block sólo publica en ese block" }
 */
comunicadosRouter.get('/ambitos', async (req, res) => {
  const u = currentUser(req);
  const junta = ambitoJunta(u);
  const complejos = await prisma.complejoHabitacional.findMany({
    where: junta ? { id: junta.complejo_id } : scopeComplejos(u),
    orderBy: { nombre: 'asc' },
    take: 100,
    select: { id: true, nombre: true, estructuras: { where: junta?.estructura_id != null ? { id: junta.estructura_id } : {}, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true, tipo: true } } },
  });
  res.json({ complejos, fijo: junta?.estructura_id != null });
});

/**
 * @openapi
 * /api/comunicados:
 *   get:
 *     summary: Lista de comunicados dentro del alcance (administradora o junta)
 *     tags: [Comunicados]
 *     parameters:
 *       - { in: query, name: complejo_id, schema: { type: integer } }
 *       - { in: query, name: estructura_id, schema: { type: string }, description: "id del block o `ninguna` (todo el condominio)" }
 *       - { in: query, name: archivados, schema: { type: boolean }, description: "por omisión sólo los publicados" }
 *     responses:
 *       200: { description: "`{ items, total, page, pageSize }`; fijados primero, luego los más nuevos" }
 *       403: { description: "No es administradora ni presidente/tesorero de la junta" }
 */
comunicadosRouter.get('/', async (req, res) => {
  const u = currentUser(req);
  const q = parse(filtrosSchema, req.query);
  const where: Prisma.ComunicadoWhereInput = {
    AND: [
      scopeComunicados(u),
      q.archivados ? { archivado_at: { not: null } } : { archivado_at: null },
      q.complejo_id !== undefined ? { complejo_id: q.complejo_id } : {},
      q.estructura_id !== undefined ? { estructura_id: q.estructura_id === 'ninguna' ? null : q.estructura_id } : {},
      q.q ? { OR: [{ titulo: { contains: q.q, mode: 'insensitive' } }, { cuerpo: { contains: q.q, mode: 'insensitive' } }] } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.comunicado.count({ where }),
    prisma.comunicado.findMany({ where, orderBy: [{ fijado: 'desc' }, { created_at: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: incluir }),
  ]);
  res.json({ items: rows.map(formatear), total, page: q.page, pageSize: q.pageSize });
});

comunicadosRouter.get('/:id', async (req, res) => {
  const c = await prisma.comunicado.findFirst({ where: { AND: [{ id: parseId(req) }, scopeComunicados(currentUser(req))] }, include: incluir });
  if (!c) throw notFound('Comunicado');
  res.json(formatear(c));
});

/**
 * @openapi
 * /api/comunicados:
 *   post:
 *     summary: Publica un comunicado (y, si lo pides, lo envía por correo y/o WhatsApp)
 *     tags: [Comunicados]
 *     responses:
 *       201: { description: "El comunicado con `avisos_encolados` (cuántos correos/WhatsApp quedaron en cola, respetando las preferencias de cada vecino)" }
 *       404: { description: "Condominio o block fuera de tu alcance" }
 */
comunicadosRouter.post('/', async (req, res) => {
  const u = currentUser(req);
  const d = parseBody(crearSchema, req);
  const ambito = await resolverAmbito(u, d.complejo_id, d.estructura_id);
  const c = await prisma.comunicado.create({
    data: { ...ambito, titulo: d.titulo, cuerpo: d.cuerpo, autor_id: u.id, enviar_correo: d.enviar_correo, enviar_whatsapp: d.enviar_whatsapp, fijado: d.fijado },
    include: incluir,
  });
  const avisos = await encolarComunicado(c);
  if (avisos > 0) procesarPronto();
  res.locals.entidadId = c.id;
  // Sin el texto: la auditoría guarda qué se publicó y dónde, no el contenido.
  res.locals.auditDetalle = { complejo_id: c.complejo_id, estructura_id: c.estructura_id, titulo: c.titulo, fijado: c.fijado, enviar_correo: c.enviar_correo, enviar_whatsapp: c.enviar_whatsapp, avisos_encolados: avisos };
  res.status(201).json({ ...formatear(c), avisos_encolados: avisos });
});

/** Carga el comunicado dentro del alcance de quien llama; uno ajeno es 404. La junta además debe gestionar SU ámbito (`puedeGestionar`). */
async function cargar(req: Request) {
  const u = currentUser(req);
  const c = await prisma.comunicado.findFirst({ where: { AND: [{ id: parseId(req) }, scopeComunicados(u)] } });
  if (!c) throw notFound('Comunicado');
  if (u.rol === 'propietario' && !puedeGestionar(u, c)) throw notFound('Comunicado');
  return c;
}

const editar = async (req: Request, res: Response) => {
  const c = await cargar(req);
  if (c.archivado_at) throw conflict('Este comunicado está archivado y ya no se puede editar');
  const d = parseBody(editarSchema, req);
  const data: Prisma.ComunicadoUpdateInput = {
    ...(d.titulo !== undefined ? { titulo: d.titulo } : {}),
    ...(d.cuerpo !== undefined ? { cuerpo: d.cuerpo } : {}),
    ...(d.fijado !== undefined ? { fijado: d.fijado } : {}),
  };
  const nuevo = await prisma.comunicado.update({ where: { id: c.id }, data, include: incluir });
  res.locals.entidadId = c.id;
  res.locals.auditDetalle = { campos: Object.keys(data), complejo_id: c.complejo_id, estructura_id: c.estructura_id };
  res.json(formatear(nuevo));
};
comunicadosRouter.put('/:id', editar);
comunicadosRouter.patch('/:id', editar);

/**
 * @openapi
 * /api/comunicados/{id}/archivar:
 *   post:
 *     summary: Archiva un comunicado (deja de verse para los vecinos; no se borra)
 *     tags: [Comunicados]
 *     responses:
 *       200: { description: "El comunicado archivado (repetir la llamada no cambia nada)" }
 */
comunicadosRouter.post('/:id/archivar', async (req, res) => {
  const c = await cargar(req);
  res.locals.entidadId = c.id;
  res.locals.accion = 'archivar';
  res.locals.auditDetalle = { titulo: c.titulo, complejo_id: c.complejo_id, estructura_id: c.estructura_id };
  const nuevo = c.archivado_at ? await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id }, include: incluir }) : await prisma.comunicado.update({ where: { id: c.id }, data: { archivado_at: new Date() }, include: incluir });
  res.json(formatear(nuevo));
});
