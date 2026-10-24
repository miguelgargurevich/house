import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../middleware/auth';
import { forbidden } from '../errors';

/** Empresa del administrador; un admin sin empresa no puede operar (evita `empresa_id: null` = "todas las huérfanas"). */
export function empresaDe(user: AuthUser): number {
  if (user.empresa_id == null) throw forbidden('Tu usuario no tiene una empresa asignada');
  return user.empresa_id;
}

const esGlobal = (u: AuthUser) => u.rol === 'superadmin';

// Cada función devuelve el filtro Prisma que limita un recurso a la empresa del usuario ({} para superadmin).
export const scopeEmpresas = (u: AuthUser): Prisma.EmpresaAdministradoraWhereInput => (esGlobal(u) ? {} : { id: empresaDe(u) });

export const scopeComplejos = (u: AuthUser): Prisma.ComplejoHabitacionalWhereInput => (esGlobal(u) ? {} : { empresa_id: empresaDe(u) });

export const scopeEstructuras = (u: AuthUser): Prisma.EstructuraWhereInput => (esGlobal(u) ? {} : { complejo: { empresa_id: empresaDe(u) } });

export const scopePisos = (u: AuthUser): Prisma.PisoWhereInput => (esGlobal(u) ? {} : { estructura: { complejo: { empresa_id: empresaDe(u) } } });

export const scopeConceptos = (u: AuthUser): Prisma.ConceptoWhereInput => (esGlobal(u) ? {} : { empresa_id: empresaDe(u) });

export const scopeRecibos = (u: AuthUser): Prisma.ReciboWhereInput => (esGlobal(u) ? {} : { empresa_id: empresaDe(u) });

export const scopeReciboConceptos = (u: AuthUser): Prisma.ReciboConceptoWhereInput => (esGlobal(u) ? {} : { recibo: { empresa_id: empresaDe(u) } });

export const scopeCargos = (u: AuthUser): Prisma.ReciboConceptoUnidadWhereInput =>
  esGlobal(u) ? {} : { reciboConcepto: { recibo: { empresa_id: empresaDe(u) } } };

export const scopePagos = (u: AuthUser): Prisma.PagoWhereInput =>
  esGlobal(u) ? {} : { reciboConceptoUnidad: { reciboConcepto: { recibo: { empresa_id: empresaDe(u) } } } };

/** Unidades: admin = su empresa; seguridad = su complejo; mantenimiento = unidades de sus tareas. */
export function scopeUnidades(u: AuthUser): Prisma.UnidadWhereInput {
  switch (u.rol) {
    case 'superadmin':
      return {};
    case 'admin':
      return { OR: [{ empresa_id: empresaDe(u) }, { complejo: { empresa_id: empresaDe(u) } }] };
    case 'seguridad':
      if (u.complejo_id == null) throw forbidden('Tu usuario no tiene un complejo asignado');
      return { complejo_id: u.complejo_id };
    case 'mantenimiento':
      return { tareasMantenimiento: { some: { asignado_id: u.id } } };
    default:
      throw forbidden();
  }
}

/** Usuarios de la empresa: con empresa propia, de un complejo suyo, o dueños/inquilinos de sus unidades. Nunca superadmins. */
export function scopeUsuarios(u: AuthUser): Prisma.UsuarioWhereInput {
  if (esGlobal(u)) return {};
  const e = empresaDe(u);
  return {
    rol: { not: 'superadmin' },
    OR: [
      { empresa_id: e },
      { complejo: { empresa_id: e } },
      { unidades: { some: { empresa_id: e } } },
      { unidadesInquilino: { some: { empresa_id: e } } },
    ],
  };
}

/** Avisos de los usuarios de la empresa (mismo alcance que `scopeUsuarios`). */
export const scopeNotificaciones = (u: AuthUser): Prisma.NotificacionWhereInput => (esGlobal(u) ? {} : { usuario: scopeUsuarios(u) });

export function scopeTareas(u: AuthUser): Prisma.TareaMantenimientoWhereInput {
  switch (u.rol) {
    case 'superadmin':
      return {};
    case 'admin': {
      const e = empresaDe(u);
      return { OR: [{ unidad: { empresa_id: e } }, { asignado: { empresa_id: e } }, { creado_por: { empresa_id: e } }] };
    }
    case 'mantenimiento':
      return { asignado_id: u.id };
    default:
      throw forbidden();
  }
}
