import { useEffect, useRef, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth/AuthContext';
import { minutosRestantes } from '../auth/impersonacion-lib';
import { volverAMiCuenta } from '../auth/impersonacion';
import { ContenidoBarra } from './ContenidoBarra';
import { rotuloRol } from './nav';

/**
 * Barra fija arriba en toda la app mientras el superadmin ve Torre como otra persona. Cuenta los minutos que quedan y, al llegar a cero,
 * le pregunta al servidor (la sesión prestada ya no existe: la pantalla vuelve al inicio de sesión).
 */
export function BarraImpersonacion() {
  const { user, refresh } = useAuth();
  const imp = user?.impersonando ?? null;
  const [ahora, setAhora] = useState(() => Date.now());
  const [saliendo, setSaliendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preguntado = useRef(false);

  useEffect(() => {
    if (!imp) return;
    const t = setInterval(() => setAhora(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [imp]);

  const minutos = imp ? minutosRestantes(imp.expira_at, ahora) : 0;
  useEffect(() => {
    if (imp && minutos <= 0 && !preguntado.current) { preguntado.current = true; void refresh(); }
  }, [imp, minutos, refresh]);

  if (!user || !imp) return null;

  const volver = async () => {
    setSaliendo(true);
    setError(null);
    try { await volverAMiCuenta(); } catch (e) { setError(errorText(e)); setSaliendo(false); }
  };
  return <ContenidoBarra nombre={user.nombre} rotulo={rotuloRol(user)} minutos={minutos} saliendo={saliendo} error={error} onVolver={() => void volver()} />;
}
