import { enviarWhatsapp, type ResultadoEnvio } from '../avisos/canales';
import { MOTIVO_TOPE_WHATSAPP, reservarConsumo } from '../comercial/consumo';
import { canalesDeps } from './deps';

const TIEMPO_MAX_MS = 15_000;
/** Cabecera con la que Evolution presenta el secreto de la instancia en cada llamada al webhook. */
export const CABECERA_SECRETO = 'x-house-secret';
/** Mensajes de WhatsApp: tope por mensaje (el límite real es mayor; se corta antes para no rozarlo). */
export const MAX_MENSAJE = 4000;

export class EvolutionFallo extends Error {
  causa: 'sin_configurar' | 'sin_conexion' | 'timeout' | 'error';
  estado: number | null;
  constructor(causa: EvolutionFallo['causa'], estado: number | null = null) {
    super(`evolution: ${causa}${estado ? ` ${estado}` : ''}`);
    this.causa = causa;
    this.estado = estado;
  }
}

/** Llamada a la Evolution API con la apikey global; el mensaje del error nunca lleva la URL ni la clave. */
async function llamar(endpoint: string, method: 'GET' | 'POST', body?: Record<string, unknown>, tiempoMs: number = TIEMPO_MAX_MS): Promise<unknown> {
  const { env } = canalesDeps;
  const base = env.EVOLUTION_URL?.trim().replace(/\/+$/, '');
  if (!base) throw new EvolutionFallo('sin_configurar');
  let r: Response;
  try {
    r = await canalesDeps.fetch(`${base}${endpoint}`, {
      method,
      headers: { apikey: env.EVOLUTION_APIKEY?.trim() ?? '', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(tiempoMs),
    });
  } catch (e) {
    throw new EvolutionFallo(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'sin_conexion');
  }
  if (!r.ok) throw new EvolutionFallo('error', r.status);
  try {
    return await r.json();
  } catch (e) {
    // El tope también corta la lectura del cuerpo: eso es un timeout, no «respuesta rara».
    throw new EvolutionFallo(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'error', r.status);
  }
}

/** Registra el webhook de la instancia (cuerpo de Evolution v2 con el objeto `webhook`). El secreto viaja en una cabecera propia. */
export async function ponerWebhook(instancia: string, url: string, secreto: string): Promise<void> {
  await llamar(`/webhook/set/${encodeURIComponent(instancia)}`, 'POST', {
    webhook: {
      enabled: true,
      url,
      headers: { [CABECERA_SECRETO]: secreto, 'Content-Type': 'application/json' },
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT'],
    },
  });
}

export interface MedioDescargado { base64: string; mimetype: string | null }

/** Baja el medio (imagen/documento) de un mensaje recibido, descifrado por Evolution. */
export async function descargarMedio(instancia: string, mensajeId: string): Promise<MedioDescargado> {
  const r = (await llamar(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`, 'POST', { message: { key: { id: mensajeId } }, convertToMp4: false })) as { base64?: unknown; mimetype?: unknown } | null;
  if (typeof r?.base64 !== 'string' || !r.base64) throw new EvolutionFallo('error', 200);
  return { base64: r.base64, mimetype: typeof r.mimetype === 'string' ? r.mimetype : null };
}

/** Número de WhatsApp de la instancia (sólo dígitos) o null si Evolution no lo dice. */
export async function numeroDeInstancia(instancia: string): Promise<string | null> {
  try {
    const r = await llamar(`/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`, 'GET');
    const fila = (Array.isArray(r) ? r[0] : r) as Record<string, unknown> | undefined;
    const inst = (fila?.instance as Record<string, unknown> | undefined) ?? fila;
    const crudo = [inst?.ownerJid, inst?.owner, inst?.number, inst?.wuid].find((v) => typeof v === 'string') as string | undefined;
    const digitos = crudo?.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
    return digitos && digitos.length >= 8 ? digitos : null;
  } catch {
    return null;
  }
}

/** Parte un texto en mensajes de a lo más `max` caracteres, cortando en párrafos, luego en líneas y por último en espacios. */
export function partirMensaje(texto: string, max = MAX_MENSAJE): string[] {
  const limpio = texto.trim();
  if (!limpio) return [];
  if (limpio.length <= max) return [limpio];
  const partes: string[] = [];
  let resto = limpio;
  while (resto.length > max) {
    const ventana = resto.slice(0, max);
    let corte = Math.max(ventana.lastIndexOf('\n\n'), -1);
    if (corte < max * 0.4) corte = ventana.lastIndexOf('\n');
    if (corte < max * 0.4) corte = ventana.lastIndexOf(' ');
    if (corte < max * 0.4) corte = max;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes.filter(Boolean);
}

/**
 * Responde a un número por la instancia, en uno o más mensajes. Un fallo de envío no tumba el procesamiento. Con `complejoId` (una respuesta del
 * asistente) cada mensaje cuenta contra el tope de WhatsApp de ese condominio; sin él (códigos de vinculación) no cuenta ni se frena.
 */
export async function responder(instancia: string, numero: string, texto: string, opts: { complejoId?: number | null } = {}): Promise<ResultadoEnvio[]> {
  const salida: ResultadoEnvio[] = [];
  for (const parte of partirMensaje(texto)) {
    if (opts.complejoId != null && !(await reservarConsumo(opts.complejoId, 'whatsapp', canalesDeps.ahora())).permitido) {
      salida.push({ resultado: 'omitida', motivo: MOTIVO_TOPE_WHATSAPP });
      continue;
    }
    salida.push(await enviarWhatsapp(canalesDeps, instancia, numero, parte));
  }
  return salida;
}

/** JID de un grupo de WhatsApp: dígitos (con un guion en los grupos viejos) y `@g.us`. */
export const JID_GRUPO = /^\d{5,}(-\d+)?@g\.us$/;

export interface GrupoWhatsapp { jid: string; nombre: string; /** `size` de Evolution; null si no lo trae. */ miembros: number | null }

/** Tope de «Traer mis grupos»: con ~70 grupos `fetchAllGroups` tardó 16,7 s en My Workspace, así que el tope normal (15 s) no alcanza. */
export const TIEMPO_LISTA_GRUPOS_MS = 30_000;

/** Los grupos donde está el número de la instancia (sin participantes: la lista puede ser larga). El nombre sale de Evolution, nunca del cliente. Es LENTA: no va en cada pantalla ni en cada envío. */
export async function listarGrupos(instancia: string, tiempoMs: number = TIEMPO_LISTA_GRUPOS_MS): Promise<GrupoWhatsapp[]> {
  const r = await llamar(`/group/fetchAllGroups/${encodeURIComponent(instancia)}?getParticipants=false`, 'GET', undefined, tiempoMs);
  const filas = Array.isArray(r) ? r : [];
  const grupos: GrupoWhatsapp[] = [];
  for (const f of filas as Record<string, unknown>[]) {
    const jid = typeof f?.id === 'string' ? f.id : null;
    if (!jid || !JID_GRUPO.test(jid)) continue;
    const nombre = typeof f.subject === 'string' && f.subject.trim() ? f.subject.trim() : 'Grupo sin nombre';
    const miembros = typeof f.size === 'number' && Number.isFinite(f.size) && f.size >= 0 ? Math.trunc(f.size) : null;
    grupos.push({ jid, nombre, miembros });
  }
  return grupos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Sólo dígitos del identificador de un participante (`5199…@s.whatsapp.net`, `…:12@s.whatsapp.net`). */
const digitosDe = (v: unknown): string | null => (typeof v === 'string' ? v.split('@')[0]!.split(':')[0]!.replace(/\D/g, '') || null : null);

/** Números (sólo dígitos) de los participantes actuales del grupo. Evolution v2 puede traer el número en `id`, `jid` o `phoneNumber`. */
export async function participantesDeGrupo(instancia: string, jid: string): Promise<string[]> {
  const r = (await llamar(`/group/findGroupInfos/${encodeURIComponent(instancia)}?groupJid=${encodeURIComponent(jid)}`, 'GET')) as { participants?: unknown } | null;
  if (!Array.isArray(r?.participants)) throw new EvolutionFallo('error', 200);
  const numeros = new Set<string>();
  for (const p of r.participants as Record<string, unknown>[]) for (const campo of [p?.id, p?.jid, p?.phoneNumber]) {
    const n = digitosDe(campo);
    if (n) numeros.add(n);
  }
  return [...numeros];
}

/** Texto a un grupo (el JID del grupo va como `number`). Un fallo es corto y nunca lleva la URL ni la clave. */
export async function enviarAGrupo(instancia: string, jid: string, texto: string): Promise<ResultadoEnvio> {
  if (!JID_GRUPO.test(jid)) return { resultado: 'omitida', motivo: 'Grupo inválido' };
  try {
    await llamar(`/message/sendText/${encodeURIComponent(instancia)}`, 'POST', { number: jid, text: texto });
    return { resultado: 'ok' };
  } catch (e) {
    if (e instanceof EvolutionFallo && e.causa === 'sin_configurar') return { resultado: 'omitida', motivo: 'Canal no configurado' };
    return { resultado: 'fallo', motivo: e instanceof EvolutionFallo ? (e.causa === 'timeout' ? 'WhatsApp no respondió a tiempo' : e.causa === 'sin_conexion' ? 'Sin conexión con WhatsApp' : `WhatsApp respondió con error${e.estado ? ` ${e.estado}` : ''}`) : 'Error al enviar' };
  }
}
