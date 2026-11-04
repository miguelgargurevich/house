import { api, ApiError, csrfStore } from '../api';
import { HOME, type Rol } from './AuthContext';

/** Entra como otra persona (sólo superadmin). El servidor cambia la cookie a la sesión prestada: la app se recarga en el inicio del rol del objetivo. */
export async function entrarComo(usuarioId: number, motivo: string): Promise<void> {
  const r = await api<{ user: { rol: Rol }; csrf: string }>('/api/impersonacion', { method: 'POST', json: { usuario_id: usuarioId, motivo } });
  csrfStore.set(r.csrf);
  window.location.assign(HOME[r.user.rol]);
}

/** «Volver a mi cuenta»: el servidor restaura la sesión real (sin alargarla). Si ya no sirve (venció, revocada), a iniciar sesión. */
export async function volverAMiCuenta(): Promise<void> {
  try {
    const r = await api<{ user: { rol: Rol }; csrf: string }>('/api/impersonacion/salir', { method: 'POST', json: {} });
    csrfStore.set(r.csrf);
    window.location.assign(HOME[r.user.rol]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { csrfStore.set(null); window.location.assign('/login'); return; }
    throw e;
  }
}
