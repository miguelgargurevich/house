import { useEffect, useState } from 'react';
import { api } from '../../../api';

/** Datos del responsable (`GET /api/publico/legal`). Un dato sin cargar llega como null. */
export interface DatosLegales { razon_social: string | null; ruc: string | null; domicilio: string | null; correo: string | null; version: string }

/** Una petición por carga de página: el pie de todas las páginas públicas y el texto legal comparten la respuesta (si falla, la próxima vez se vuelve a pedir). */
let pendiente: Promise<DatosLegales> | null = null;
const pedir = () => {
  if (!pendiente) pendiente = api<DatosLegales>('/api/publico/legal').catch((e) => { pendiente = null; throw e; });
  return pendiente;
};

/** Sin respuesta (red caída), `datos` queda en null y las páginas dicen «por confirmar»: el texto legal se ve igual. */
export function useDatosLegales() {
  const [datos, setDatos] = useState<DatosLegales | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vivo = true;
    pedir()
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => undefined)
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, []);
  return { datos, cargando };
}
