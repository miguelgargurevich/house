import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid } from '../errors';
import { empresaDe, scopeComplejos } from '../lib/scope';
import { idSchema, texto, textoOpcional, z } from '../validation';

const base = z.object({
  nombre: texto(160),
  tipo: texto(40),
  direccion: textoOpcional(255),
  descripcion: textoOpcional(1000),
  empresa_id: idSchema.nullish(),
  /** Valida solo los pagos que la IA lee como coincidencia exacta. Sólo admin/superadmin editan complejos (la junta no). */
  validacion_automatica_ia: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
});

export const complejosRouter = crudRouter({
  entidad: 'complejo',
  delegate: prisma.complejoHabitacional,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeComplejos,
  search: ['nombre', 'direccion', 'descripcion'],
  orderable: ['id', 'nombre', 'tipo'],
  defaultOrder: { nombre: 'asc' },
  include: { empresa: { select: { id: true, nombre: true } } },
  // Conteo de unidades y de blocks (agregado en una sola consulta por página).
  format: async (items) => {
    const ids = items.map((c) => c.id as number);
    if (!ids.length) return items;
    const [unidades, blocks] = await Promise.all([
      prisma.unidad.groupBy({ by: ['complejo_id'], where: { complejo_id: { in: ids } }, _count: { _all: true } }),
      prisma.estructura.groupBy({ by: ['complejo_id'], where: { complejo_id: { in: ids } }, _count: { _all: true } }),
    ]);
    const u = new Map(unidades.map((x) => [x.complejo_id, x._count._all]));
    const b = new Map(blocks.map((x) => [x.complejo_id, x._count._all]));
    return items.map((c) => ({ ...c, unidades_count: u.get(c.id as number) ?? 0, blocks_count: b.get(c.id as number) ?? 0 }));
  },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: async (d, u) => {
    if (u.rol === 'admin') return { ...d, empresa_id: empresaDe(u) };
    if (d.empresa_id == null) throw invalid('Datos inválidos: empresa_id: es obligatorio', { empresa_id: 'Obligatorio' });
    await assertRef(prisma.empresaAdministradora, d.empresa_id as number, {}, 'empresa_id');
    return d;
  },
  prepareUpdate: async (d, u) => {
    if (u.rol === 'admin') return { ...d, empresa_id: empresaDe(u) };
    if (d.empresa_id != null) await assertRef(prisma.empresaAdministradora, d.empresa_id as number, {}, 'empresa_id');
    return d;
  },
});
