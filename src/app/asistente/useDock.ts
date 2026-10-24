import { useCallback, useEffect, useState } from 'react';
import { ANCHO_DEFECTO, acotarAncho, guardarAbierto, guardarAncho, leerAbierto, leerAncho } from './panel';

const ESCRITORIO = '(min-width: 1024px)';

/** ¿Hay sitio para el panel como columna (>= lg)? Si no, es una vista propia a pantalla completa. */
export function useEscritorio(): boolean {
  const [v, setV] = useState(() => window.matchMedia(ESCRITORIO).matches);
  useEffect(() => {
    const q = window.matchMedia(ESCRITORIO);
    const h = () => setV(q.matches);
    q.addEventListener('change', h);
    return () => q.removeEventListener('change', h);
  }, []);
  return v;
}

/**
 * Abierto/cerrado. En escritorio se recuerda por usuario; en el celular la vista a pantalla completa es pasajera (no se reabre al
 * recargar) y no pisa la preferencia de escritorio.
 */
export function usePanelAbierto(usuarioId: number, escritorio: boolean) {
  const [pref, setPref] = useState(() => leerAbierto(usuarioId));
  const [pasajero, setPasajero] = useState(false);
  useEffect(() => { setPref(leerAbierto(usuarioId)); setPasajero(false); }, [usuarioId]);

  const abierto = escritorio ? pref : pasajero;
  const poner = useCallback((v: boolean) => {
    if (escritorio) { setPref(v); guardarAbierto(usuarioId, v); } else setPasajero(v);
  }, [escritorio, usuarioId]);
  return { abierto, abrir: useCallback(() => poner(true), [poner]), cerrar: useCallback(() => poner(false), [poner]), alternar: useCallback(() => poner(!abierto), [poner, abierto]) };
}

/** Ancho de la columna (px), por usuario. `confirmar` guarda; `mover` sólo actualiza (mientras se arrastra). */
export function useAnchoPanel(usuarioId: number) {
  const [ancho, setAncho] = useState(() => leerAncho(usuarioId, window.innerWidth));
  useEffect(() => { setAncho(leerAncho(usuarioId, window.innerWidth)); }, [usuarioId]);
  // Si la ventana se achica, el ancho se vuelve a acotar (el contenido no debe quedar aplastado).
  useEffect(() => {
    const h = () => setAncho((a) => acotarAncho(a, window.innerWidth));
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  const mover = useCallback((px: number) => setAncho(acotarAncho(px, window.innerWidth)), []);
  const confirmar = useCallback((px: number) => { const a = acotarAncho(px, window.innerWidth); setAncho(a); guardarAncho(usuarioId, a); }, [usuarioId]);
  const restablecer = useCallback(() => confirmar(ANCHO_DEFECTO), [confirmar]);
  return { ancho, mover, confirmar, restablecer };
}
