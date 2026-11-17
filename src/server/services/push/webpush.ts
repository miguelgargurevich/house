import webpush from 'web-push';
import type { DepsAvisos } from '../avisos/canales';
import type { ConfigWebPush } from './config';
import { endpointPermitido } from './endpoints';
import type { MensajePush, ResultadoPush } from './fcm';

/** Una suscripción de navegador (`PushSubscription.toJSON()`): el endpoint y las dos llaves que cifran el mensaje. */
export interface SuscripcionWeb { endpoint: string; p256dh: string; auth: string }

const TIEMPO_MAX_MS = 10_000;
/** Cuánto guarda el servicio de push un aviso si el navegador está apagado: un día; después ya no sirve. */
const TTL_SEGUNDOS = 24 * 60 * 60;

/**
 * Envía un push a UN navegador (Web Push + VAPID, mensaje cifrado AES-128-GCM por la librería `web-push`). La librería sólo arma la petición
 * (`generateRequestDetails`); el POST sale por el `fetch` inyectado, así las pruebas nunca tocan la red. Aquí 404 y 410 SÍ significan «esa suscripción
 * ya no existe» (el usuario la revocó o venció): se borra. Nunca lanza.
 */
export async function enviarWebPush(deps: Pick<DepsAvisos, 'fetch'>, cfg: ConfigWebPush, s: SuscripcionWeb, m: MensajePush): Promise<ResultadoPush> {
  // Aunque el registro ya lo exige, una fila vieja o escrita a mano no debe hacer que el servidor llame a cualquier dirección.
  if (!endpointPermitido(s.endpoint)) return { resultado: 'token_invalido' };
  try {
    const d = webpush.generateRequestDetails(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify({ titulo: m.titulo, cuerpo: m.cuerpo, ruta: m.ruta }),
      { vapidDetails: { subject: cfg.sujeto, publicKey: cfg.publica, privateKey: cfg.privada }, TTL: TTL_SEGUNDOS, urgency: 'normal' },
    );
    const r = await deps.fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body as BodyInit, signal: AbortSignal.timeout(TIEMPO_MAX_MS) });
    if (r.ok) return { resultado: 'enviado' };
    if (r.status === 404 || r.status === 410) return { resultado: 'token_invalido' };
    return { resultado: 'fallo', motivo: `Web Push respondió ${r.status}` };
  } catch {
    // Llaves mal formadas (generateRequestDetails lanza) o sin red: el error podría traer datos de la suscripción.
    return { resultado: 'fallo', motivo: 'Sin conexión con el servicio de push' };
  }
}
