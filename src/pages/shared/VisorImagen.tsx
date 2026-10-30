import { useEffect, useRef, useState } from 'react';
import { ArrowsPointingInIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { IconButton } from '../../ui';

/** Niveles de zoom: 1 = la imagen entera en la pantalla; desde 2, el ancho de la imagen en veces el ancho de la pantalla. */
export const ZOOMS = [1, 1.5, 2, 3, 4] as const;

/**
 * Visor a pantalla completa para leer bien una imagen (el voucher): acercar y alejar, clic en la imagen para alternar, y desplazarse
 * por ella. Es un <dialog> propio, así se abre encima de otro modal; Esc o la X lo cierran.
 */
export function VisorImagen({ src, alt, open, onClose }: { src: string; alt: string; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [nivel, setNivel] = useState(0);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setNivel(0); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  const zoom = ZOOMS[nivel]!;
  const ajustada = zoom === 1;

  return (
    <dialog
      ref={ref}
      // React hace «burbujear» el close por el árbol de componentes: sin esto, cerrar el visor cerraría también el modal de abajo.
      onClose={e => { e.stopPropagation(); onClose(); }}
      aria-label={`${alt} (ampliada)`}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-[oklch(0.15_0.02_175/0.94)] p-0 text-white backdrop:bg-transparent"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-end gap-1 p-2 [&_button]:text-white [&_button:hover]:bg-white/15 [&_button:hover]:text-white">
            <span className="mr-auto pl-2 text-sm tabular-nums text-white/80" aria-live="polite">{ajustada ? 'Ajustada a la pantalla' : `${Math.round(zoom * 100)} %`}</span>
            <IconButton label="Alejar" disabled={nivel === 0} onClick={() => setNivel(n => Math.max(0, n - 1))}><MagnifyingGlassMinusIcon className="h-5 w-5" /></IconButton>
            <IconButton label="Acercar" disabled={nivel === ZOOMS.length - 1} onClick={() => setNivel(n => Math.min(ZOOMS.length - 1, n + 1))}><MagnifyingGlassPlusIcon className="h-5 w-5" /></IconButton>
            <IconButton label="Ajustar a la pantalla" disabled={ajustada} onClick={() => setNivel(0)}><ArrowsPointingInIcon className="h-5 w-5" /></IconButton>
            <IconButton label="Cerrar" onClick={onClose}><XMarkIcon className="h-6 w-6" /></IconButton>
          </div>
          <div className={`min-h-0 flex-1 overflow-auto overscroll-contain ${ajustada ? 'flex items-center justify-center p-2' : ''}`}>
            <img
              src={src}
              alt={alt}
              onClick={() => setNivel(n => (n === 0 ? 2 : 0))}
              style={ajustada ? undefined : { width: `${zoom * 100}%` }}
              className={ajustada ? 'max-h-full max-w-full cursor-zoom-in object-contain' : 'h-auto max-w-none cursor-zoom-out'}
            />
          </div>
        </div>
      )}
    </dialog>
  );
}
