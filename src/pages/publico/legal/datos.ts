import { useEffect, useState } from 'react';
import { api } from '../../../api';

/** Datos del responsable (`GET /api/publico/legal`). Un dato sin cargar llega como null. */
export interface DatosLegales { razon_social: string | null; ruc: string | null; domicilio: string | null; correo: string | null; version: string }

/** Sin respuesta (red caída), `datos` queda en null y las páginas dicen «por confirmar»: el texto legal se ve igual. */
export function useDatosLegales() {
  const [datos, setDatos] = useState<DatosLegales | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vivo = true;
    api<DatosLegales>('/api/publico/legal')
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => undefined)
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, []);
  return { datos, cargando };
}
