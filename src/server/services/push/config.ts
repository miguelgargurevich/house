// Configuración del push: SOLO por variables de entorno (nunca en el repo ni en la base). Sin variables, el envío queda apagado y el servidor
// arranca igual: cada canal (FCM = Android/iPhone, Web Push = navegador) se enciende por su cuenta.

/** La cuenta de servicio de Google (JSON que baja Firebase): sólo lo que hace falta para firmar. La llave privada NUNCA se imprime. */
export interface CuentaDeServicio { correo: string; llavePem: string; urlDelToken: string }

export interface ConfigFcm { proyecto: string; cuenta: CuentaDeServicio }
export interface ConfigWebPush { publica: string; privada: string; sujeto: string }
export interface ConfigPush { fcm: ConfigFcm | null; web: ConfigWebPush | null }

export const URL_TOKEN_GOOGLE = 'https://oauth2.googleapis.com/token';

/** Lee el JSON de la consola de Google Cloud. Devuelve null si no es una cuenta de servicio usable (sin lanzar). */
export function leerCuentaDeServicio(json: string | undefined | null): CuentaDeServicio | null {
  if (!json?.trim()) return null;
  try {
    const raiz = JSON.parse(json) as Record<string, unknown>;
    const correo = typeof raiz.client_email === 'string' ? raiz.client_email.trim() : '';
    const llavePem = typeof raiz.private_key === 'string' ? raiz.private_key : '';
    if (!correo || !llavePem.includes('BEGIN PRIVATE KEY')) return null;
    // El JWT firmado viaja a esta dirección: sólo https (si el JSON trae otra cosa, se usa la de Google).
    const url = typeof raiz.token_uri === 'string' && raiz.token_uri.startsWith('https://') ? raiz.token_uri : URL_TOKEN_GOOGLE;
    return { correo, llavePem, urlDelToken: url };
  } catch {
    return null;
  }
}

/** La cuenta de servicio como la dejó el despliegue: el JSON directo o en base64 (más cómodo en una variable de entorno). */
function jsonDeLaCuenta(env: NodeJS.ProcessEnv): string | null {
  if (env.FCM_SERVICE_ACCOUNT_JSON?.trim()) return env.FCM_SERVICE_ACCOUNT_JSON;
  const b64 = env.FCM_SERVICE_ACCOUNT_BASE64?.trim();
  if (!b64) return null;
  try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return null; }
}

/** Una llave VAPID pública son 65 bytes (P-256 sin comprimir) en base64url; la privada, 32. Sólo se revisa la forma, no se imprime. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const llaveVapidValida = (v: string, bytes: number) => BASE64URL.test(v) && Buffer.from(v, 'base64url').length === bytes;

export function configPush(env: NodeJS.ProcessEnv = process.env): ConfigPush {
  const proyecto = env.FCM_PROJECT_ID?.trim();
  const cuenta = leerCuentaDeServicio(jsonDeLaCuenta(env));
  const publica = env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const privada = env.VAPID_PRIVATE_KEY?.trim() ?? '';
  const sujeto = env.VAPID_SUBJECT?.trim() ?? '';
  const sujetoValido = /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(sujeto);
  return {
    fcm: proyecto && cuenta ? { proyecto, cuenta } : null,
    web: llaveVapidValida(publica, 65) && llaveVapidValida(privada, 32) && sujetoValido ? { publica, privada, sujeto } : null,
  };
}

/** Qué falta, en NOMBRES de variables (nunca valores), por canal. */
export function estadoPush(env: NodeJS.ProcessEnv = process.env): { fcm: { configurado: boolean; faltan: string[] }; web: { configurado: boolean; faltan: string[] } } {
  const c = configPush(env);
  const faltaFcm: string[] = [];
  if (!env.FCM_PROJECT_ID?.trim()) faltaFcm.push('FCM_PROJECT_ID');
  if (!leerCuentaDeServicio(jsonDeLaCuenta(env))) faltaFcm.push('FCM_SERVICE_ACCOUNT_JSON o FCM_SERVICE_ACCOUNT_BASE64 (válido)');
  const faltaWeb: string[] = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].filter((k) => !env[k]?.trim());
  if (!c.web && !faltaWeb.length) faltaWeb.push('VAPID_* (revisa que las llaves y el sujeto sean válidos)');
  return { fcm: { configurado: !!c.fcm, faltan: faltaFcm }, web: { configurado: !!c.web, faltan: faltaWeb } };
}

/** El renglón del log al arrancar. Sólo nombres de variables. */
export function mensajeDeArranque(env: NodeJS.ProcessEnv = process.env): string[] {
  const e = estadoPush(env);
  return [
    e.fcm.configurado ? '[push] FCM (Android/iPhone): activo' : `[push] FCM (Android/iPhone) apagado: falta ${e.fcm.faltan.join(', ')}`,
    e.web.configurado ? '[push] Web Push (navegador): activo' : `[push] Web Push (navegador) apagado: falta ${e.web.faltan.join(', ')}`,
  ];
}
