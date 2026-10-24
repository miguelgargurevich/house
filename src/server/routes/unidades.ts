import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { scopeComplejos, scopeEstructuras, scopePisos, scopeUnidades, scopeUsuarios } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { idSchema, texto, textoOpcional, z } from '../validation';

const base = z.object({
  codigo: texto(60),
  tipo: texto(40),
  estructura_id: idSchema.nullish(),
  piso_id: idSchema.nullish(),
  complejo_id: idSchema,
  descripcion: textoOpcional(500),
  propietario_id: idSchema.nullish(),
  inquilino_id: idSchema.nullish(),
  estado: texto(30).optional(),
});

async function validarRefs(d: Record<string, unknown>, user: AuthUser) {
  const out = { ...d };
  if (d.complejo_id != null) {
    const complejo = await assertRef(prisma.complejoHabitacional, d.complejo_id as number, scopeComplejos(user), 'complejo_id');
    // La empresa de la unidad siempre es la de su complejo: no se acepta del cliente.
    out.empresa_id = complejo!.empresa_id;
  }
  if (d.estructura_id != null) await assertRef(prisma.estructura, d.estructura_id as number, scopeEstructuras(user), 'estructura_id');
  if (d.piso_id != null) await assertRef(prisma.piso, d.piso_id as number, scopePisos(user), 'piso_id');
  if (d.propietario_id != null) await assertRef(prisma.usuario, d.propietario_id as number, scopeUsuarios(user), 'propietario_id', { rol: 'propietario' });
  if (d.inquilino_id != null) await assertRef(prisma.usuario, d.inquilino_id as number, scopeUsuarios(user), 'inquilino_id', { rol: 'inquilino' });
  return out;
}

export const unidadesRouter = crudRouter({
  entidad: 'unidad',
  delegate: prisma.unidad,
  // el personal sólo lee (alcance acotado en scopeUnidades)
  readRoles: ['admin', 'mantenimiento', 'seguridad', 'limpieza', 'jardineria'],
  writeRoles: ['admin'],
  scope: scopeUnidades,
  search: ['codigo', 'descripcion'],
  orderable: ['id', 'codigo', 'tipo', 'estado', 'created_at'],
  defaultOrder: { codigo: 'asc' },
  include: {
    propietario: { select: { id: true, nombre: true } },
    inquilino: { select: { id: true, nombre: true } },
    complejo: { select: { id: true, nombre: true } },
  },
  filtros: {
    schema: z.object({ complejo_id: idSchema.optional(), estado: z.string().max(30).optional(), propietario_id: idSchema.optional() }),
    where: (f) => ({
      ...(f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}),
      ...(f.estado ? { estado: f.estado } : {}),
      ...(f.propietario_id !== undefined ? { propietario_id: f.propietario_id } : {}),
    }),
  },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: validarRefs,
  prepareUpdate: validarRefs,
});
