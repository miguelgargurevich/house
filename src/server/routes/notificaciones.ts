import { Router } from 'express';
import { crudRouter } from '../crud';
import { prisma } from '../db';
import { conflict, notFound } from '../errors';
import { scopeNotificaciones } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { estadoCanales, CANALES, TIPOS, procesarPronto } from '../services/avisos';
import { idSchema, parseId, z } from '../validation';

const ESTADOS = ['pendiente', 'enviada', 'error', 'omitida'] as const;

type FilaAviso = { ref_entidad: string | null; ref_id: number | null };
type ContextoAviso = { recibo: { id: number; mes: number; anio: number; torre: string | null; condominio: string | null } | null; unidad: { codigo: string; torre: string | null } | null };

/** De qué trata cada aviso: el recibo (con su torre) y, si es de un cargo o un pago, el departamento. Sólo ids y nombres; nunca el texto. */
async function conContexto<T extends FilaAviso>(items: T[]): Promise<(T & { contexto: ContextoAviso | null })[]> {
  const ids = (e: string) => [...new Set(items.filter((n) => n.ref_entidad === e && n.ref_id != null).map((n) => n.ref_id as number))];
  const selRecibo = { id: true, mes: true, anio: true, estructura: { select: { nombre: true } }, complejo: { select: { nombre: true } } } as const;
  const selCargo = { id: true, unidad: { select: { codigo: true, estructura: { select: { nombre: true } } } }, reciboConcepto: { select: { recibo: { select: selRecibo } } } } as const;
  const [recibos, cargos, pagos] = await Promise.all([
    ids('recibo').length ? prisma.recibo.findMany({ where: { id: { in: ids('recibo') } }, select: selRecibo }) : [],
    ids('cargo').length ? prisma.reciboConceptoUnidad.findMany({ where: { id: { in: ids('cargo') } }, select: selCargo }) : [],
    ids('pago').length ? prisma.pago.findMany({ where: { id: { in: ids('pago') } }, select: { id: true, reciboConceptoUnidad: { select: selCargo } } }) : [],
  ]);
  const deRecibo = (r: (typeof recibos)[number] | null | undefined) => (r ? { id: r.id, mes: r.mes, anio: r.anio, torre: r.estructura?.nombre ?? null, condominio: r.complejo?.nombre ?? null } : null);
  const deCargo = (c: (typeof cargos)[number] | null | undefined): ContextoAviso | null => (c ? { recibo: deRecibo(c.reciboConcepto?.recibo), unidad: c.unidad ? { codigo: c.unidad.codigo, torre: c.unidad.estructura?.nombre ?? null } : null } : null);
  const porRecibo = new Map(recibos.map((r) => [r.id, r]));
  const porCargo = new Map(cargos.map((c) => [c.id, c]));
  const porPago = new Map(pagos.map((p) => [p.id, p.reciboConceptoUnidad]));
  return items.map((n) => ({
    ...n,
    contexto: n.ref_id == null ? null : n.ref_entidad === 'recibo' ? (porRecibo.has(n.ref_id) ? { recibo: deRecibo(porRecibo.get(n.ref_id)), unidad: null } : null) : n.ref_entidad === 'cargo' ? deCargo(porCargo.get(n.ref_id)) : n.ref_entidad === 'pago' ? deCargo(porPago.get(n.ref_id)) : null,
  }));
}

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
    schema: z.object({ estado: z.enum(ESTADOS).optional(), canal: z.enum(CANALES).optional(), tipo: z.enum(TIPOS).optional(), estructura_id: idSchema.optional(), complejo_id: idSchema.optional() }),
    where: (f) => {
      // Torre y condominio son de las unidades de quien recibe el aviso (propietario o inquilino).
      const unidad = { ...(f.estructura_id !== undefined ? { estructura_id: f.estructura_id } : {}), ...(f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}) };
      return {
        ...(f.estado ? { estado: f.estado } : {}),
        ...(f.canal ? { canal: f.canal } : {}),
        ...(f.tipo ? { tipo: f.tipo } : {}),
        ...(Object.keys(unidad).length ? { usuario: { OR: [{ unidades: { some: unidad } }, { unidadesInquilino: { some: unidad } }] } } : {}),
      };
    },
  },
  format: (items) => conContexto(items as unknown as (FilaAviso & Record<string, unknown>)[]),
});

const router = Router();
router.use(requireRole('admin'));

/**
 * Qué canales tienen sus variables. `faltan` son nombres de variables, nunca valores. Para WhatsApp, además, la empresa del admin debe tener
 * su número vinculado (instancia de Evolution): sin él los avisos se omiten aunque el servidor esté configurado.
 */
router.get('/canales', async (req, res) => {
  const estado = estadoCanales();
  const empresaId = currentUser(req).empresa_id;
  if (estado.whatsapp.configurado && empresaId != null) {
    const empresa = await prisma.empresaAdministradora.findUnique({ where: { id: empresaId }, select: { whatsapp_instance: true } });
    if (!empresa?.whatsapp_instance) estado.whatsapp = { configurado: false, faltan: [], sinNumero: true };
  }
  res.json(estado);
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
