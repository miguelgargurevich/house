import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../../db';
import { cifrar, descifrar } from '../../lib/secretBox';
import { canalesDeps } from './deps';
import { partirMensaje } from './evolution';
import { ENLACE_APP } from '../avisos/plantillas';
import type { DepsAvisos, ResultadoEnvio } from '../avisos/canales';

/** Host FIJO de la API de Telegram: nada del usuario ni de la base decide a dónde sale una petición (sin SSRF). */
export const HOST_TELEGRAM = 'https://api.telegram.org';
/** Cabecera con la que Telegram presenta el `secret_token` en cada llamada al webhook. */
export const CABECERA_SECRETO_TELEGRAM = 'x-telegram-bot-api-secret-token';
/** Tope por mensaje (el límite de Telegram es 4.096). */
export const MAX_MENSAJE_TELEGRAM = 4000;

const TIEMPO_MAX_MS = 15_000;
/** `123456789:AAH…` — sólo estos caracteres pueden ir en la URL `/bot<token>/`. */
const FORMATO_TOKEN = /^\d{6,14}:[A-Za-z0-9_-]{30,60}$/;
const FORMATO_RUTA_ARCHIVO = /^[\w./-]{1,255}$/;
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
export const aadTelegram = () => 'telegram:bot';

export class TelegramFallo extends Error {
  causa: 'sin_configurar' | 'sin_conexion' | 'timeout' | 'rechazado' | 'error' | 'grande';
  estado: number | null;
  constructor(causa: TelegramFallo['causa'], estado: number | null = null) {
    super(`telegram: ${causa}${estado ? ` ${estado}` : ''}`);
    this.causa = causa;
    this.estado = estado;
  }
}

export const tokenValido = (t: string): boolean => FORMATO_TOKEN.test(t);

