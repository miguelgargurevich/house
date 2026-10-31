import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { scopeEstructuras, scopePisos } from '../lib/scope';
import { idSchema, z } from '../validation';
import { complejoDeEstructura, exigirOperativo } from '../services/comercial/operativo';

const base = z.object({
  numero: z.number().int().min(-10).max(300).nullish(),
  estructura_id: idSchema,
});

export const pisosRouter = crudRouter({
  entidad: 'piso',
  delegate: prisma.piso,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopePisos,
  orderable: ['id', 'numero'],
  defaultOrder: { id: 'asc' },
  include: { estructura: { select: { id: true, nombre: true, complejo_id: true } } },
  filtros: {
    schema: z.object({ estructura_id: idSchema.optional() }),
    where: (f) => (f.estructura_id !== undefined ? { estructura_id: f.estructura_id } : {}),
  },
  createSchema: base,
  updateSchema: base.partial(),
  operativo: async (r, u) => exigirOperativo(await complejoDeEstructura(r.estructura_id as number | null), u),
  prepareCreate: async (d, u) => {
    await assertRef(prisma.estructura, d.estructura_id as number, scopeEstructuras(u), 'estructura_id');
    return d;
  },
  prepareUpdate: async (d, u) => {
    if (d.estructura_id != null) await assertRef(prisma.estructura, d.estructura_id as number, scopeEstructuras(u), 'estructura_id');
    return d;
  },
});
