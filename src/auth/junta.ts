import type { CargoJunta, Rol } from './AuthContext';

/** Presidente y tesorero gestionan los medios de pago y validan comprobantes de su block; secretario y vocal no ganan permisos. */
export const esJunta = (u: { rol: Rol; cargo_junta?: CargoJunta | null; complejo_id?: number | null } | null | undefined): boolean =>
  u?.rol === 'propietario' && (u.cargo_junta === 'presidente' || u.cargo_junta === 'tesorero') && u.complejo_id != null;
