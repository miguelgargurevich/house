import { Router } from 'express';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid, notFound } from '../errors';
import { scopeComplejos, scopeEstructuras } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { idSchema, parseId, texto, textoOpcional, z } from '../validation';

/**
 * Las torres son planas. Todo el motor de House agrupa por torre directa (`Unidad.estructura_id`):
 * el ámbito de la junta, el resumen de recibos por torre y la importación del Excel de mantenimiento.
 * Por eso el anidamiento se rechaza: una torre anidada sería un dato que la aplicación no sabría representar.
 */
const PLANAS = 'House trabaja con torres planas: no se puede anidar una torre dentro de otra';

const base = z.object({
  nombre: textoOpcional(120),
  tipo: texto(40),
  complejo_id: idSchema,
  padre_id: z.never({ error: PLANAS }).nullish(),
  /** Al crear o editar: cuántos pisos tiene la torre (0–60). Los pisos que ya existen no se borran. */
  cantidad_pisos: z.coerce.number().int().min(0, 'No puede ser negativo').max(60, 'Máximo 60 pisos').nullish(),
});

async function validarRefs(d: Record<string, unknown>, user: AuthUser) {
  if (d.padre_id != null) throw invalid(PLANAS, { padre_id: 'Las torres son planas' });
  if (d.complejo_id != null) await assertRef(prisma.complejoHabitacional, d.complejo_id as number, scopeComplejos(user), 'complejo_id');
  return d;
}

const crud = crudRouter({
  entidad: 'estructura',
  delegate: prisma.estructura,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeEstructuras,
  search: ['nombre', 'tipo'],
  orderable: ['id', 'nombre', 'tipo'],
  defaultOrder: { id: 'asc' },
  include: { complejo: { select: { id: true, nombre: true } } },
  // Conteo de pisos y de unidades por torre (una consulta por cada dato, para toda la página).
  format: async (items) => {
    const ids = items.map(i => i.id as number);
    if (!ids.length) return items;
    const [unidades, pisos] = await Promise.all([
      prisma.unidad.groupBy({ by: ['estructura_id'], where: { estructura_id: { in: ids } }, _count: { _all: true } }),
      prisma.piso.groupBy({ by: ['estructura_id'], where: { estructura_id: { in: ids } }, _count: { _all: true } }),
    ]);
    const u = new Map(unidades.map(x => [x.estructura_id, x._count._all]));
    const p = new Map(pisos.map(x => [x.estructura_id, x._count._all]));
    return items.map(i => ({ ...i, unidades_count: u.get(i.id as number) ?? 0, pisos_count: p.get(i.id as number) ?? 0 }));
  },
  filtros: {
    schema: z.object({ complejo_id: idSchema.optional() }),
    where: (f) => (f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}),
  },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: validarRefs,
  prepareUpdate: async (d, u, existing) => {
    if (d.padre_id != null) throw invalid(PLANAS, { padre_id: 'Las torres son planas' });
    // Una torre no cambia de condominio: sus unidades y sus medios de pago pertenecen al de origen.
    if (d.complejo_id != null && d.complejo_id !== existing.complejo_id) {
      throw invalid('Una torre no se cambia de condominio: crea una torre nueva en el otro condominio', { complejo_id: 'No se puede cambiar' });
    }
    // La torre no cambia de condominio y no se anida: se quitan del cuerpo antes de validar el resto.
    const resto = { ...d };
    delete resto.padre_id;
    delete resto.complejo_id;
    return validarRefs(resto, u);
  },
  // Crear la torre con sus pisos, en una transacción.
  create: async (d) => {
    const { cantidad_pisos, ...data } = d as { cantidad_pisos?: number | null } & Record<string, unknown>;
    return prisma.$transaction(async (tx) => {
      const est = await tx.estructura.create({ data: data as never });
      const n = cantidad_pisos ?? 0;
      if (n > 0) await tx.piso.createMany({ data: Array.from({ length: n }, (_, i) => ({ numero: i + 1, estructura_id: est.id })) });
      return est;
    });
  },
  // Editar la torre y agregar los pisos que falten (nunca se borra un piso: puede tener unidades).
  update: async (d, existing) => {
    const { cantidad_pisos, ...data } = d as { cantidad_pisos?: number | null } & Record<string, unknown>;
    const id = existing.id as number;
    return prisma.$transaction(async (tx) => {
      const est = await tx.estructura.update({ where: { id }, data: data as never });
      const n = cantidad_pisos ?? 0;
      if (n > 0) {
        const pisos = await tx.piso.findMany({ where: { estructura_id: id }, select: { numero: true } });
        const existentes = new Set(pisos.map(p => p.numero));
        const nuevos = Array.from({ length: n }, (_, i) => i + 1).filter(numero => !existentes.has(numero));
        if (nuevos.length > 0) await tx.piso.createMany({ data: nuevos.map(numero => ({ numero, estructura_id: id })) });
      }
      return est;
    });
  },
  // Una torre con unidades o con junta asignada no se puede borrar: hay que reasignar antes.
  beforeDelete: async (existing) => {
    const id = existing.id as number;
    const [unidades, junta] = await Promise.all([
      prisma.unidad.count({ where: { estructura_id: id } }),
      prisma.usuario.count({ where: { estructura_id: id, cargo_junta: { not: null } } }),
    ]);
    if (unidades > 0) {
      throw invalid(`La torre tiene ${unidades} ${unidades === 1 ? 'unidad asignada' : 'unidades asignadas'}: muévelas a otra torre antes de borrarla`, { unidades: 'La torre tiene unidades' });
    }
    if (junta > 0) {
      throw invalid(`La torre tiene ${junta} ${junta === 1 ? 'usuario de junta' : 'usuarios de junta'}: reasígnalos antes de borrarla (sin torre su alcance pasa a todo el condominio)`, { junta: 'La torre tiene usuarios de junta' });
    }
  },
  // Los pisos se van con la torre.
  afterDelete: async (existing) => {
    await prisma.piso.deleteMany({ where: { estructura_id: existing.id as number } });
  },
});

const router = Router();

/** Asigna a la torre las unidades del condominio que todavía no tienen torre (carga anterior a las torres). */
router.post('/:id/asignar-unidades', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const est = await prisma.estructura.findFirst({ where: { AND: [{ id }, scopeEstructuras(user)] }, select: { id: true, complejo_id: true } });
  if (!est) throw notFound();
  const r = await prisma.unidad.updateMany({ where: { complejo_id: est.complejo_id, estructura_id: null }, data: { estructura_id: id } });
  res.locals.entidad = 'estructura';
  res.locals.entidadId = id;
  res.locals.accion = 'asignar_unidades';
  res.locals.auditDetalle = { asignadas: r.count, complejo_id: est.complejo_id };
  res.json({ asignadas: r.count });
});

router.use(crud);

export { router as estructurasRouter };
