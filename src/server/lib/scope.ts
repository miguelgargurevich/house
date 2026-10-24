import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../middleware/auth';
import { ROLES_RESIDENTE } from '../config';
import { forbidden } from '../errors';
import { noPagado } from './cargos';
import { ambitoJunta, filtroAmbito } from './junta';

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

/**
 * Recibos de la empresa. Un recibo guarda la empresa que lo EMITIÓ: esa empresa lo sigue viendo aunque ya no administre el
 * condominio (consulta). La empresa que administra el condominio HOY ve además los recibos de la anterior mientras tengan deuda
 * por cobrar (es quien debe cobrarla). Lo ya cobrado de una administradora anterior no le llega a la nueva.
 */
const reciboDeEmpresa = (e: number): Prisma.ReciboWhereInput => ({
  OR: [
    { empresa_id: e },
    { complejo: { empresa_id: e }, reciboConceptos: { some: { reciboConceptoUnidades: { some: noPagado } } } },
  ],
});

/** Escritura: sólo quien administra el condominio hoy puede modificar (y cobrar) un recibo; la anterior administradora sólo lo consulta. */
const reciboEscribible = (e: number): Prisma.ReciboWhereInput => ({ complejo: { empresa_id: e } });

export const scopeRecibos = (u: AuthUser): Prisma.ReciboWhereInput => (esGlobal(u) ? {} : reciboDeEmpresa(empresaDe(u)));
export const scopeRecibosEscritura = (u: AuthUser): Prisma.ReciboWhereInput => (esGlobal(u) ? {} : { AND: [reciboDeEmpresa(empresaDe(u)), reciboEscribible(empresaDe(u))] });

export const scopeReciboConceptos = (u: AuthUser): Prisma.ReciboConceptoWhereInput => (esGlobal(u) ? {} : { recibo: reciboDeEmpresa(empresaDe(u)) });
export const scopeReciboConceptosEscritura = (u: AuthUser): Prisma.ReciboConceptoWhereInput => (esGlobal(u) ? {} : { recibo: scopeRecibosEscritura(u) });

export const scopeCargos = (u: AuthUser): Prisma.ReciboConceptoUnidadWhereInput => (esGlobal(u) ? {} : { reciboConcepto: { recibo: reciboDeEmpresa(empresaDe(u)) } });
export const scopeCargosEscritura = (u: AuthUser): Prisma.ReciboConceptoUnidadWhereInput => (esGlobal(u) ? {} : { reciboConcepto: { recibo: scopeRecibosEscritura(u) } });

export const scopePagos = (u: AuthUser): Prisma.PagoWhereInput => (esGlobal(u) ? {} : { reciboConceptoUnidad: { reciboConcepto: { recibo: reciboDeEmpresa(empresaDe(u)) } } });
export const scopePagosEscritura = (u: AuthUser): Prisma.PagoWhereInput => (esGlobal(u) ? {} : { reciboConceptoUnidad: { reciboConcepto: { recibo: scopeRecibosEscritura(u) } } });

/** Unidades: admin = su empresa; seguridad = su complejo; mantenimiento, limpieza y jardinería = unidades de sus tareas. */
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
    case 'limpieza':
    case 'jardineria':
      return { tareasMantenimiento: { some: { asignado_id: u.id } } };
    default:
      throw forbidden();
  }
}

/**
 * Usuarios de la empresa: el PERSONAL con empresa propia (`empresa_id`) y los RESIDENTES de sus condominios (los dueños e inquilinos
 * llegan por su condominio o por sus unidades: no tienen empresa). El personal de otra empresa nunca entra aunque haya trabajado en
 * un condominio suyo. Nunca superadmins.
 */
export function scopeUsuarios(u: AuthUser): Prisma.UsuarioWhereInput {
  if (esGlobal(u)) return {};
  const e = empresaDe(u);
  const unidadSuya: Prisma.UnidadWhereInput = { OR: [{ empresa_id: e }, { complejo: { empresa_id: e } }] };
  return {
    rol: { not: 'superadmin' },
    OR: [
      { empresa_id: e, rol: { notIn: [...ROLES_RESIDENTE] } },
      { rol: { in: [...ROLES_RESIDENTE] }, OR: [{ complejo: { empresa_id: e } }, { unidades: { some: unidadSuya } }, { unidadesInquilino: { some: unidadSuya } }] },
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
      return { OR: [{ unidad: { empresa_id: e } }, { asignado: { empresa_id: e } }, { creado_por: { empresa_id: e } }, { proveedor: { empresa_id: e } }] };
    }
    case 'mantenimiento':
    case 'limpieza':
    case 'jardineria':
      return { asignado_id: u.id };
    default:
      throw forbidden();
  }
}

/** Proveedores: cada administradora ve sólo los suyos (directorio propio). */
export const scopeProveedores = (u: AuthUser): Prisma.ProveedorWhereInput => (esGlobal(u) ? {} : { empresa_id: empresaDe(u) });

/** Pagos de las unidades del ámbito de la junta del usuario (presidente/tesorero). Otros usuarios → 403. */
export function scopePagosJunta(u: AuthUser): Prisma.PagoWhereInput {
  const a = ambitoJunta(u);
  if (!a) throw forbidden();
  return { reciboConceptoUnidad: { unidad: filtroAmbito(a) } };
}

/** Medios de pago: admin = su empresa; junta = su ámbito. Cualquier otro rol → 403. */
export function scopeMediosPago(u: AuthUser): Prisma.MedioPagoWhereInput {
  if (esGlobal(u)) return {};
  if (u.rol === 'admin') return { complejo: { empresa_id: empresaDe(u) } };
  const a = ambitoJunta(u);
  if (!a) throw forbidden();
  return filtroAmbito(a);
}
