import { useEffect, useState } from 'react';
import { api } from '../../../api';

export interface Total {
  unidades_cobradas: number; minimo_aplicado: boolean; moneda: string; impuesto_nombre: string;
  /** El plan no tiene precio en la moneda del país: sin totales («Consúltanos»). */
  consultar: boolean;
  /** Sin impuesto. */ total_mes: string | null; total_anio: string | null; igv_mes: string | null; total_con_igv_mes: string | null;
}

/** Total por mes y por año, sin impuesto (aparte el total con impuesto) y con el mínimo de departamentos del plan, en la moneda del país: lo calcula el servidor (el frontend no sabe de precios ni de la tasa). */
export function useTotal(unidades: number, plan: string | null, pais: string, activo: boolean) {
  const [r, setR] = useState<Total | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!activo) { setR(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      const sp = new URLSearchParams({ unidades: String(unidades), pais });
      if (plan) sp.set('plan', plan);
      api<Total>(`/api/publico/cotizar?${sp}`).then(x => { if (vivo) { setR(x); setError(false); } }).catch(() => { if (vivo) setError(true); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [unidades, plan, pais, activo]);
  return { r, error };
}
