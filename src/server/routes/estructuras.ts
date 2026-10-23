import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { scopeComplejos, scopeEstructuras } from '../lib/scope';
import { idSchema, texto, textoOpcional, z } from '../validation';

const base = z.object({
  nombre: textoOpcional(120),
  tipo: texto(40),
  padre_id: idSchema.nullish(),
  complejo_id: idSchema,
});

async function validarRefs(d: Record<string, unknown>, user: Parameters<typeof scopeComplejos>[0]) {
  if (d.complejo_id != null) await assertRef(prisma.complejoHabitacional, d.complejo_id as number, scopeComplejos(user), 'complejo_id');
  if (d.padre_id != null) await assertRef(prisma.estructura, d.padre_id as number, scopeEstructuras(user), 'padre_id');
  return d;
}

export const estructurasRouter = crudRouter({
  entidad: 'estructura',
  delegate: prisma.estructura,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeEstructuras,
  search: ['nombre', 'tipo'],
  orderable: ['id', 'nombre', 'tipo'],
  defaultOrder: { id: 'asc' },
  include: { complejo: { select: { id: true, nombre: true } } },
  filtros: {
    schema: z.object({ complejo_id: idSchema.optional() }),
    where: (f) => (f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}),
  },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: validarRefs,
  prepareUpdate: validarRefs,
});
