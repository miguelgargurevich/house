/**
 * Ícono de Torre (4-nov-2026, Miguel eligió la opción A): una torre con ventanas sobre el cuadro de marca. Reemplaza a la casa que quedó de cuando el
 * producto se llamaba House. El mismo dibujo vive en `public/favicon.svg`, en los PNG de instalar (`scripts/marketing/iconos-torre.py`) y en el cierre de
 * los videos: si cambias las medidas aquí, cámbialas allá.
 *
 * Usa los colores del tema (`fill-brand`, `on-brand`), así que toma el color de la marca propia de la empresa cuando está activa.
 */
export const TORRE_ICONO = {
  /** Contorno de la torre (en un cuadro de 32 × 32). */
  torre: { x: 10, y: 5.5, width: 12, height: 21, rx: 1.6 },
  /** Ventanas: dos columnas, tres pisos. */
  ventanas: [[13, 9.5], [16.8, 9.5], [13, 13.8], [16.8, 13.8], [13, 18.1], [16.8, 18.1]] as const,
  ventana: 2.2,
  /** Puerta, apoyada en la base. */
  puerta: { x: 14.6, y: 21.6, width: 2.8, height: 4.9 },
} as const;

export function IconoTorre({ className }: { className?: string }) {
  const { torre, ventanas, ventana, puerta } = TORRE_ICONO;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <rect {...torre} fill="none" className="stroke-on-brand" strokeWidth="2" />
      {ventanas.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={ventana} height={ventana} rx="0.4" className="fill-on-brand" />)}
      <rect {...puerta} className="fill-on-brand" />
    </svg>
  );
}
