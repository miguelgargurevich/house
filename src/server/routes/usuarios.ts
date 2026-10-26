import bcrypt from 'bcrypt';
import { BCRYPT_COST, ROLES_PERSONAL, ROLES_RESIDENTE } from '../config';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { forbidden, invalid } from '../errors';
import { filtroEstadoCargo } from '../lib/cargos';
import { CARGOS_JUNTA } from '../lib/junta';
import { empresaDe, scopeComplejos, scopeEstructuras, scopeUnidades, scopeUsuarios } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { revocarDeUsuario } from '../services/sesiones';
import { contrasenaIgualACorreo, emailSchema, idSchema, MENSAJE_PASSWORD_CORREO, passwordSchema, rolSchema, telefonoSchema, texto, z } from '../validation';

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
const createSchema = base.extend({
  password: passwordSchema,
  /** Sólo al crear un residente: la unidad de la que es propietario o inquilino (según su rol). */
  unidad_id: idSchema.nullish(),
}).refine((v) => !contrasenaIgualACorreo(v.password, v.email), { path: ['password'], message: MENSAJE_PASSWORD_CORREO });
const updateSchema = base
  .partial()
  .extend({ password: passwordSchema.optional(), unidad_id: idSchema.nullish() })
  .refine((v) => !v.password || !v.email || !contrasenaIgualACorreo(v.password, v.email), { path: ['password'], message: MENSAJE_PASSWORD_CORREO });

