import bcrypt from 'bcrypt';
import { BCRYPT_COST } from '../config';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { forbidden, invalid } from '../errors';
import { empresaDe, scopeComplejos, scopeUsuarios } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { revocarDeUsuario } from '../services/sesiones';
import { emailSchema, idSchema, passwordSchema, rolSchema, telefonoSchema, texto, z } from '../validation';

const base = z.object({
  nombre: texto(120),
  email: emailSchema,
  telefono: telefonoSchema,
  rol: rolSchema,
  empresa_id: idSchema.nullish(),
  complejo_id: idSchema.nullish(),
});
const createSchema = base.extend({ password: passwordSchema });
const updateSchema = base.partial().extend({ password: passwordSchema.optional() });

/** Reglas de tenant y de escalada de privilegios comunes a crear y editar. */
async function normalizar(data: Record<string, unknown>, user: AuthUser, existing?: Record<string, unknown>) {
  const out = { ...data } as Record<string, unknown> & { password?: string; rol?: string; empresa_id?: number | null; complejo_id?: number | null };

  if (user.rol === 'admin') {
    if (out.rol === 'superadmin') throw forbidden('No puedes crear ni ascender usuarios a superadmin');
    out.empresa_id = empresaDe(user);
    if (existing && existing.id === user.id && out.rol !== undefined && out.rol !== existing.rol) {
      throw forbidden('No puedes cambiar tu propio rol');
    }
  } else if (out.rol === 'admin' && !existing && out.empresa_id == null) {
    throw invalid('Datos inválidos: empresa_id: un administrador debe pertenecer a una empresa', { empresa_id: 'Obligatorio para administradores' });
  }

  if (out.complejo_id != null) {
    await assertRef(prisma.complejoHabitacional, out.complejo_id, scopeComplejos(user), 'complejo_id');
    if (out.empresa_id != null) {
      await assertRef(prisma.complejoHabitacional, out.complejo_id, {}, 'complejo_id', { empresa_id: out.empresa_id });
    }
  }
  if (out.empresa_id != null && user.rol === 'superadmin') {
    await assertRef(prisma.empresaAdministradora, out.empresa_id, {}, 'empresa_id');
  }
  if (out.password !== undefined) {
    out.password_hash = await bcrypt.hash(out.password, BCRYPT_COST);
    delete out.password;
  }
  return out;
}

export const usuariosRouter = crudRouter({
  entidad: 'usuario',
  delegate: prisma.usuario,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeUsuarios,
  search: ['nombre', 'email', 'telefono'],
  orderable: ['id', 'nombre', 'email', 'rol', 'created_at'],
  defaultOrder: { nombre: 'asc' },
  include: { empresa: { select: { id: true, nombre: true } } },
  filtros: {
    schema: z.object({ rol: rolSchema.optional(), empresa_id: idSchema.optional() }),
    where: (f, user) => {
      const w: Record<string, unknown> = {};
      if (f.rol) w.rol = f.rol;
      if (f.empresa_id !== undefined) {
        // Un admin sólo ve su empresa: filtrar por otra empresa no devuelve nada, no es un error que revele existencia.
        w.empresa_id = user.rol === 'superadmin' ? f.empresa_id : f.empresa_id === user.empresa_id ? f.empresa_id : -1;
      }
      return w;
    },
  },
  createSchema,
  updateSchema,
  prepareCreate: (d, u) => normalizar(d, u),
  prepareUpdate: (d, u, e) => normalizar(d, u, e),
  // Cambiar el rol o la contraseña de alguien cierra sus sesiones abiertas (borrar al usuario las elimina por cascada).
  afterUpdate: async (e, d) => {
    if ((d.rol !== undefined && d.rol !== e.rol) || d.password_hash !== undefined) await revocarDeUsuario(e.id as number);
  },
  beforeDelete: (e, u) => {
    if (e.id === u.id) throw invalid('No puedes eliminar tu propia cuenta');
  },
});
