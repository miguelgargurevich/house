import { normalizarCelular } from './celular';

export const CANALES = ['email', 'whatsapp'] as const;
export type Canal = (typeof CANALES)[number];

/** Inyectables para probar sin red ni variables reales. */
export interface DepsAvisos {
  fetch: typeof fetch;
  ahora: () => Date;
  env: NodeJS.ProcessEnv;
}

export const depsReales = (): DepsAvisos => ({ fetch: (...a) => fetch(...a), ahora: () => new Date(), env: process.env });

/** `ok`: enviado · `omitida`: no corresponde enviar (no es un fallo) · `fallo`: se reintenta. El motivo es corto y nunca lleva claves ni la respuesta del proveedor. */
export type ResultadoEnvio = { resultado: 'ok' } | { resultado: 'omitida'; motivo: string } | { resultado: 'fallo'; motivo: string };

const VARIABLES: Record<Canal, readonly string[]> = {
  email: ['RESEND_API_KEY', 'MAIL_FROM'],
  whatsapp: ['EVOLUTION_URL', 'EVOLUTION_APIKEY'],
};

const definida = (env: NodeJS.ProcessEnv, k: string) => !!env[k]?.trim();

/** Qué canales tienen sus variables; `faltan` son NOMBRES de variables, nunca valores. */
export function estadoCanales(env: NodeJS.ProcessEnv = process.env): Record<Canal, { configurado: boolean; faltan: string[]; sinNumero?: boolean }> {
  const una = (c: Canal) => {
    const faltan = VARIABLES[c].filter((k) => !definida(env, k));
    return { configurado: faltan.length === 0, faltan };
  };
  return { email: una('email'), whatsapp: una('whatsapp') };
}

const TIEMPO_MAX_MS = 10_000;
const NO_CONFIGURADO = 'Canal no configurado';

async function llamar(deps: DepsAvisos, proveedor: string, url: string, init: RequestInit): Promise<ResultadoEnvio> {
  try {
    const r = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIEMPO_MAX_MS) });
    if (r.ok) return { resultado: 'ok' };
    return { resultado: 'fallo', motivo: `${proveedor} respondió ${r.status}` };
  } catch {
    // Se descarta el mensaje del error: podría traer la URL o cabeceras con la clave.
    return { resultado: 'fallo', motivo: `Sin conexión con ${proveedor}` };
  }
}

/** Archivo adjunto de un correo (Resend lo recibe en base64). */
export interface AdjuntoCorreo { nombre: string; datos: Buffer }

/** Correo por la API HTTP de Resend; `adjuntos` es opcional (sin él el cuerpo es el de siempre). */
export async function enviarCorreo(deps: DepsAvisos, destino: string | null, asunto: string, cuerpo: string, adjuntos?: AdjuntoCorreo[]): Promise<ResultadoEnvio> {
  if (!estadoCanales(deps.env).email.configurado) return { resultado: 'omitida', motivo: NO_CONFIGURADO };
  if (!destino) return { resultado: 'omitida', motivo: 'Sin correo' };
  return llamar(deps, 'Resend', 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deps.env.RESEND_API_KEY!.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: deps.env.MAIL_FROM!.trim(), to: [destino], subject: asunto, text: cuerpo,
      ...(adjuntos?.length ? { attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.datos.toString('base64') })) } : {}),
    }),
  });
}

/** WhatsApp por la Evolution API del VPS (`sendText`); el texto es el cuerpo. La instancia es la de la administradora. */
export async function enviarWhatsapp(deps: DepsAvisos, instancia: string | null, celular: string | null, cuerpo: string): Promise<ResultadoEnvio> {
  if (!estadoCanales(deps.env).whatsapp.configurado) return { resultado: 'omitida', motivo: NO_CONFIGURADO };
  if (!instancia?.trim()) return { resultado: 'omitida', motivo: 'Sincronización de WhatsApp no configurada para la administradora' };
  const numero = normalizarCelular(celular);
  if (!numero) return { resultado: 'omitida', motivo: celular ? 'Celular inválido' : 'Sin celular' };
  const base = deps.env.EVOLUTION_URL!.trim().replace(/\/+$/, '');
  return llamar(deps, 'Evolution', `${base}/message/sendText/${encodeURIComponent(instancia.trim())}`, {
    method: 'POST',
    headers: { apikey: deps.env.EVOLUTION_APIKEY!.trim(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: numero, text: cuerpo }),
  });
}
