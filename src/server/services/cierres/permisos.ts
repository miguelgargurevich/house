import type { AuthUser } from '../../middleware/auth';
import { ambitoJunta } from '../../lib/junta';

const esAdministracion = (u: AuthUser) => u.rol === 'admin' || u.rol === 'superadmin';

/** Tesorero de la Junta central: cargo tesorero sin block (todo su condominio). Es quien confirma lo que llega de cada block a la Junta central. */
export function esTesoreroCentral(u: AuthUser, complejoId?: number): boolean {
  const a = ambitoJunta(u);
  return a !== null && u.cargo_junta === 'tesorero' && a.estructura_id == null && (complejoId === undefined || a.complejo_id === complejoId);
}

/** Presidente o tesorero de la Junta central (sin block): ve los aportes de los blocks. */
export function esJuntaCentral(u: AuthUser, complejoId?: number): boolean {
  const a = ambitoJunta(u);
  return a !== null && a.estructura_id == null && (complejoId === undefined || a.complejo_id === complejoId);
}

/** Registra los pagos de un block la administración o el TESORERO de ESE block. El presidente lo ve; el tesorero central no registra por los blocks. */
export function puedeRegistrar(u: AuthUser, block: { id: number; complejo_id: number | null }): boolean {
  if (esAdministracion(u)) return true;
  const a = ambitoJunta(u);
  return a !== null && u.cargo_junta === 'tesorero' && a.estructura_id === block.id && a.complejo_id === block.complejo_id;
}

/**
 * ¿Puede dar la conformidad de una línea? El pago a la EMPRESA ADMINISTRADORA lo confirma la administración; el aporte a la JUNTA CENTRAL, su tesorero central.
 * Servicios y proveedores no llevan conformidad. (Que no sea su propio registro se revisa aparte.)
 */
export function puedeDarConformidad(u: AuthUser, destino: string, complejoId: number): boolean {
  if (destino === 'administradora') return esAdministracion(u);
  if (destino === 'central') return esTesoreroCentral(u, complejoId);
  return false;
}

export { esAdministracion };
