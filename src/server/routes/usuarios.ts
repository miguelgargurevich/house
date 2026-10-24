import bcrypt from 'bcrypt';
import { BCRYPT_COST } from '../config';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { forbidden, invalid } from '../errors';
import { CARGOS_JUNTA } from '../lib/junta';
import { empresaDe, scopeComplejos, scopeEstructuras, scopeUsuarios } from '../lib/scope';
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
  cargo_junta: z.enum(CARGOS_JUNTA, { error: `cargo_junta debe ser: ${CARGOS_JUNTA.join(', ')}` }).nullish(),
  estructura_id: idSchema.nullish(),
});
const createSchema = base.extend({ password: passwordSchema });
const updateSchema = base.partial().extend({ password: passwordSchema.optional() });

/**
 * Cargo en la junta: sólo lo asigna un admin/superadmin (este router ya lo exige), exige rol propietario y condominio,
 * y el block debe ser de ese condominio y de la empresa de quien lo asigna. Sin cargo no hay block; si el usuario deja de ser propietario pierde el cargo.
 */
async function normalizarJunta(out: Record<string, unknown> & { rol?: string; complejo_id?: number | null; cargo_junta?: string | null; estructura_id?: number | null }, user: AuthUser, existing?: Record<string, unknown>) {
  const toca = ['rol', 'complejo_id', 'cargo_junta', 'estructura_id'].some((k) => out[k] !== undefined);
  if (!toca) return;
  const rol = (out.rol !== undefined ? out.rol : existing?.rol) as string | null | undefined;
  const complejo = (out.complejo_id !== undefined ? out.complejo_id : existing?.complejo_id) as number | null | undefined;
  let cargo = (out.cargo_junta !== undefined ? out.cargo_junta : existing?.cargo_junta) as string | null | undefined;
  let estructura = (out.estructura_id !== undefined ? out.estructura_id : existing?.estructura_id) as number | null | undefined;
  if (rol !== 'propietario' && out.cargo_junta == null) { cargo = null; } // quien deja de ser propietario pierde el cargo
  if (cargo != null) {
    if (rol !== 'propietario') throw invalid('Datos inválidos: cargo_junta: solo un propietario puede tener cargo en la junta', { cargo_junta: 'Solo para propietarios' });
    if (complejo == null) throw invalid('Datos inválidos: complejo_id: un cargo en la junta exige un condominio', { complejo_id: 'Obligatorio con un cargo en la junta' });
  } else {
    estructura = null;
  }
  if (estructura != null) {
    await assertRef(prisma.estructura, estructura, scopeEstructuras(user), 'estructura_id', { complejo_id: complejo as number });
  }
  out.cargo_junta = cargo ?? null;
  out.estructura_id = estructura ?? null;
}

/** Reglas de tenant y de escalada de privilegios comunes a crear y editar. */
async function normalizar(data: Record<string, unknown>, user: AuthUser, existing?: Record<string, unknown>) {
  const out = { ...data } as Record<string, unknown> & { password?: string; rol?: string; empresa_id?: number | null; complejo_id?: number | null; cargo_junta?: string | null; estructura_id?: number | null };

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
  await normalizarJunta(out, user, existing);
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
    const cambia = (k: string) => d[k] !== undefined && d[k] !== e[k];
    if (cambia('rol') || cambia('cargo_junta') || cambia('complejo_id') || cambia('estructura_id') || d.password_hash !== undefined) await revocarDeUsuario(e.id as number);
  },
  beforeDelete: (e, u) => {
    if (e.id === u.id) throw invalid('No puedes eliminar tu propia cuenta');
  },
});
