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
async function llamar(endpoint: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<unknown> {
  const { env } = canalesDeps;
  const base = env.EVOLUTION_URL?.trim().replace(/\/+$/, '');
  if (!base) throw new EvolutionFallo('sin_configurar');
  let r: Response;
  try {
    r = await canalesDeps.fetch(`${base}${endpoint}`, {
      method,
      headers: { apikey: env.EVOLUTION_APIKEY?.trim() ?? '', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIEMPO_MAX_MS),
    });
  } catch (e) {
    throw new EvolutionFallo(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'sin_conexion');
  }
  if (!r.ok) throw new EvolutionFallo('error', r.status);
  try {
    return await r.json();
  } catch {
    throw new EvolutionFallo('error', r.status);
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
