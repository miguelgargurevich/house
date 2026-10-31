import { useEffect, useState } from 'react';
import { api } from '../../../../api';
import { useAuth } from '../../../../auth/AuthContext';

export interface MarcaConciliacion { movimiento_id: number; /** Día del abono en el banco (AAAA-MM-DD). */ fecha: string; vinculo: 'automatico' | 'manual' | null }

/**
 * «Conciliado con el banco»: de estos pagos (los de la lista), cuáles tienen su abono y con qué fecha. Es sólo información para la administración: sin la
 * conciliación en el plan, o ante cualquier error, no hay marcas y la pantalla sigue igual. Nunca cambia cómo se valida un pago.
 */
export function useMarcasConciliacion(ids: number[]): Record<number, MarcaConciliacion> {
  const { user } = useAuth();
  const aplica = user?.rol === 'admin' || user?.rol === 'superadmin';
  const clave = [...new Set(ids)].slice(0, 100).join(',');
  const [marcas, setMarcas] = useState<Record<number, MarcaConciliacion>>({});
  useEffect(() => {
    if (!aplica || !clave) { setMarcas({}); return; }
    let vigente = true;
    api<{ marcas: Record<number, MarcaConciliacion> }>(`/api/conciliacion/pagos?ids=${clave}`)
      .then(r => { if (vigente) setMarcas(r.marcas); })
      .catch(() => { if (vigente) setMarcas({}); });
    return () => { vigente = false; };
  }, [aplica, clave]);
  return marcas;
}

/** El texto de la marca: «Conciliado con el banco · abono del 05/10/2026». */
export const textoMarca = (m: MarcaConciliacion, fechaCorta: (v: string) => string) => `Conciliado con el banco · abono del ${fechaCorta(m.fecha)}`;
