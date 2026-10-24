import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { ANCHO_MAX, ANCHO_MIN, PASO_TECLADO } from './panel';

interface Props {
  ancho: number;
  onMover: (px: number) => void;
  onConfirmar: (px: number) => void;
  onRestablecer: () => void;
  onArrastrando: (v: boolean) => void;
}

/** Borde izquierdo del panel: se arrastra con el puntero, se ajusta con ← → (Inicio/Fin = mínimo/máximo) y el doble clic lo restablece. */
export function AsaDeAncho({ ancho, onMover, onConfirmar, onRestablecer, onArrastrando }: Props) {
  const inicio = useRef<{ x: number; ancho: number } | null>(null);
  const ultimo = useRef(ancho);
  ultimo.current = ancho;

  const bajar = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = { x: e.clientX, ancho };
    onArrastrando(true);
  };
  // El panel va a la derecha: arrastrar hacia la izquierda lo ensancha.
  const mover = (e: PointerEvent<HTMLDivElement>) => { if (inicio.current) onMover(inicio.current.ancho + (inicio.current.x - e.clientX)); };
  const soltar = (e: PointerEvent<HTMLDivElement>) => {
    if (!inicio.current) return;
    inicio.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onArrastrando(false);
    onConfirmar(ultimo.current);
  };
  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    const salto = e.shiftKey ? PASO_TECLADO * 4 : PASO_TECLADO;
    const siguiente = e.key === 'ArrowLeft' ? ancho + salto : e.key === 'ArrowRight' ? ancho - salto : e.key === 'Home' ? ANCHO_MIN : e.key === 'End' ? ANCHO_MAX : null;
    if (siguiente === null) return;
    e.preventDefault();
    onConfirmar(siguiente);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho del asistente"
      aria-valuemin={ANCHO_MIN}
      aria-valuemax={ANCHO_MAX}
      aria-valuenow={ancho}
      tabIndex={0}
      onPointerDown={bajar}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      onKeyDown={teclas}
      onDoubleClick={onRestablecer}
      className="group absolute inset-y-0 left-0 z-30 hidden w-2 cursor-col-resize touch-none select-none lg:block"
    >
      <span className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors duration-150 group-hover:w-0.5 group-hover:bg-brand/60 group-focus-visible:w-0.5 group-focus-visible:bg-brand" />
    </div>
  );
}
