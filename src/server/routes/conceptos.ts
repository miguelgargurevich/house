import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid } from '../errors';
import { empresaDe, scopeConceptos } from '../lib/scope';
import { boolQuery, idSchema, texto, textoOpcional, z } from '../validation';

const base = z.object({
  nombre: texto(120),
  descripcion: textoOpcional(500),
  tipo_monto: z.enum(['fijo', 'variable'], { error: 'tipo_monto debe ser fijo o variable' }).optional(),
  activo: z.boolean().optional(),
  empresa_id: idSchema.nullish(),
});

async function empresa(d: Record<string, unknown>, u: Parameters<typeof empresaDe>[0], crear: boolean) {
  if (u.rol === 'admin') return { ...d, empresa_id: empresaDe(u) };
  if (d.empresa_id != null) await assertRef(prisma.empresaAdministradora, d.empresa_id as number, {}, 'empresa_id');
  else if (crear) throw invalid('Datos inválidos: empresa_id: es obligatorio', { empresa_id: 'Obligatorio' });
  return d;
}

export const conceptosRouter = crudRouter({
  entidad: 'concepto',
  delegate: prisma.concepto,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeConceptos,
  search: ['nombre', 'descripcion'],
  orderable: ['id', 'nombre', 'tipo_monto'],
  defaultOrder: { nombre: 'asc' },
  filtros: {
    schema: z.object({ activo: boolQuery.optional() }),
    where: (f) => (f.activo !== undefined ? { activo: f.activo } : {}),
  },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: (d, u) => empresa(d, u, true),
  prepareUpdate: (d, u) => empresa(d, u, false),
});
