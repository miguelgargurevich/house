// Datos FALSOS para probar el push sin red: una cuenta de servicio con una llave RSA generada al vuelo, llaves VAPID de forma válida y una suscripción de
// navegador con llaves reales (las que cifran el mensaje). Nada de esto es de nadie ni sale de la máquina.
import { createECDH, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import type { DepsAvisos } from '../../src/server/services/avisos/canales';

export interface CuentaFalsa { json: string; publica: KeyObject; correo: string }

export function cuentaDeServicioFalsa(extra: Record<string, unknown> = {}): CuentaFalsa {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const correo = 'push@proyecto-falso.iam.gserviceaccount.com';
  const json = JSON.stringify({ client_email: correo, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: 'https://oauth2.googleapis.com/token', ...extra });
  return { json, publica: publicKey, correo };
}

/** Llaves VAPID de forma válida (65 y 32 bytes en base64url). Para firmar de verdad en una prueba usa `web-push.generateVAPIDKeys()`. */
export const VAPID_FALSO = {
  VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'),
  VAPID_PRIVATE_KEY: Buffer.alloc(32, 9).toString('base64url'),
  VAPID_SUBJECT: 'mailto:soporte@ejemplo.test',
};

/** Una suscripción como la que entrega `PushSubscription.toJSON()`: endpoint + llaves p256dh (P-256 sin comprimir) y auth (16 bytes). */
export function suscripcionFalsa(endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('hex')}:APA91b${randomBytes(20).toString('hex')}`) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

/** Un token de FCM de forma válida (~150 caracteres). */
export const tokenFcmFalso = () => `${randomBytes(10).toString('hex')}:APA91b${randomBytes(60).toString('base64url')}`;

export interface Llamada { url: string; init: RequestInit }

/** `fetch` que nunca sale a la red: anota cada llamada y contesta lo que diga `responder`. */
export function fetchFalso(responder: (l: Llamada) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const l = { url: String(url), init: init ?? {} };
    llamadas.push(l);
    return responder(l);
  }) as typeof globalThis.fetch;
  return { fetch, llamadas };
}

/** Las dependencias de avisos con reloj fijo y `fetch` falso (`env` decide qué canales de push están configurados). */
export function depsFalsas(ahora: Date, env: NodeJS.ProcessEnv, responder: (l: Llamada) => Response | Promise<Response>) {
  const { fetch, llamadas } = fetchFalso(responder);
  const deps: DepsAvisos = { ahora: () => ahora, esperar: async () => {}, azar: () => 0, env, fetch };
  return { deps, llamadas };
}
