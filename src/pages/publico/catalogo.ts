import { useEffect, useState } from 'react';
import { api } from '../../api';

export interface Plan {
  clave: string; nombre: string; descripcion: string | null; precio_por_unidad: string; modulos_incluidos: string[]; caracteristicas: string[];
  /** Tope de departamentos por condominio (Gratis); null = sin tope. */
  unidades_maximas: number | null;
  /** Departamentos que se cobran como mínimo por condominio (Pro y Administradora); null = sin mínimo. */
  unidades_minimas: number | null;
  /** Lo menos que paga un condominio con este plan al mes (mínimo de departamentos × precio, sin IGV), calculado por el servidor. */
  total_minimo_mes: string | null;
}
/** Lo que trae Pro. Los módulos ya no se venden sueltos: no tienen precio. */
export interface Modulo { clave: string; nombre: string; descripcion: string | null }
export interface Catalogo { planes: Plan[]; modulos: Modulo[]; registro_abierto: boolean }

/** Una sola petición por carga de página: el marco (botón «Crear cuenta») y la página de precios comparten la respuesta. */
let pendiente: Promise<Catalogo> | null = null;
const pedir = () => (pendiente ??= api<Catalogo>('/api/publico/planes').catch((e) => { pendiente = null; throw e; }));

export function useCatalogo() {
  const [data, setData] = useState<Catalogo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    pedir().then((c) => { if (vivo) setData(c); }).catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, []);
  return { data, error, loading: !data && !error };
}
