/** Alto útil (mm) de la hoja A4 horizontal con márgenes de 8 mm, menos el título y el encabezado de la tabla. */
const ALTO_FILAS_MM = 142;
/** Alto de una fila (mm) por punto de letra: interlineado 1.1 y 0.15 mm de relleno arriba y abajo y el borde (medido con Chrome). */
const MM_POR_PUNTO = 0.388;
const RELLENO_MM = 0.36;

/**
 * Tamaño de letra (pt) del consolidado impreso para que los `filas` departamentos (más la fila de TOTALES) entren en UNA hoja A4 horizontal:
 * 9 pt hasta donde alcance y, con muchas filas, se achica hasta 5.5 pt (de ahí en adelante la tabla sigue en otra hoja, con el encabezado repetido).
 */
export function letraConsolidadoPt(filas: number): number {
  const porFila = ALTO_FILAS_MM / (Math.max(0, filas) + 1);
  const pt = (porFila - RELLENO_MM) / MM_POR_PUNTO;
  return Math.min(9, Math.max(5.5, Math.floor(pt * 2) / 2));
}
