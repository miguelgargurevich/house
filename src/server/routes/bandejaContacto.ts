// Bandeja del superadmin: mensajes de /contacto y hojas del Libro de Reclamaciones. Sólo superadmin (otro rol → 403).
// Se monta bajo /api/comercial, antes del router comercial.
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { invalid, notFound } from '../errors';
import { hoyEn } from '../lib/fechas';
import { requireRole } from '../middleware/auth';
import { diasHabilesRestantes } from '../services/reclamaciones/plazo';
import { ZONA_LIBRO } from '../services/reclamaciones/registro';
import { fechaSchema, idParams, listQuerySchema, parse, parseBody, parseQuery, textoOpcional, z } from '../validation';

const superadmin = requireRole(); // sin roles: sólo superadmin
export const bandejaContactoRouter = Router();

const listaContactos = listQuerySchema.extend({ estado: z.enum(['nueva', 'atendida']).optional() });
const listaReclamaciones = listQuerySchema.extend({ estado: z.enum(['pendiente', 'respondida']).optional(), tipo: z.enum(['reclamo', 'queja']).optional() });
const dia = (d: Date) => d.toISOString().slice(0, 10);

/** @openapi
 * /api/comercial/contactos:
 *   get: { summary: "Mensajes de /contacto (más nuevos primero; `?estado=nueva|atendida`, `?q=` busca por nombre, correo o condominio). Sólo superadmin", tags: [Comercial], responses: { 200: { description: "{ items, total, page, pageSize, nuevas }" }, 403: { description: "Sólo superadmin" } } } */
