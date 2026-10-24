/** Lógica pura de accesibilidad del kit (sin React ni DOM real), para poder probarla con node:test. */

/** Índice de la pestaña a la que mueven las teclas del patrón WAI-ARIA (flechas circulares, Home, End); `null` si la tecla no navega. */
export function moverTab(key: string, actual: number, total: number): number | null {
  if (total <= 0) return null;
  switch (key) {
    case 'ArrowRight': return (actual + 1) % total;
    case 'ArrowLeft': return (actual - 1 + total) % total;
    case 'Home': return 0;
    case 'End': return total - 1;
    default: return null;
  }
}

/** Controles que, dentro de una fila clicable, conservan su propia acción. */
const INTERACTIVOS = 'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="menuitem"],[role="checkbox"],[data-no-row-click]';

interface NodoConClosest { closest?: (selector: string) => unknown }

/** ¿El evento viene de un botón/enlace/campo DENTRO de la fila (y no de la fila misma)? Entonces la fila no debe activarse. */
export function vieneDeControlInterno(target: unknown, fila: unknown): boolean {
  const t = target as NodoConClosest | null;
  if (!t || typeof t.closest !== 'function' || target === fila) return false;
  const control = t.closest(INTERACTIVOS);
  return !!control && control !== fila;
}

/** Enter y Espacio activan la fila; el resto de teclas no. */
export const esTeclaDeActivar = (key: string) => key === 'Enter' || key === ' ';

/** Porcentaje 0–100 de `valor` sobre `max`, acotado (0 si `max` no es válido). */
export function porcentaje(valor: number, max: number): number {
  const v = Number(valor);
  if (!Number.isFinite(v) || !(max > 0)) return 0;
  return Math.min(100, Math.max(0, (v / max) * 100));
}
