// Lógica pura de los grupos plegables de la barra lateral (9-nov, Miguel: «agrupa el menú, así sueltos no se ve bien»;
// mismo patrón que el portal de dealers). Sin React, para probarla con node:test.

/** Clave en localStorage: los grupos que la persona dejó abiertos (por su rótulo: «Cobranza», «Operación»…). */
export const CLAVE_GRUPOS = 'house-menu-grupos';

interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void }
const almacen = (): Almacen | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** La entrada `to` está activa en `ruta` con la misma regla que NavLink: la ruta exacta o una pantalla debajo de ella. */
export function rutaDentro(ruta: string, to: string): boolean {
  return ruta === to || ruta.startsWith(to.endsWith('/') ? to : `${to}/`);
}

/** El grupo (con rótulo) que tiene la pantalla actual, o null. */
export function grupoActivo(grupos: { label?: string; items: { to: string }[] }[], ruta: string): string | null {
  for (const g of grupos) if (g.label && g.items.some(i => rutaDentro(ruta, i.to))) return g.label;
  return null;
}

/**
 * Un grupo se pliega sólo si tiene rótulo y más de una entrada: con una sola, la entrada sale suelta (como en dealers):
 * un grupo para abrir una sola cosa sería un clic de más.
 */
export function esPlegable(g: { label?: string; items: unknown[] }): boolean {
  return !!g.label && g.items.length > 1;
}

/**
 * Desplegado si se abrió a mano, o si es el de la pantalla actual y no se cerró a propósito: llegar a «Pagos» y no ver
 * dónde estás sería peor que el menú largo de antes.
 */
export function desplegado(grupo: string, abiertos: ReadonlySet<string>, activo: string | null, cerradoAMano: boolean): boolean {
  return abiertos.has(grupo) || (activo === grupo && !cerradoAMano);
}

export function leerAbiertos(a: Almacen | null = almacen()): Set<string> {
  try {
    const v: unknown = JSON.parse(a?.getItem(CLAVE_GRUPOS) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}

export function guardarAbiertos(abiertos: ReadonlySet<string>, a: Almacen | null = almacen()): void {
  try { a?.setItem(CLAVE_GRUPOS, JSON.stringify([...abiertos])); } catch { /* sin almacenamiento: no se recuerda, nada más */ }
}