bandejaContactoRouter.get('/contactos', superadmin, async (req, res) => {
  const q = parseQuery(listaContactos, req);
  const where: Prisma.SolicitudContactoWhereInput = {
    ...(q.estado ? { estado: q.estado } : {}),
    ...(q.q ? { OR: [{ nombre: { contains: q.q, mode: 'insensitive' } }, { correo: { contains: q.q, mode: 'insensitive' } }, { condominio: { contains: q.q, mode: 'insensitive' } }] } : {}),
  };
  const [items, total, nuevas] = await Promise.all([
    prisma.solicitudContacto.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.solicitudContacto.count({ where }),
    prisma.solicitudContacto.count({ where: { estado: 'nueva' } }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize, nuevas });
});

const contactoPatch = z.object({ estado: z.enum(['nueva', 'atendida'], { error: 'Estado inválido' }), nota: textoOpcional(1000) });

/** @openapi
 * /api/comercial/contactos/{id}:
 *   patch: { summary: "Marca un mensaje de contacto como atendido (con nota opcional) o lo vuelve a «nueva». Sólo superadmin; auditado", tags: [Comercial], responses: { 200: { description: "El mensaje" }, 403: { description: "Sólo superadmin" }, 404: { description: "No existe" } } } */
bandejaContactoRouter.patch('/contactos/:id', superadmin, async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parseBody(contactoPatch, req);
  if (!(await prisma.solicitudContacto.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Mensaje');
  const atendida = body.estado === 'atendida';
  const fila = await prisma.solicitudContacto.update({ where: { id }, data: { estado: body.estado, atendida_at: atendida ? new Date() : null, ...(body.nota !== undefined ? { nota: body.nota } : {}) } });
  res.locals.entidad = 'solicitud_contacto';
  res.locals.entidadId = id;
  res.locals.accion = atendida ? 'atender' : 'reabrir';
  res.locals.auditDetalle = { estado: body.estado };
  res.json(fila);
});

/** La hoja con lo que la pantalla necesita para el plazo: días hábiles que faltan (negativo = vencida) y `vencida`. Una hoja respondida ya no corre. */
function vistaReclamacion<T extends { estado: string; fecha_limite: Date }>(r: T, hoy: Date) {
  const pendiente = r.estado === 'pendiente';
  const faltan = pendiente ? diasHabilesRestantes(hoy, r.fecha_limite) : null;
  return { ...r, fecha_limite: dia(r.fecha_limite), dias_habiles_restantes: faltan, vencida: faltan !== null && faltan < 0 };
}

/** @openapi
 * /api/comercial/reclamaciones:
 *   get: { summary: "Hojas del Libro de Reclamaciones: pendientes primero (la que vence antes, arriba), con los días hábiles que faltan para el plazo (negativo = vencida). `?estado=`, `?tipo=`, `?q=` (correlativo, nombre, correo, documento). Sólo superadmin", tags: [Comercial], responses: { 200: { description: "{ items, total, page, pageSize, pendientes, vencidas }" }, 403: { description: "Sólo superadmin" } } } */
bandejaContactoRouter.get('/reclamaciones', superadmin, async (req, res) => {
  const q = parseQuery(listaReclamaciones, req);
  const hoy = hoyEn(ZONA_LIBRO);
  const where: Prisma.ReclamacionWhereInput = {
    ...(q.estado ? { estado: q.estado } : {}),
    ...(q.tipo ? { tipo: q.tipo } : {}),
    ...(q.q ? { OR: [{ correlativo: { contains: q.q, mode: 'insensitive' } }, { consumidor_nombre: { contains: q.q, mode: 'insensitive' } }, { consumidor_correo: { contains: q.q, mode: 'insensitive' } }, { consumidor_doc_numero: { contains: q.q, mode: 'insensitive' } }] } : {}),
  };
  const [items, total, pendientes, vencidas] = await Promise.all([
    // 'pendiente' < 'respondida' en orden alfabético: las pendientes primero, la que vence antes arriba.
    prisma.reclamacion.findMany({ where, orderBy: [{ estado: 'asc' }, { fecha_limite: 'asc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.reclamacion.count({ where }),
    prisma.reclamacion.count({ where: { estado: 'pendiente' } }),
    prisma.reclamacion.findMany({ where: { estado: 'pendiente' }, select: { estado: true, fecha_limite: true } }),
  ]);
  res.json({ items: items.map((r) => vistaReclamacion(r, hoy)), total, page: q.page, pageSize: q.pageSize, pendientes, vencidas: vencidas.filter((r) => diasHabilesRestantes(hoy, r.fecha_limite) < 0).length });
});

/** @openapi
 * /api/comercial/reclamaciones/{id}:
 *   get: { summary: "Una hoja completa (sólo superadmin)", tags: [Comercial], responses: { 200: { description: "La hoja con `dias_habiles_restantes` y `vencida`" }, 403: { description: "Sólo superadmin" }, 404: { description: "No existe" } } } */
bandejaContactoRouter.get('/reclamaciones/:id', superadmin, async (req, res) => {
  const { id } = parse(idParams, req.params);
  const r = await prisma.reclamacion.findUnique({ where: { id } });
  if (!r) throw notFound('Reclamación');
  res.json(vistaReclamacion(r, hoyEn(ZONA_LIBRO)));
});

const reclamacionPatch = z.object({
  estado: z.enum(['pendiente', 'respondida'], { error: 'Estado inválido' }),
  /** Día en que se respondió (AAAA-MM-DD, de Lima); sin él, hoy. */
  fecha: fechaSchema.optional(),
  nota: textoOpcional(2000),
});

/** @openapi
 * /api/comercial/reclamaciones/{id}:
 *   patch: { summary: "Marca la hoja como respondida (con fecha de respuesta y nota) o la vuelve a pendiente. La fecha no puede ser futura ni anterior al registro. Sólo superadmin; auditado", tags: [Comercial], responses: { 200: { description: "La hoja" }, 403: { description: "Sólo superadmin" }, 404: { description: "No existe" }, 422: { description: "Fecha inválida" } } } */
bandejaContactoRouter.patch('/reclamaciones/:id', superadmin, async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parseBody(reclamacionPatch, req);
  const actual = await prisma.reclamacion.findUnique({ where: { id }, select: { id: true, created_at: true } });
  if (!actual) throw notFound('Reclamación');
  const hoy = hoyEn(ZONA_LIBRO);
  const respondida = body.estado === 'respondida';
  let respondida_at: Date | null = null;
  if (respondida) {
    const fecha = body.fecha ? new Date(Date.UTC(body.fecha.getUTCFullYear(), body.fecha.getUTCMonth(), body.fecha.getUTCDate())) : hoy;
    if (fecha.getTime() > hoy.getTime()) throw invalid('La fecha de respuesta no puede ser futura', { fecha: 'No puede ser futura' });
    if (fecha.getTime() < hoyEn(ZONA_LIBRO, actual.created_at).getTime()) throw invalid('La fecha de respuesta no puede ser anterior al registro', { fecha: 'No puede ser anterior al registro' });
    respondida_at = fecha;
  }
  const fila = await prisma.reclamacion.update({ where: { id }, data: { estado: body.estado, respondida_at, ...(body.nota !== undefined ? { respuesta_nota: body.nota } : {}) } });
  res.locals.entidad = 'reclamacion';
  res.locals.entidadId = id;
  res.locals.accion = respondida ? 'responder' : 'reabrir';
  res.locals.auditDetalle = { estado: body.estado, ...(respondida_at ? { fecha: dia(respondida_at) } : {}) };
  res.json(vistaReclamacion(fila, hoy));
});
