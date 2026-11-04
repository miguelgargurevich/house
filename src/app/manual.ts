import type { Usuario } from '../auth/AuthContext';

/**
 * Sección del manual con videos donde empieza lo de cada rol (las anclas `#rol-<rol>` las pone `scripts/marketing/manual-con-videos.py`).
 * La junta es un propietario con cargo: va a «Junta» (y la Junta central, que no tiene block, a la suya). Superadmin: el inicio del manual.
 */
export function anclaDelManual(user: Pick<Usuario, 'rol' | 'cargo_junta' | 'estructura_id' | 'junta_unica'>): string {
  if (user.rol === 'superadmin') return '';
  if (user.rol === 'propietario' && user.cargo_junta) return user.estructura_id == null && !user.junta_unica ? 'rol-junta_central' : 'rol-junta';
  return `rol-${user.rol}`;
}

/** La dirección del manual abierta en la sección del rol. */
export function enlaceDelManual(url: string, user: Parameters<typeof anclaDelManual>[0]): string {
  const ancla = anclaDelManual(user);
  return ancla ? `${url.split('#')[0]}#${ancla}` : url;
}
