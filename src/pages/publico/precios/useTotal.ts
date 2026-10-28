import { useEffect, useState } from 'react';
import { api } from '../../../api';

export interface Total { total_mes: string; total_anio: string }

/** Total por mes y por año, ya con IGV: lo calcula el servidor (el frontend no sabe de precios ni de la tasa). */
export function useTotal(unidades: number, plan: string | null, modulos: string[], activo: boolean) {
  const [r, setR] = useState<Total | null>(null);
  const [error, setError] = useState(false);
  const clave = `${unidades}|${plan}|${modulos.join(',')}`;
  useEffect(() => {
    if (!activo) { setR(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      const sp = new URLSearchParams({ unidades: String(unidades) });
      if (plan) sp.set('plan', plan);
      if (modulos.length) sp.set('modulos', modulos.join(','));
      api<Total>(`/api/publico/cotizar?${sp}`).then(x => { if (vivo) { setR(x); setError(false); } }).catch(() => { if (vivo) setError(true); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
    // `clave` resume los tres insumos (evita volver a pedir por un arreglo nuevo con el mismo contenido).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo]);
  return { r, error };
}
