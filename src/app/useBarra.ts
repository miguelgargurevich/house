import { useCallback, useEffect, useState } from 'react';
import { anchoBarra, esAtajoMenu, guardarColapsada, leerColapsada } from './barra';

/**
 * Estado de la barra lateral. `colapsada` sólo vale en escritorio (>= lg): en el celular el menú es un cajón con textos completos aunque la
 * preferencia guardada sea «colapsado». `animar` se enciende después del primer render para que el ancho no se anime al cargar.
 */
export function useBarra(escritorio: boolean) {
  const [pref, setPref] = useState(() => leerColapsada());
  const [animar, setAnimar] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setAnimar(true)); return () => cancelAnimationFrame(id); }, []);

  const alternar = useCallback(() => setPref((p) => { guardarColapsada(!p); return !p; }), []);

  useEffect(() => {
    if (!escritorio) return;
    const h = (e: KeyboardEvent) => { if (esAtajoMenu(e)) { e.preventDefault(); alternar(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [escritorio, alternar]);

  const colapsada = escritorio && pref;
  return { colapsada, ancho: escritorio ? anchoBarra(colapsada) : 0, animar, alternar };
}
