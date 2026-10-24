// Panel «docked» del asistente: ancho y estado abierto/cerrado (lógica pura, sin React). Se guardan por usuario en `localStorage`,
// siempre con try/catch: puede estar bloqueado y el panel debe funcionar igual.

export const ANCHO_MIN = 320; // 20rem
export const ANCHO_MAX = 640; // 40rem
export const ANCHO_DEFECTO = 384; // 24rem
/** Ancho de la barra lateral de la app (`lg:pl-64`) y mínimo que debe conservar el contenido para no quedar aplastado. */
const BARRA_LATERAL = 256;
const CONTENIDO_MIN = 480;
export const PASO_TECLADO = 16;

/** Deja el ancho dentro de [20rem, 40rem] y sin comerse el contenido: en pantallas justas el tope baja (nunca por debajo del mínimo). */
export function acotarAncho(px: unknown, viewport: number): number {
  const n = typeof px === 'number' && Number.isFinite(px) ? px : ANCHO_DEFECTO;
  const tope = Math.max(ANCHO_MIN, Math.min(ANCHO_MAX, viewport - BARRA_LATERAL - CONTENIDO_MIN));
  return Math.round(Math.min(tope, Math.max(ANCHO_MIN, n)));
}

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const almacenReal = (): Almacen | null => { try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; } };

export const claveAncho = (usuarioId: number) => `house:asistente:ancho:${usuarioId}`;
export const claveAbierto = (usuarioId: number) => `house:asistente:abierto:${usuarioId}`;

export function leerAncho(usuarioId: number, viewport: number, almacen: Almacen | null = almacenReal()): number {
  try { const t = almacen?.getItem(claveAncho(usuarioId)); return acotarAncho(t ? Number(t) : ANCHO_DEFECTO, viewport); } catch { return acotarAncho(ANCHO_DEFECTO, viewport); }
}
export function guardarAncho(usuarioId: number, px: number, almacen: Almacen | null = almacenReal()): void {
  try { almacen?.setItem(claveAncho(usuarioId), String(Math.round(px))); } catch { /* sin almacenamiento: vale mientras la pantalla esté abierta */ }
}
export function leerAbierto(usuarioId: number, almacen: Almacen | null = almacenReal()): boolean {
  try { return almacen?.getItem(claveAbierto(usuarioId)) === '1'; } catch { return false; }
}
export function guardarAbierto(usuarioId: number, abierto: boolean, almacen: Almacen | null = almacenReal()): void {
  try { almacen?.setItem(claveAbierto(usuarioId), abierto ? '1' : '0'); } catch { /* sin almacenamiento */ }
}
