import { Router } from 'express';
import { crudRouter } from '../crud';
import { prisma } from '../db';
import { conflict, notFound } from '../errors';
import { scopeNotificaciones } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { estadoCanales, CANALES, TIPOS, procesarPronto } from '../services/avisos';
import { parseId, z } from '../validation';

const ESTADOS = ['pendiente', 'enviada', 'error', 'omitida'] as const;

const lista = crudRouter({
  entidad: 'notificacion',
  delegate: prisma.notificacion,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  readOnly: true,
  scope: scopeNotificaciones,
  search: ['asunto', 'usuario.nombre', 'usuario.email'],
  orderable: ['id', 'created_at', 'programada_para', 'enviada_at', 'estado', 'canal', 'tipo'],
  defaultOrder: { created_at: 'desc' },
  // El cuerpo lleva datos del residente: no viaja en el listado.
  omit: { cuerpo: true },
  include: { usuario: { select: { id: true, nombre: true } } },
  filtros: {
    schema: z.object({ estado: z.enum(ESTADOS).optional(), canal: z.enum(CANALES).optional(), tipo: z.enum(TIPOS).optional() }),
    where: (f) => ({
      ...(f.estado ? { estado: f.estado } : {}),
      ...(f.canal ? { canal: f.canal } : {}),
      ...(f.tipo ? { tipo: f.tipo } : {}),
    }),
  },
});

const router = Router();
router.use(requireRole('admin'));

/** Qué canales tienen sus variables. `faltan` son nombres de variables, nunca valores. */
router.get('/canales', (_req, res) => {
  res.json(estadoCanales());
});

/** Conteo por estado dentro del alcance del usuario (para la franja de cifras). */
router.get('/resumen', async (req, res) => {
  const filas = await prisma.notificacion.groupBy({ by: ['estado'], where: scopeNotificaciones(currentUser(req)), _count: { _all: true } });
  const out: Record<string, number> = { pendiente: 0, enviada: 0, error: 0, omitida: 0 };
  for (const f of filas) out[f.estado] = f._count._all;
  res.json(out);
});

router.post('/:id/reenviar', async (req, res) => {
  const id = parseId(req);
  const n = await prisma.notificacion.findFirst({ where: { AND: [{ id }, scopeNotificaciones(currentUser(req))] }, select: { id: true, estado: true, canal: true, tipo: true } });
  if (!n) throw notFound('Aviso');
  // Cambio atómico: sólo pasa a pendiente si sigue en error u omitida.
  const r = await prisma.notificacion.updateMany({
    where: { id, estado: { in: ['error', 'omitida'] } },
    data: { estado: 'pendiente', intentos: 0, error: null, programada_para: new Date() },
  });
  if (r.count === 0) throw conflict('Sólo puedes reenviar avisos con error u omitidos');
  res.locals.entidad = 'notificacion';
  res.locals.accion = 'reenviar';
  res.locals.entidadId = id;
  res.locals.auditDetalle = { canal: n.canal, tipo: n.tipo, estado_anterior: n.estado };
  procesarPronto();
  res.json(await prisma.notificacion.findUniqueOrThrow({ where: { id }, omit: { cuerpo: true }, include: { usuario: { select: { id: true, nombre: true } } } }));
});

router.use(lista);

export { router as notificacionesRouter };
