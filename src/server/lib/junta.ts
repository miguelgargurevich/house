import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../middleware/auth';

export const CARGOS_JUNTA = ['presidente', 'tesorero', 'secretario', 'vocal'] as const;
export type CargoJunta = (typeof CARGOS_JUNTA)[number];

/** Sólo presidente y tesorero gestionan medios de pago y revisan comprobantes (la validación es de la administración; el tesorero da la conformidad); secretario y vocal no ganan permisos. */
const CARGOS_GESTORES: readonly string[] = ['presidente', 'tesorero'];

export interface AmbitoJunta {
  complejo_id: number;
  /** null = todo el condominio. */
  estructura_id: number | null;
}

/** Ámbito de la junta del usuario, o null si no es propietario con cargo de gestión y condominio definido. */
export function ambitoJunta(user: AuthUser): AmbitoJunta | null {
  if (user.rol !== 'propietario' || user.cargo_junta == null || !CARGOS_GESTORES.includes(user.cargo_junta) || user.complejo_id == null) return null;
  return { complejo_id: user.complejo_id, estructura_id: user.estructura_id ?? null };
}

export const esJunta = (user: AuthUser) => ambitoJunta(user) !== null;

/** La conformidad de un pago («llegó a la cuenta») la da sólo el TESORERO: ni el presidente ni el resto de la junta, ni la administración. */
export const esTesorero = (user: AuthUser) => ambitoJunta(user) !== null && user.cargo_junta === 'tesorero';

/**
 * ¿La junta del usuario gestiona algo de este condominio/block? Sólo evalúa a la junta (admin y superadmin se
 * resuelven por empresa en `lib/scope.ts`). Una junta de un block no alcanza lo del condominio entero (`estructura_id` null);
 * una junta sin block alcanza todos los blocks de su condominio.
 */
export function puedeGestionar(user: AuthUser, objetivo: { complejo_id: number | null; estructura_id: number | null }): boolean {
  const a = ambitoJunta(user);
  if (!a || objetivo.complejo_id !== a.complejo_id) return false;
  return a.estructura_id == null || objetivo.estructura_id === a.estructura_id;
}

/** Mismo criterio que `puedeGestionar`, como filtro Prisma para modelos con `complejo_id` y `estructura_id` (unidades, medios de pago). */
export function filtroAmbito(a: AmbitoJunta): { complejo_id: number; estructura_id?: number } {
  return a.estructura_id == null ? { complejo_id: a.complejo_id } : { complejo_id: a.complejo_id, estructura_id: a.estructura_id };
}

/**
 * Recibos que alcanza la junta: cada torre tiene su propio recibo, así que la junta de un block sólo ve los de SU block (el de otra torre
 * es 404) más los recibos del condominio sin torre (generales o viejos que mezclan torres: ahí la lista de departamentos ya se acota a sus
 * unidades). Una junta sin block ve todos los del condominio.
 */
export function filtroReciboAmbito(a: AmbitoJunta): Prisma.ReciboWhereInput {
  return a.estructura_id == null
    ? { complejo_id: a.complejo_id }
    : { complejo_id: a.complejo_id, OR: [{ estructura_id: a.estructura_id }, { estructura_id: null }] };
}
