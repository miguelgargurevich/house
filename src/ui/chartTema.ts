/** Colores de los gráficos: salen de las variables del tema (oklch) y se leen al dibujar, así el modo claro/oscuro los cambia. */

export const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();
export const color = (n: string, a = 1) => `oklch(${css(n)} / ${a})`;

export const esOscuro = () => document.documentElement.classList.contains('dark');

/** Colores del tema que un gráfico puede pedir por nombre. */
export type TokenGrafico = 'brand' | 'muted' | 'ok' | 'warn' | 'bad';

/**
 * Paleta de categorías (p. ej. un color por concepto del recibo). Mismo croma y luminosidad en todos los tonos, para que ninguno
 * «grite» más que otro; la luminosidad cambia con el tema para mantener ≥ 3:1 contra la superficie (claro: 0.55, oscuro: 0.74).
 * El último es un gris neutro: «Otros». Nunca es lo único que distingue una categoría: hay leyenda, tooltip y tabla accesible.
 */
const TONOS_CATEGORIA = [180, 250, 300, 75, 340, 135, 215] as const;
export const MAX_CATEGORIAS = TONOS_CATEGORIA.length;
/** Índice de la categoría «Otros» (gris). */
export const CATEGORIA_OTROS = -1;

export function colorCategoria(i: number, a = 1): string {
  const oscuro = esOscuro();
  if (i === CATEGORIA_OTROS || i >= TONOS_CATEGORIA.length) return `oklch(${oscuro ? 0.68 : 0.62} 0.02 175 / ${a})`;
  return `oklch(${oscuro ? 0.74 : 0.55} ${oscuro ? 0.11 : 0.12} ${TONOS_CATEGORIA[i]} / ${a})`;
}
