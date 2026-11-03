import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText } from '../../../../api';
import type { Rendicion } from './tipos';

/**
 * Carga la rendición de una consulta (`null` = no cargar). Descarta respuestas viejas (cambiar de mes o de block rápido) y expone el código estable del
 * servidor: `MODULO_NO_ACTIVO` = el condominio no tiene el plan que trae los reportes (la pantalla muestra el aviso, no un error).
 */
export function useRendicion(path: string | null) {
  const [data, setData] = useState<Rendicion | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) { setData(null); setLoading(false); return; }
    const mi = ++seq.current;
    setLoading(true); setError(null); setErrorCode(undefined);
    try {
      const r = await api<Rendicion>(path);
      if (mi === seq.current) setData(r);
    } catch (e) {
      if (mi === seq.current) { setData(null); setError(errorText(e)); setErrorCode(e instanceof ApiError ? e.code : undefined); }
    } finally {
      if (mi === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, errorCode, reload: load };
}
