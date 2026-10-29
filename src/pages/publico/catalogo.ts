import { useEffect, useState } from 'react';
import { api } from '../../api';
import { usePaisElegido } from './paisElegido';

export interface Plan {
  clave: string; nombre: string; descripcion: string | null;
  /** Precio base por departamento al mes, sin impuesto, en la moneda del catálogo. `null` = sin precio en esa moneda («Consúltanos»). */
  precio_por_unidad: string | null;
  /** El plan de pago no tiene precio en la moneda del país elegido: no se puede contratar ahí. */
  consultar: boolean;
  modulos_incluidos: string[]; caracteristicas: string[];
  /** Tope de departamentos por condominio (Gratis); null = sin tope. */
  unidades_maximas: number | null;
  /** Departamentos que se cobran como mínimo por condominio (Pro y Administradora); null = sin mínimo. */
  unidades_minimas: number | null;
  /** Lo menos que paga un condominio con este plan al mes (mínimo de departamentos × precio, sin impuesto), calculado por el servidor. */
  total_minimo_mes: string | null;
}
/** Lo que trae Pro. Los módulos ya no se venden sueltos: no tienen precio. */
export interface Modulo { clave: string; nombre: string; descripcion: string | null }
/** «IGV», «IVA»… y su tasa en fracción (0.18 = 18 %). */
export interface ImpuestoPublico { nombre: string; tasa: string }
export interface PaisAbierto { codigo: string; nombre: string; bandera: string; moneda: string; impuesto: ImpuestoPublico }
export interface Catalogo {
  /** País con el que el servidor armó los precios (el pedido si está abierto; si no, Perú) y de él la moneda y el impuesto. */
  pais: string;
  moneda: string;
  impuesto: ImpuestoPublico;
  /** Los países abiertos a contratar: lo que ofrece el selector. */
  paises: PaisAbierto[];
  planes: Plan[]; modulos: Modulo[]; registro_abierto: boolean;
}

/** Una petición por país y carga de página: el marco (botón «Crear cuenta») y la página de precios comparten la respuesta. */
const pendientes = new Map<string, Promise<Catalogo>>();
const pedir = (pais: string | null) => {
  const clave = pais ?? '';
  let p = pendientes.get(clave);
  if (!p) {
    p = api<Catalogo>(pais ? `/api/publico/planes?pais=${encodeURIComponent(pais)}` : '/api/publico/planes').catch((e) => { pendientes.delete(clave); throw e; });
    pendientes.set(clave, p);
  }
  return p;
};

export function useCatalogo() {
  const pais = usePaisElegido();
  const [data, setData] = useState<Catalogo | null>(null);
  const [error, setError] = useState(false);
  // Al cambiar de país se conserva el catálogo anterior hasta que llega el nuevo (la página no parpadea).
  useEffect(() => {
    let vivo = true;
    pedir(pais).then((c) => { if (vivo) { setData(c); setError(false); } }).catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [pais]);
  return { data, error, loading: !data && !error };
}
