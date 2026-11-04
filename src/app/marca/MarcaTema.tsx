import { useLayoutEffect } from 'react';
import type { MarcaUsuario } from '../../lib/marca';
import { aplicarMarca, quitarMarca } from './aplicar';

/**
 * Aplica la marca activa mientras haya sesión dentro del `Shell`. `useLayoutEffect`: se pone ANTES de pintar la primera pantalla (sin destello del verde de Torre);
 * al desmontarse (cerrar sesión) vuelve a Torre. El login y las páginas públicas no pasan por aquí: siguen siendo de Torre.
 */
export function MarcaTema({ marca }: { marca: MarcaUsuario }) {
  const { activa, color, nombre, logo_url } = marca;
  useLayoutEffect(() => {
    if (activa) aplicarMarca({ ...marca, activa, color, nombre, logo_url }); else quitarMarca();
    return quitarMarca;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo importan estos cuatro campos
  }, [activa, color, nombre, logo_url]);
  return null;
}
