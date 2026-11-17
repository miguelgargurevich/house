import { api } from '../api';
import { dentroDeLaApp, agente, estaInstalada } from './instalar';
import { claveVapid, esIphone, suscripcionParaServidor } from './pushLib';

/**
 * **Avisos push en el NAVEGADOR** (Web Push). La persona los activa a mano en Mi perfil («Recibir avisos en este navegador»): se registra el service worker
 * (`public/sw.js`), se pide el permiso, el navegador crea una suscripción con la clave pública VAPID del servidor y esa suscripción se manda a
 * `POST /api/me/push/dispositivos`. Dentro de la app de iOS/Android no se ofrece (ahí van los avisos nativos: `pushApp.ts`).
 *
 * Con la sesión cerrada se da de baja el dispositivo en el servidor (para que los avisos de esa cuenta no lleguen a un navegador compartido); la suscripción
 * local queda y, si la MISMA cuenta vuelve a entrar en este navegador, se registra sola (`reanudarWeb`). La elección se recuerda por usuario.
 */

export interface ConfigPush { fcm: boolean; web: boolean; vapid_public: string | null }

export type EstadoWeb =
  | 'no_soportado'      // el navegador no tiene Web Push (o es la app: ahí van los avisos nativos)
  | 'iphone_sin_instalar' // Safari de iPhone sólo permite push con Torre agregada a la pantalla de inicio
  | 'sin_servidor'      // el servidor no tiene las llaves VAPID
  | 'bloqueado'         // la persona bloqueó las notificaciones en el navegador
  | 'inactivo'
  | 'activo';

const CLAVE = (usuarioId: number) => `torre-push-web:${usuarioId}`;
const ESPERA_BAJA_MS = 3000;

export const soportaWebPush = (): boolean =>
  typeof navigator !== 'undefined' && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function leerConfigPush(): Promise<ConfigPush> {
  return api<ConfigPush>('/api/me/push/config');
}

const recordado = (usuarioId: number): boolean => { try { return localStorage.getItem(CLAVE(usuarioId)) === '1'; } catch { return false; } };
const recordar = (usuarioId: number, si: boolean) => { try { if (si) localStorage.setItem(CLAVE(usuarioId), '1'); else localStorage.removeItem(CLAVE(usuarioId)); } catch { /* sin almacenamiento */ } };

async function suscripcionActual(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

const comoJson = (s: PushSubscription) => suscripcionParaServidor(s.toJSON() as { endpoint?: string; keys?: Record<string, string> });

/** El endpoint registrado en este navegador, en memoria: así el cierre de sesión puede darlo de baja sin esperar a nada asíncrono. */
let endpointRegistrado: string | null = null;
export const endpointDeEsteNavegador = () => endpointRegistrado;

/** Cómo está el navegador para recibir avisos, y por qué no (para que la pantalla lo diga). Nunca lanza. */
export async function estadoWeb(config: ConfigPush | null): Promise<EstadoWeb> {
  try {
    const ua = agente();
    if (dentroDeLaApp(ua)) return 'no_soportado'; // dentro de la app van los avisos nativos
    if (esIphone(ua) && !estaInstalada()) return 'iphone_sin_instalar'; // Safari de iPhone no trae Web Push hasta agregar Torre a la pantalla de inicio
    if (!soportaWebPush()) return 'no_soportado';
    if (!config?.web || !config.vapid_public) return 'sin_servidor';
    if (Notification.permission === 'denied') return 'bloqueado';
    return Notification.permission === 'granted' && (await suscripcionActual()) ? 'activo' : 'inactivo';
  } catch {
    return 'no_soportado';
  }
}

/** Activa los avisos en este navegador. Devuelve el estado en que quedó. Lanza sólo si el servidor rechaza el registro (la pantalla lo muestra). */
export async function activarWeb(usuarioId: number, config: ConfigPush): Promise<EstadoWeb> {
  if (!soportaWebPush() || !config.web || !config.vapid_public) return estadoWeb(config);
  const permiso = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueado' : 'inactivo';
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveVapid(config.vapid_public) }));
  const cuerpo = comoJson(sub);
  if (!cuerpo) { await sub.unsubscribe().catch(() => false); return 'inactivo'; }
  try {
    await api('/api/me/push/dispositivos', { method: 'POST', json: cuerpo });
  } catch (e) {
    await sub.unsubscribe().catch(() => false); // sin registro en el servidor no sirve de nada tener la suscripción
    throw e;
  }
  endpointRegistrado = cuerpo.endpoint;
  recordar(usuarioId, true);
  return 'activo';
}

/** Apaga los avisos en este navegador: baja en el servidor y cancela la suscripción. */
export async function desactivarWeb(usuarioId: number): Promise<void> {
  recordar(usuarioId, false);
  const sub = await suscripcionActual().catch(() => null);
  const endpoint = sub?.endpoint ?? endpointRegistrado;
  endpointRegistrado = null;
  if (endpoint) await api('/api/me/push/dispositivos/baja', { method: 'POST', json: { token: endpoint } }).catch(() => undefined);
  await sub?.unsubscribe().catch(() => false);
}

/**
 * Al abrir sesión: si ESTA cuenta ya los había activado en este navegador y el permiso sigue dado, vuelve a registrar la suscripción (el servidor la dio de baja al
 * cerrar sesión). Silencioso: nunca pide permiso ni muestra nada. Nunca lanza.
 */
export async function reanudarWeb(usuarioId: number): Promise<void> {
  try {
    if (dentroDeLaApp(agente()) || !soportaWebPush() || !recordado(usuarioId) || Notification.permission !== 'granted') return;
    const sub = await suscripcionActual();
    const cuerpo = sub ? comoJson(sub) : null;
    if (!cuerpo) { recordar(usuarioId, false); return; }
    await api('/api/me/push/dispositivos', { method: 'POST', json: cuerpo });
    endpointRegistrado = cuerpo.endpoint;
  } catch { /* sin red o sin sesión: se reintenta en el próximo inicio */ }
}

/** Baja en el servidor del navegador actual, SIN cancelar la suscripción local. Se manda con las cabeceras de la sesión que se está cerrando (ya capturadas). */
export function darDeBajaWeb(cabeceras: Record<string, string>): Promise<void> {
  const endpoint = endpointRegistrado;
  endpointRegistrado = null;
  if (!endpoint) return Promise.resolve();
  return Promise.race([
    api('/api/me/push/dispositivos/baja', { method: 'POST', json: { token: endpoint }, headers: cabeceras }).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, ESPERA_BAJA_MS)),
  ]).catch(() => undefined);
}

