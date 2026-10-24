import { useCallback, useEffect, useState } from 'react';
import { ANCHO_DEFECTO, acotarAncho, guardarAbierto, guardarAncho, leerAbierto, leerAncho } from './panel';

/** Viewport ficticio para leer el ancho guardado sin recortarlo: el tope real se aplica al mostrarlo. */
const SIN_TOPE = 100_000;
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

/**
 * Ancho de la columna (px), por usuario. `barra` es el ancho real de la barra lateral (64 o 256): el tope sale de ahí. Se guarda el valor
 * pedido y se acota al mostrarlo, así al expandir el menú el panel se achica sin perder el ancho elegido. `confirmar` guarda; `mover` sólo
 * actualiza (mientras se arrastra).
 */
export function useAnchoPanel(usuarioId: number, barra: number) {
  const [pedido, setPedido] = useState(() => leerAncho(usuarioId, SIN_TOPE));
  const [viewport, setViewport] = useState(() => window.innerWidth);
  useEffect(() => { setPedido(leerAncho(usuarioId, SIN_TOPE)); }, [usuarioId]);
  // Si la ventana se achica, el ancho se vuelve a acotar (el contenido no debe quedar aplastado).
  useEffect(() => {
    const h = () => setViewport(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  const ancho = acotarAncho(pedido, viewport, barra);
  const mover = useCallback((px: number) => setPedido(acotarAncho(px, window.innerWidth, barra)), [barra]);
  const confirmar = useCallback((px: number) => { const a = acotarAncho(px, window.innerWidth, barra); setPedido(a); guardarAncho(usuarioId, a); }, [usuarioId, barra]);
  const restablecer = useCallback(() => confirmar(ANCHO_DEFECTO), [confirmar]);
  return { ancho, mover, confirmar, restablecer };
}
