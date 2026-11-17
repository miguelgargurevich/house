import { createSign } from 'node:crypto';
import type { DepsAvisos } from '../avisos/canales';
import type { ConfigFcm } from './config';

/** Lo que se empuja a un dispositivo: título, cuerpo corto y la ruta interna que se abre al tocar. Nada sensible (ver `textos.ts`). */
export interface MensajePush { titulo: string; cuerpo: string; ruta: string }

/** `token_invalido`: el proveedor dice, con todas las letras, que ese dispositivo ya no existe → se borra. `fallo`: cualquier otra cosa (red, cuota, credenciales): se reintenta. */
export type ResultadoPush = { resultado: 'enviado' } | { resultado: 'token_invalido' } | { resultado: 'fallo'; motivo: string };

type DepsFcm = Pick<DepsAvisos, 'fetch' | 'ahora'>;

const TIEMPO_MAX_MS = 10_000;
const ALCANCE = 'https://www.googleapis.com/auth/firebase.messaging';

// Token de acceso de OAuth2 por cuenta de servicio, hasta un minuto antes de que venza. En memoria del proceso: nunca se loguea.
const accesos = new Map<string, { token: string; vence: number }>();
/** Olvida los tokens de acceso (las pruebas lo usan entre casos). */
export const olvidarAccesosFcm = () => accesos.clear();

const base64Url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function firmarJwt(cfg: ConfigFcm, ahoraMs: number): string {
  const iat = Math.floor(ahoraMs / 1000);
  const cabecera = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const reclamos = base64Url(JSON.stringify({ iss: cfg.cuenta.correo, scope: ALCANCE, aud: cfg.cuenta.urlDelToken, iat, exp: iat + 3600 }));
  const aFirmar = `${cabecera}.${reclamos}`;
  const firma = createSign('RSA-SHA256').update(aFirmar).sign(cfg.cuenta.llavePem);
  return `${aFirmar}.${base64Url(firma)}`;
}

async function tokenDeAcceso(deps: DepsFcm, cfg: ConfigFcm): Promise<string | null> {
  const clave = `${cfg.cuenta.correo}|${cfg.cuenta.urlDelToken}`;
  const ahora = deps.ahora().getTime();
  const guardado = accesos.get(clave);
  if (guardado && ahora < guardado.vence) return guardado.token;
  try {
    const r = await deps.fetch(cfg.cuenta.urlDelToken, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: firmarJwt(cfg, ahora) }).toString(),
      signal: AbortSignal.timeout(TIEMPO_MAX_MS),
    });
    if (!r.ok) { console.error(`[push] Google no dio el token de acceso (${r.status}): revisa la cuenta de servicio de FCM.`); return null; }
    const j = (await r.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== 'string' || !j.access_token) return null;
    const segundos = typeof j.expires_in === 'number' ? j.expires_in : 3600;
    accesos.set(clave, { token: j.access_token, vence: ahora + (Math.max(60, segundos) - 60) * 1000 });
    return j.access_token;
  } catch {
    return null; // sin red o firma inválida: el mensaje del error podría traer datos de la cuenta
  }
}

/** El `status` de Google (`NOT_FOUND`…), el `errorCode` propio de FCM (`UNREGISTERED`…) y el mensaje, si los trae. */
function errorDeFcm(cuerpo: string): { status?: string; codigo?: string; mensaje?: string } {
  try {
    const e = (JSON.parse(cuerpo) as { error?: { status?: unknown; message?: unknown; details?: unknown } }).error;
    if (!e) return {};
    const detalles = Array.isArray(e.details) ? (e.details as { errorCode?: unknown }[]) : [];
    const codigo = detalles.find((d) => typeof d?.errorCode === 'string')?.errorCode as string | undefined;
    return { status: typeof e.status === 'string' ? e.status : undefined, codigo, mensaje: typeof e.message === 'string' ? e.message : undefined };
  } catch {
    return {};
  }
}

/**
 * Qué hacer con un error de FCM. **Sólo se borra un dispositivo que FCM dice, con todas las letras, que no existe**: `UNREGISTERED` en el detalle del
 * error, o un 400 que se queja del token de registro. Un 404 a secas NO alcanza: también lo da un proyecto mal escrito y borraría los teléfonos
 * de todos. Tampoco un 400 por el mensaje, un 403 de credenciales, un 429 ni un 5xx: el teléfono está bien y el problema es otro.
 */
export function clasificarErrorFcm(estado: number, cuerpo: string): 'token_invalido' | 'fallo' {
  const e = errorDeFcm(cuerpo);
  if (e.codigo === 'UNREGISTERED') return 'token_invalido';
  if (estado === 400 && (e.codigo === 'INVALID_ARGUMENT' || e.status === 'INVALID_ARGUMENT') && /registration token/i.test(e.mensaje ?? '')) return 'token_invalido';
  return 'fallo';
}

/** El cuerpo de `POST /v1/projects/{proyecto}/messages:send`. La ruta va en `data` para que la app la abra al tocar el aviso. */
export function cuerpoFcm(token: string, m: MensajePush): string {
  return JSON.stringify({
    message: {
      token,
      notification: { title: m.titulo, body: m.cuerpo },
      data: { ruta: m.ruta },
      android: { priority: 'HIGH' },
      apns: { payload: { aps: { sound: 'default' } } },
    },
  });
}

/** Envía un push a UN dispositivo por FCM HTTP v1 (sirve a Android y a iPhone). Un 401 renueva el token de acceso y reintenta UNA vez. Nunca lanza. */
export async function enviarFcm(deps: DepsFcm, cfg: ConfigFcm, token: string, mensaje: MensajePush): Promise<ResultadoPush> {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.proyecto)}/messages:send`;
  const clave = `${cfg.cuenta.correo}|${cfg.cuenta.urlDelToken}`;
  for (let intento = 1; ; intento++) {
    const acceso = await tokenDeAcceso(deps, cfg);
    if (!acceso) return { resultado: 'fallo', motivo: 'FCM sin token de acceso' };
    try {
      const r = await deps.fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${acceso}`, 'content-type': 'application/json' },
        body: cuerpoFcm(token, mensaje),
        signal: AbortSignal.timeout(TIEMPO_MAX_MS),
      });
      if (r.ok) return { resultado: 'enviado' };
      if (r.status === 401 && intento === 1) { accesos.delete(clave); continue; }
      const cuerpo = await r.text().catch(() => '');
      if (clasificarErrorFcm(r.status, cuerpo) === 'token_invalido') return { resultado: 'token_invalido' };
      // Sólo el estado: nunca el cuerpo entero ni el token del teléfono.
      return { resultado: 'fallo', motivo: `FCM respondió ${r.status}` };
    } catch {
      return { resultado: 'fallo', motivo: 'Sin conexión con FCM' };
    }
  }
}
