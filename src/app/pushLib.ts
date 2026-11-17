/** Utilidades puras del Web Push (sin API ni DOM): se prueban en Node. */

/** La clave pública VAPID (base64url) como la pide `pushManager.subscribe`. Lanza si no es base64. */
export function claveVapid(base64Url: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const bin = atob((base64Url + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const esIphone = (userAgent: string): boolean => /iPhone|iPad|iPod/.test(userAgent);

/** Lo que se manda a `POST /api/me/push/dispositivos` desde una suscripción del navegador (`PushSubscription.toJSON()`); null si le faltan datos. */
export function suscripcionParaServidor(j: { endpoint?: string; keys?: Record<string, string> }): { tipo: 'web'; endpoint: string; keys: { p256dh: string; auth: string } } | null {
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) return null;
  return { tipo: 'web', endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
}

/**
 * ¿Los avisos están activos PARA ESTA CUENTA en este navegador? Hace falta el permiso, una suscripción local Y que esta cuenta los haya activado aquí:
 * en un navegador compartido la suscripción de la cuenta anterior sigue ahí, pero el servidor la dio de baja al cerrar su sesión y no es de quien entró ahora.
 */
export function estadoLocalWeb(d: { permiso: 'granted' | 'denied' | 'default'; haySuscripcion: boolean; recordadoPorEstaCuenta: boolean }): 'activo' | 'inactivo' {
  return d.permiso === 'granted' && d.haySuscripcion && d.recordadoPorEstaCuenta ? 'activo' : 'inactivo';
}