type UnidadResidente = { id: number; codigo: string; complejo: { id: number; nombre: string } | null; estructura: { id: number; nombre: string | null } | null };
const unidadFila = (u: UnidadResidente) => ({ id: u.id, codigo: u.codigo, complejo: u.complejo, estructura: u.estructura });

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
  const out = { ...data } as Record<string, unknown> & { password?: string; unidad_id?: number | null; rol?: string; empresa_id?: number | null; complejo_id?: number | null; cargo_junta?: string | null; estructura_id?: number | null };

  if (user.rol === 'admin') {
    if (out.rol === 'superadmin') throw forbidden('No puedes crear ni ascender usuarios a superadmin');
    out.empresa_id = empresaDe(user);
    if (existing && existing.id === user.id && out.rol !== undefined && out.rol !== existing.rol) {
      throw forbidden('No puedes cambiar tu propio rol');
    }
  } else if (out.rol === 'admin' && !existing && out.empresa_id == null) {
    throw invalid('Datos inválidos: empresa_id: un administrador debe pertenecer a una empresa', { empresa_id: 'Obligatorio para administradores' });
  }
  // La empresa es del PERSONAL (para quién trabaja y base de su alcance). Un propietario o inquilino no tiene empresa propia:
  // es la del condominio de sus unidades. Se guarda null al crear, al cambiar el rol a residente y al editar a un residente.
  const rolFinal = (out.rol !== undefined ? out.rol : existing?.rol) as string | null | undefined;
  if (rolFinal === 'propietario' || rolFinal === 'inquilino') {
    out.empresa_id = null;
    // Sin empresa propia, al residente la administración lo alcanza por su condominio o por sus unidades: un residente nuevo debe nacer con condominio.
    if (!existing && user.rol === 'admin' && out.complejo_id == null) {
      throw invalid('Datos inválidos: complejo_id: elige el condominio del residente', { complejo_id: 'Elige el condominio' });
    }
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
  // Al crear o editar un residente se le puede dar su departamento (propietario o inquilino de esa unidad, libre, del condominio elegido).
  if (out.unidad_id != null) {
    if (rolFinal !== 'propietario' && rolFinal !== 'inquilino') throw invalid('Datos inválidos: unidad_id: sólo un propietario o inquilino tiene departamento', { unidad_id: 'Sólo para residentes' });
    const campo = rolFinal === 'propietario' ? 'propietario_id' : 'inquilino_id';
    // El condominio sale de la unidad: si no viene en el cuerpo, se toma el de la unidad (la ficha puede estar vacía).
    const unidad = await assertRef(prisma.unidad, out.unidad_id, scopeUnidades(user), 'unidad_id', out.complejo_id != null ? { complejo_id: out.complejo_id } : {});
    const dueno = unidad![campo] as number | null;
    if (dueno != null && dueno !== existing?.id) {
      throw invalid(`Datos inválidos: unidad_id: la unidad ya tiene ${rolFinal === 'propietario' ? 'propietario' : 'inquilino'}`, { unidad_id: `Ya tiene ${rolFinal}` });
    }
    if (out.complejo_id == null && unidad!.complejo_id != null) out.complejo_id = unidad!.complejo_id;
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
  include: { empresa: { select: { id: true, nombre: true } }, complejo: { select: { id: true, nombre: true } } },
  // Un residente no tiene empresa: se muestra por sus unidades (condominio · block · departamento) y si está en mora.
  format: async (items) => {
    const residentes = items.filter((u) => u.rol === 'propietario' || u.rol === 'inquilino').map((u) => u.id as number);
    const mapa = new Map<number, ReturnType<typeof unidadFila>[]>();
    const morosas = new Set<number>();
    if (residentes.length) {
      const unidades = await prisma.unidad.findMany({
        where: { OR: [{ propietario_id: { in: residentes } }, { inquilino_id: { in: residentes } }] },
        orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
        select: { id: true, codigo: true, propietario_id: true, inquilino_id: true, complejo: { select: { id: true, nombre: true } }, estructura: { select: { id: true, nombre: true } } },
      });
      for (const un of unidades) for (const id of [un.propietario_id, un.inquilino_id]) if (id != null && residentes.includes(id)) mapa.set(id, [...(mapa.get(id) ?? []), unidadFila(un)]);
      const vencidas = await prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [{ unidad_id: { in: unidades.map((x) => x.id) } }, filtroEstadoCargo('vencido')] } });
      for (const v of vencidas) if (v.unidad_id != null) morosas.add(v.unidad_id);
    }
    return items.map((u) => {
      if (u.rol !== 'propietario' && u.rol !== 'inquilino') return u;
      const unidades = mapa.get(u.id as number) ?? [];
      return { ...u, unidades, moroso: unidades.some((x) => morosas.has(x.id)) };
    });
  },
  filtros: {
    schema: z.object({
      rol: rolSchema.optional(),
      empresa_id: idSchema.optional(),
      /** residente = propietarios e inquilinos; personal = el que trabaja para una empresa; superadmin. */
      tipo: z.enum(['residente', 'personal', 'superadmin'], { error: 'tipo debe ser: residente, personal, superadmin' }).optional(),
      complejo_id: idSchema.optional(),
      estructura_id: idSchema.optional(),
      estado: z.enum(['moroso', 'al_dia'], { error: 'estado debe ser: moroso, al_dia' }).optional(),
    }),
    where: (f, user) => {
      const and: Record<string, unknown>[] = [];
      if (f.rol) and.push({ rol: f.rol });
      if (f.tipo === 'residente') and.push({ rol: { in: [...ROLES_RESIDENTE] } });
      if (f.tipo === 'personal') and.push({ rol: { in: [...ROLES_PERSONAL] } });
      if (f.tipo === 'superadmin') and.push({ rol: 'superadmin' });
      if (f.empresa_id !== undefined) {
        // Un admin sólo ve su empresa: filtrar por otra empresa no devuelve nada, no es un error que revele existencia.
        and.push({ empresa_id: user.rol === 'superadmin' ? f.empresa_id : f.empresa_id === user.empresa_id ? f.empresa_id : -1 });
      }
      // Condominio: el del residente (por su ficha o por sus unidades) o donde trabaja el personal.
      if (f.complejo_id !== undefined) {
        const enUnidad = { complejo_id: f.complejo_id, ...(f.estructura_id !== undefined ? { estructura_id: f.estructura_id } : {}) };
        and.push(f.estructura_id !== undefined ? { OR: [{ unidades: { some: enUnidad } }, { unidadesInquilino: { some: enUnidad } }] } : { OR: [{ complejo_id: f.complejo_id }, { unidades: { some: enUnidad } }, { unidadesInquilino: { some: enUnidad } }] });
      } else if (f.estructura_id !== undefined) {
        and.push({ OR: [{ unidades: { some: { estructura_id: f.estructura_id } } }, { unidadesInquilino: { some: { estructura_id: f.estructura_id } } }] });
      }
      if (f.estado) {
        const enMora = { reciboConceptoUnidades: { some: filtroEstadoCargo('vencido') } };
        const moroso = { OR: [{ unidades: { some: enMora } }, { unidadesInquilino: { some: enMora } }] };
        and.push({ rol: { in: [...ROLES_RESIDENTE] } }, f.estado === 'moroso' ? moroso : { NOT: moroso });
      }
      return and.length ? { AND: and } : {};
    },
  },
  createSchema,
  updateSchema,
  prepareCreate: (d, u) => normalizar(d, u),
  create: async (data) => {
    const { unidad_id, ...datos } = data as { unidad_id?: number | null } & Record<string, unknown>;
    return prisma.$transaction(async (tx) => {
      const creado = await tx.usuario.create({ data: datos as never });
      if (unidad_id != null) await tx.unidad.update({ where: { id: unidad_id }, data: { [datos.rol === 'propietario' ? 'propietario_id' : 'inquilino_id']: creado.id } });
      return creado;
    });
  },
  prepareUpdate: (d, u, e) => normalizar(d, u, e),
  // El departamento (unidad) no es una columna del usuario: es el propietario/inquilino de la unidad. Por eso el update
  // va en transacción: primero suelta el departamento anterior, luego toma el nuevo.
  update: async (data, existing, user) => {
    const { unidad_id, ...datos } = data as { unidad_id?: number | null } & Record<string, unknown>;
    const id = existing.id as number;
    const rolNuevo = (datos.rol ?? existing.rol) as string | null | undefined;
    const rolViejo = existing.rol as string | null | undefined;
    const campoNuevo = rolNuevo === 'inquilino' ? 'inquilino_id' : rolNuevo === 'propietario' ? 'propietario_id' : null;
    const campoViejo = rolViejo === 'inquilino' ? 'inquilino_id' : rolViejo === 'propietario' ? 'propietario_id' : null;
    // Un residente puede tener unidades en condominios de otra administradora: sólo se sueltan o reasignan las que quien edita alcanza.
    const alcance = scopeUnidades(user);
    return prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id }, data: datos as never });
      if (unidad_id !== undefined && campoNuevo) {
        // El departamento anterior (del rol viejo) se suelta; el nuevo se toma.
        if (campoViejo && campoViejo !== campoNuevo) await tx.unidad.updateMany({ where: { AND: [{ [campoViejo]: id }, alcance] }, data: { [campoViejo]: null } as never });
        await tx.unidad.updateMany({ where: { AND: [{ [campoNuevo]: id, ...(unidad_id != null ? { id: { not: unidad_id } } : {}) }, alcance] }, data: { [campoNuevo]: null } as never });
        if (unidad_id != null) await tx.unidad.update({ where: { id: unidad_id }, data: { [campoNuevo]: id } as never });
      } else if (unidad_id === undefined && campoViejo && campoNuevo && campoViejo !== campoNuevo) {
        // Cambió de rol (propietario ↔ inquilino) sin cambiar de departamento: la misma unidad cambia de dueño.
        const suyas = await tx.unidad.findMany({ where: { AND: [{ [campoViejo]: id }, alcance] }, select: { id: true } });
        for (const u of suyas) await tx.unidad.update({ where: { id: u.id }, data: { [campoViejo]: null, [campoNuevo]: id } as never });
      }
      return tx.usuario.findUniqueOrThrow({ where: { id } });
    });
  },
  // Cambiar el rol o la contraseña de alguien cierra sus sesiones abiertas (borrar al usuario las elimina por cascada).
  afterUpdate: async (e, d) => {
    const cambia = (k: string) => d[k] !== undefined && d[k] !== e[k];
    if (cambia('rol') || cambia('cargo_junta') || cambia('complejo_id') || cambia('estructura_id') || d.password_hash !== undefined) await revocarDeUsuario(e.id as number);
  },
  beforeDelete: (e, u) => {
    if (e.id === u.id) throw invalid('No puedes eliminar tu propia cuenta');
  },
});
