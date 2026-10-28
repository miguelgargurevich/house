import { useEffect, useState } from 'react';
import { api } from '../../../api';

export interface Total { unidades_cobradas: number; minimo_aplicado: boolean; /** Sin IGV. */ total_mes: string; total_anio: string; igv_mes?: string; total_con_igv_mes?: string }

/** Total por mes y por año, sin IGV (aparte el total con IGV) y con el mínimo de departamentos del plan: lo calcula el servidor (el frontend no sabe de precios ni de la tasa). */
export function useTotal(unidades: number, plan: string | null, activo: boolean) {
  const [r, setR] = useState<Total | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!activo) { setR(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      const sp = new URLSearchParams({ unidades: String(unidades) });
      if (plan) sp.set('plan', plan);
      api<Total>(`/api/publico/cotizar?${sp}`).then(x => { if (vivo) { setR(x); setError(false); } }).catch(() => { if (vivo) setError(true); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [unidades, plan, activo]);
  return { r, error };
}
