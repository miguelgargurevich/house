/**
 * **A qué servidores puede hablar el Web Push.** El `endpoint` de una suscripción lo manda el navegador (el cliente) y el SERVIDOR le hace un POST:
 * sin una lista cerrada, cualquier usuario haría que Torre llame a una dirección interna (SSRF). Sólo https, sin usuario ni puerto raro, y sólo
 * los servicios de push de los navegadores:
 *  - Chrome, Edge (Chromium), Opera, Brave: `fcm.googleapis.com`
 *  - Firefox: `*.push.services.mozilla.com`
 *  - Safari (macOS y iPhone): `web.push.apple.com` (y `*.push.apple.com`)
 *  - Edge/Windows heredado: `*.notify.windows.com`
 */
const EXACTOS = new Set(['fcm.googleapis.com', 'web.push.apple.com']);
const SUFIJOS = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export const LARGO_MAXIMO_ENDPOINT = 1000;

export function endpointPermitido(valor: unknown): valor is string {
  if (typeof valor !== 'string' || valor.length > LARGO_MAXIMO_ENDPOINT) return false;
  let u: URL;
  try { u = new URL(valor); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return EXACTOS.has(host) || SUFIJOS.some((s) => host.endsWith(s) && host.length > s.length);
}