/** Llamada a la Bot API. El mensaje del error NUNCA lleva la URL (que contiene el token) ni la respuesta del proveedor. */
async function llamar(token: string, metodo: string, body?: Record<string, unknown>, deps: Pick<DepsAvisos, 'fetch'> = canalesDeps): Promise<unknown> {
  if (!tokenValido(token)) throw new TelegramFallo('sin_configurar');
  let r: Response;
  try {
    r = await deps.fetch(`${HOST_TELEGRAM}/bot${token}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(TIEMPO_MAX_MS),
    });
  } catch (e) {
    throw new TelegramFallo(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'sin_conexion');
  }
  const json = await r.json().then((j: unknown) => (j && typeof j === 'object' ? (j as { ok?: unknown; result?: unknown }) : null), () => null);
  if (!r.ok || json?.ok !== true) throw new TelegramFallo(r.status === 401 || r.status === 404 ? 'rechazado' : 'error', r.status);
  return json.result;
}

export interface BotInfo { usuario: string; nombre: string }

/** `getMe`: valida el token y dice de qué bot es. */
export async function getMe(token: string): Promise<BotInfo> {
  const r = (await llamar(token, 'getMe')) as { is_bot?: unknown; username?: unknown; first_name?: unknown } | null;
  if (!r || r.is_bot !== true || typeof r.username !== 'string' || !/^[A-Za-z0-9_]{3,64}$/.test(r.username)) throw new TelegramFallo('error', 200);
  return { usuario: r.username, nombre: typeof r.first_name === 'string' ? r.first_name.slice(0, 80) : r.username };
}

/** URL pública a la que Telegram llama: la de House (la misma de los enlaces de los avisos), nunca la de la petición. */
export const urlWebhookTelegram = (): string => `${canalesDeps.urlPublica().replace(/\/+$/, '') || ENLACE_APP}/api/canales/telegram`;

export const setWebhook = (token: string, url: string, secreto: string) =>
  llamar(token, 'setWebhook', { url, secret_token: secreto, allowed_updates: ['message'], drop_pending_updates: true, max_connections: 10 });

export const deleteWebhook = (token: string) => llamar(token, 'deleteWebhook', { drop_pending_updates: true });

export interface ConfigTelegram { token: string; botUsuario: string | null; habilitado: boolean; secretoHash: string | null }

/** La configuración con el token descifrado (sólo para hablar con Telegram; nunca se devuelve por la API ni se loguea). `null` si no hay token. */
export async function cargarConfig(): Promise<ConfigTelegram | null> {
  const f = await prisma.configuracionTelegram.findUnique({ where: { id: 1 } });
  if (!f?.token_enc) return null;
  try {
    return { token: descifrar(f.token_enc, aadTelegram()), botUsuario: f.bot_usuario, habilitado: f.habilitado, secretoHash: f.secreto_hash };
  } catch {
    return null; // LLAVERO_ENC_KEY cambió o el valor se alteró: el bot queda mudo en vez de fallar a medias
  }
}

/** ¿El bot está guardado, activo y con webhook registrado? Es lo que habilita vincular desde Mi perfil. */
export async function botActivo(): Promise<{ usuario: string } | null> {
  const f = await prisma.configuracionTelegram.findUnique({ where: { id: 1 }, select: { token_enc: true, habilitado: true, bot_usuario: true, secreto_hash: true } });
  return f?.token_enc && f.habilitado && f.secreto_hash && f.bot_usuario ? { usuario: f.bot_usuario } : null;
}

/** Enlace que abre el bot con el código ya escrito (`/start <codigo>`). */
export const enlaceVinculo = (botUsuario: string, codigo: string): string => `https://t.me/${botUsuario}?start=${codigo}`;

// ---------- Webhook: secreto ----------

/** Un registro (o baja) a la vez: dos a la vez dejarían en Telegram un secreto y en la base otro. */
let enCola: Promise<unknown> = Promise.resolve();
export function enSerie<T>(tarea: () => Promise<T>): Promise<T> {
  const p = enCola.catch(() => undefined).then(tarea);
  enCola = p;
  return p;
}

/** `setWebhook` con un secreto nuevo (32 bytes aleatorios); en la base queda SÓLO su hash. */
export async function registrarWebhookTelegram(token: string): Promise<{ secreto_hash: string; url: string }> {
  const secreto = randomBytes(32).toString('hex');
  const url = urlWebhookTelegram();
  await setWebhook(token, url, secreto);
  return { secreto_hash: sha256(secreto), url };
}

// ---------- Cifrado del token ----------

export const cifrarToken = (token: string) => cifrar(token, aadTelegram());

// ---------- Enviar ----------

/** Un mensaje de texto plano (sin `parse_mode`: nada de lo que escribe el usuario o la IA se interpreta como etiquetas). */
async function enviarUno(deps: Pick<DepsAvisos, 'fetch'>, token: string, chatId: string, texto: string): Promise<ResultadoEnvio> {
  try {
    await llamar(token, 'sendMessage', { chat_id: Number(chatId), text: texto, link_preview_options: { is_disabled: true } }, deps);
    return { resultado: 'ok' };
  } catch (e) {
    const causa = e instanceof TelegramFallo ? e.causa : 'error';
    // 403 = la persona bloqueó el bot o borró el chat: no se reintenta.
    if (e instanceof TelegramFallo && e.estado === 403) return { resultado: 'omitida', motivo: 'Telegram: el chat no acepta mensajes' };
    return { resultado: 'fallo', motivo: `Telegram: ${causa}${e instanceof TelegramFallo && e.estado ? ` ${e.estado}` : ''}` };
  }
}

/** Envía un texto (partido en mensajes de ≤ 4.000 caracteres) a un chat. Con `deps` se usa desde la cola de avisos. */
export async function enviarTelegram(deps: Pick<DepsAvisos, 'fetch'>, chatId: string | null, texto: string): Promise<ResultadoEnvio> {
  if (!chatId || !/^\d{1,15}$/.test(chatId)) return { resultado: 'omitida', motivo: 'Sin chat de Telegram' };
  const cfg = await cargarConfig();
  if (!cfg || !cfg.habilitado) return { resultado: 'omitida', motivo: 'Canal no configurado' };
  let ultimo: ResultadoEnvio = { resultado: 'omitida', motivo: 'Sin texto' };
  for (const parte of partirMensaje(texto, MAX_MENSAJE_TELEGRAM)) {
    ultimo = await enviarUno(deps, cfg.token, chatId, parte);
    if (ultimo.resultado !== 'ok') return ultimo;
  }
  return ultimo;
}

/** Responde a un chat; un fallo de envío no tumba el procesamiento. */
export const responderTelegram = (chatId: string, texto: string): Promise<ResultadoEnvio> => enviarTelegram(canalesDeps, chatId, texto);

// ---------- Descargar ----------

/** Lee el cuerpo con tope: corta apenas se pasa de `max` (no se carga un archivo enorme en memoria). */
async function leerConTope(r: Response, max: number): Promise<Buffer> {
  const declarado = Number(r.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > max) throw new TelegramFallo('grande');
  if (!r.body) {
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > max) throw new TelegramFallo('grande');
    return b;
  }
  const trozos: Buffer[] = [];
  let total = 0;
  const lector = r.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await lector.cancel().catch(() => undefined);
      throw new TelegramFallo('grande');
    }
    trozos.push(Buffer.from(value));
  }
  return Buffer.concat(trozos);
}

/**
 * `getFile` + descarga desde `api.telegram.org/file/bot<token>/<file_path>`. Rechaza por `file_size` (el del mensaje y el de `getFile`) ANTES de bajar,
 * y corta la descarga si se pasa del tope aunque el tamaño declarado mintiera.
 */
export async function descargarArchivoTelegram(fileId: string, max: number): Promise<Buffer> {
  const cfg = await cargarConfig();
  if (!cfg || !cfg.habilitado) throw new TelegramFallo('sin_configurar');
  const f = (await llamar(cfg.token, 'getFile', { file_id: fileId })) as { file_path?: unknown; file_size?: unknown } | null;
  if (typeof f?.file_size === 'number' && f.file_size > max) throw new TelegramFallo('grande');
  if (typeof f?.file_path !== 'string' || !FORMATO_RUTA_ARCHIVO.test(f.file_path) || f.file_path.split('/').includes('..')) throw new TelegramFallo('error', 200);
  let r: Response;
  try {
    r = await canalesDeps.fetch(`${HOST_TELEGRAM}/file/bot${cfg.token}/${f.file_path}`, { method: 'GET', signal: AbortSignal.timeout(TIEMPO_MAX_MS) });
  } catch (e) {
    throw new TelegramFallo(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'sin_conexion');
  }
  if (!r.ok) throw new TelegramFallo('error', r.status);
  return leerConTope(r, max);
}
