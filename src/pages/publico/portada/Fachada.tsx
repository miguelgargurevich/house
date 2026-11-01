// La forma de Torre: la fachada del logo (techo a dos aguas y cuerpo recto) con una ventana por departamento. Es el único motivo de la portada:
// enorme en el hero, de máscara en cada captura (`TECHO`) y de viñeta en las listas.

/** Recorte con el techo del logo para las capturas (CSS `clip-path`). */
export const TECHO = 'polygon(0 9%, 50% 0, 100% 9%, 100% 100%, 0 100%)';

const COLUMNAS = 5;
const FILAS = 13;
// Ventanas encendidas = departamentos que ya pagaron. Patrón fijo (no al azar): la fachada se ve igual en cada visita y en el HTML del servidor.
const encendida = (i: number) => (i * 7 + Math.floor(i / COLUMNAS)) % 10 < 7;

/** La fachada grande del hero. Las ventanas se encienden una tras otra al cargar (sólo opacidad; sin animación quedan encendidas). */
export function Fachada({ className }: { className?: string }) {
  const ventanas = Array.from({ length: COLUMNAS * FILAS }, (_, i) => i);
  return (
    <svg viewBox="0 0 600 1000" className={className} aria-hidden="true" preserveAspectRatio="xMidYMin meet">
      <path d="M40 1000V236L300 64l260 172v764z" className="fill-brand" />
      {ventanas.map((i) => {
        const x = 92 + (i % COLUMNAS) * 86;
        const y = 290 + Math.floor(i / COLUMNAS) * 62;
        return encendida(i)
          ? <rect key={i} x={x} y={y} width="56" height="38" rx="3" className="ventana fill-on-brand" style={{ animationDelay: `${300 + ((i * 37) % 23) * 70}ms` }} />
          : <rect key={i} x={x} y={y} width="56" height="38" rx="3" className="fill-brand-hover" />;
      })}
    </svg>
  );
}

/** El techo del logo a tamaño de texto: viñeta de las listas y marca del plan elegido. */
export function Techito({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M2 19V8l8-6 8 6v11z" fill="currentColor" />
    </svg>
  );
}
