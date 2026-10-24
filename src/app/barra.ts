// Barra lateral con modo compacto (riel de iconos): estado, ancho y atajo de teclado (lógica pura, sin React).
// El estado es global (no por usuario) y se guarda en `localStorage` siempre con try/catch: puede estar bloqueado y la barra debe funcionar igual.

/** Ancho de la barra expandida (`w-64`) y del riel de iconos, en px. Es la fuente única: el contenido y el asistente leen de aquí. */
export const BARRA_ANCHA = 256;
export const BARRA_RIEL = 64;

export const CLAVE_BARRA = 'house:menu:colapsado';

/** Ancho real de la barra en escritorio. */
export const anchoBarra = (colapsada: boolean): number => (colapsada ? BARRA_RIEL : BARRA_ANCHA);

type Almacen = Pick<Storage, 'getItem' | 'setItem'>;
const almacenReal = (): Almacen | null => { try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; } };

export function leerColapsada(almacen: Almacen | null = almacenReal()): boolean {
  try { return almacen?.getItem(CLAVE_BARRA) === '1'; } catch { return false; }
}
export function guardarColapsada(colapsada: boolean, almacen: Almacen | null = almacenReal()): void {
  try { almacen?.setItem(CLAVE_BARRA, colapsada ? '1' : '0'); } catch { /* sin almacenamiento: vale mientras la pantalla esté abierta */ }
}

interface NodoEditable { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null }

/** ¿El foco está en un campo donde se escribe? Ahí el atajo no debe activarse. */
export function enCampoDeTexto(target: unknown): boolean {
  const t = target as NodoEditable | null;
  if (!t || typeof t !== 'object') return false;
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  const rol = t.getAttribute?.('role');
  return rol === 'textbox' || rol === 'combobox' || rol === 'searchbox';
}

export interface TeclaEvento {
  key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean; defaultPrevented?: boolean; target?: unknown;
}

/** `[` solo, o Ctrl/Cmd+B; nunca dentro de un campo de texto, con otros modificadores ni al mantener la tecla. */
export function esAtajoMenu(e: TeclaEvento): boolean {
  if (e.defaultPrevented || e.repeat || e.altKey || e.shiftKey || enCampoDeTexto(e.target)) return false;
  const mando = !!(e.ctrlKey || e.metaKey);
  if (e.key === '[') return !mando;
  return mando && e.key.toLowerCase() === 'b';
}
