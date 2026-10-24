import { Router } from 'express';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid, notFound } from '../errors';
import { abrirContrato, cambiarAdministradora } from '../lib/contratos';
import { empresaDe, scopeComplejos } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { fechaSchema, idSchema, parseBody, parseId, texto, textoOpcional, z } from '../validation';

const base = z.object({
  nombre: texto(160),
  tipo: texto(40),
  direccion: textoOpcional(255),
  descripcion: textoOpcional(1000),
  empresa_id: idSchema.nullish(),
  /** Valida solo los pagos que la IA lee como coincidencia exacta. Sólo admin/superadmin editan complejos (la junta no). */
  validacion_automatica_ia: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
});

const crud = crudRouter({
  entidad: 'complejo',
  delegate: prisma.complejoHabitacional,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeComplejos,
  search: ['nombre', 'direccion', 'descripcion'],
  orderable: ['id', 'nombre', 'tipo'],
  defaultOrder: { nombre: 'asc' },
  include: { empresa: { select: { id: true, nombre: true } } },
  // Conteo de unidades y de blocks (agregado en una sola consulta por página) y el contrato de administración vigente.
  format: async (items) => {
    const ids = items.map((c) => c.id as number);
    if (!ids.length) return items;
    const [unidades, blocks, contratos] = await Promise.all([
      prisma.unidad.groupBy({ by: ['complejo_id'], where: { complejo_id: { in: ids } }, _count: { _all: true } }),
      prisma.estructura.groupBy({ by: ['complejo_id'], where: { complejo_id: { in: ids } }, _count: { _all: true } }),
      prisma.contratoAdministracion.findMany({ where: { complejo_id: { in: ids }, fecha_fin: null }, select: { id: true, complejo_id: true, fecha_inicio: true } }),
    ]);
    const v = new Map(contratos.map((x) => [x.complejo_id, x]));
    const u = new Map(unidades.map((x) => [x.complejo_id, x._count._all]));
    const b = new Map(blocks.map((x) => [x.complejo_id, x._count._all]));
    return items.map((c) => ({ ...c, unidades_count: u.get(c.id as number) ?? 0, blocks_count: b.get(c.id as number) ?? 0, contrato_vigente: v.get(c.id as number) ?? null }));
  },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: async (d, u) => {
    if (u.rol === 'admin') return { ...d, empresa_id: empresaDe(u) };
    if (d.empresa_id == null) throw invalid('Datos inválidos: empresa_id: es obligatorio', { empresa_id: 'Obligatorio' });
    await assertRef(prisma.empresaAdministradora, d.empresa_id as number, {}, 'empresa_id');
    return d;
  },
  // Un condominio nuevo nace con su contrato de administración vigente.
  create: (d) =>
    prisma.$transaction(async (tx) => {
      const c = await tx.complejoHabitacional.create({ data: d as never });
      if (c.empresa_id != null) await abrirContrato(tx, c.id, c.empresa_id);
      return c;
    }),
  prepareUpdate: async (d, u, existing) => {
    // La administradora no se edita aquí: cambiarla cierra un contrato y abre otro (POST /:id/administradora).
    const { empresa_id, ...resto } = d;
    if (u.rol !== 'admin' && empresa_id != null && empresa_id !== existing.empresa_id) {
      throw invalid('Datos inválidos: empresa_id: para cambiar de administradora usa «Cambiar de administradora»', { empresa_id: 'Usa «Cambiar de administradora»' });
    }
    return resto;
  },
});

const router = Router();

/** Historial de contratos del condominio, el vigente primero. Sólo quien lo administra hoy (otro tenant → 404) y el superadmin. */
router.get('/:id/contratos', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  if (!(await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id }, scopeComplejos(user)] }, select: { id: true } }))) throw notFound();
  const items = await prisma.contratoAdministracion.findMany({
    where: { complejo_id: id },
    orderBy: [{ fecha_inicio: 'desc' }, { id: 'desc' }],
    include: { empresa: { select: { id: true, nombre: true } } },
  });
  res.json({ items, total: items.length, page: 1, pageSize: items.length });
});

const cambioSchema = z.object({ empresa_id: idSchema, fecha_inicio: fechaSchema.optional(), observaciones: textoOpcional(500) });

/** Cambiar de administradora (sólo superadmin): cierra el contrato vigente y abre el de la nueva empresa. */
router.post('/:id/administradora', requireRole(), async (req, res) => {
  const id = parseId(req);
  const body = parseBody(cambioSchema, req);
  if (!(await prisma.complejoHabitacional.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
  const r = await cambiarAdministradora(id, body.empresa_id, { fecha_inicio: body.fecha_inicio, observaciones: body.observaciones });
  res.locals.entidad = 'complejo';
  res.locals.entidadId = id;
  res.locals.accion = 'cambiar_administradora';
  res.locals.auditDetalle = { empresa_anterior_id: r.anterior?.empresa_id ?? null, empresa_id: body.empresa_id, contrato_id: r.contrato.id, personal_liberado: r.personal_liberado };
  res.status(201).json(r);
});

router.use(crud);

export { router as complejosRouter };
