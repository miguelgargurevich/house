import fs from 'node:fs';
import path from 'node:path';
import { Router, type Response } from 'express';
import { parsearRetryAfter, registrarEstado, limpiar } from '../lib/cooldown';
import { cabecerasDe, llaveroDeps } from '../services/llavero';
import { construirCadena, contarUso, marcarUso, rechazarClave, type Eslabon } from '../services/rotacion';
import { z } from '../validation';

/** Eslabones que se prueban como máximo por consulta; `LLAVERO_MAX_INTENTOS` (1–8) lo cambia. */
export const MAX_INTENTOS = 4;
function maxIntentos(): number {
  const n = Number(process.env.LLAVERO_MAX_INTENTOS);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : MAX_INTENTOS;
}

type Respuesta = { ok: boolean; status: number; texto: string; retryAfterMs: number | null };

async function consultar({ proveedor, clave, modelo }: Eslabon, prompt: string): Promise<Respuesta> {
  // La clave va en cabecera, no en la URL, para que no quede en logs de proxies.
  const gemini = proveedor.tipo === 'gemini';
  const url = gemini ? `${proveedor.baseUrl}/models/${encodeURIComponent(modelo)}:generateContent` : `${proveedor.baseUrl}/chat/completions`;
  const cuerpo = gemini
    ? { contents: [{ role: 'user', parts: [{ text: prompt }] }] }
    : { model: modelo, messages: [{ role: 'user', content: prompt }] };
  const r = await llaveroDeps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecerasDe(proveedor, clave) },
    body: JSON.stringify(cuerpo),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const crudo = await r.text().catch(() => '');
  let data: {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    choices?: { message?: { content?: string } }[];
  } = {};
  try { data = JSON.parse(crudo); } catch { /* cuerpo no JSON */ }
  const texto = gemini ? data.candidates?.[0]?.content?.parts?.[0]?.text : data.choices?.[0]?.message?.content;
  // El cuerpo del proveedor sólo se mira para la espera; nunca se loguea ni se devuelve.
  const retryAfterMs = r.status === 429 ? parsearRetryAfter(r.headers.get('retry-after'), crudo) : null;
  return { ok: r.ok, status: r.status, texto: typeof texto === 'string' ? texto : '', retryAfterMs };
}

type Resultado = { texto: string } | { error: 'saturada' | 'fallo' };

/** Recorre la cadena (hasta `maxIntentos()` eslabones): rota ante 429, 5xx, red y claves rechazadas; un 400 es culpa de la petición y no rota. */
async function responderConRotacion(cadena: Eslabon[], prompt: string): Promise<Resultado> {
  let intentos = 0;
  let todos429 = true;
  for (const e of cadena.slice(0, maxIntentos())) {
    intentos++;
    const id = `${e.proveedor.id}#${e.claveId ?? 'env'}`;
    try {
      const r = await consultar(e, prompt);
      const texto = r.texto.replace(/€(\d+)/g, '$$$1 USD');
      if (r.ok && texto.trim()) {
        limpiar(e.cooldownKey);
        contarUso(e.claveId, 'ok');
        if (e.claveId !== null) await marcarUso(e.claveId);
        return { texto };
      }
      console.warn(`[ai-chat] ${id} respondió ${r.status}${r.ok ? ' sin texto' : ''}`);
      if (r.status === 400) return { error: 'fallo' };
      if (r.status === 429) {
        registrarEstado(e.cooldownKey, 429, r.retryAfterMs);
        contarUso(e.claveId, 'limite');
        continue;
      }
      todos429 = false;
      contarUso(e.claveId, 'error');
      if (r.status === 401 || r.status === 402 || r.status === 403) {
        await rechazarClave(e, r.status);
        if (e.claveId === null) registrarEstado(e.cooldownKey, 500); // el respaldo del entorno no se persiste: sólo se enfría
      } else {
        registrarEstado(e.cooldownKey, r.status >= 500 ? r.status : 500);
      }
    } catch (err) {
      todos429 = false;
      registrarEstado(e.cooldownKey, 0);
      contarUso(e.claveId, 'error');
      console.warn(`[ai-chat] ${id} falló la llamada (${err instanceof Error ? err.name : 'error'})`);
    }
  }
  return { error: todos429 && intentos > 0 ? 'saturada' : 'fallo' };
}

// Las respuestas conservan la forma histórica que lee el chat: { response } o { error: { code, message } }.
const fallo = (res: Response, code: number, message: string) => res.status(code).json({ error: { code, message } });

const bodySchema = z.object({
  message: z.string().trim().min(1, 'El mensaje es obligatorio.').max(4000, 'El mensaje es demasiado largo.'),
  context: z.string().max(8000).optional(),
  conversationContext: z.string().max(8000).optional(),
  sessionId: z.string().max(100).optional(),
  sentiment: z.object({ label: z.string().max(40).optional(), score: z.union([z.number(), z.string().max(20)]).optional() }).optional(),
  userSentiment: z.object({ label: z.string().max(40).optional(), score: z.union([z.number(), z.string().max(20)]).optional() }).optional(),
});

let systemPrompt: string | undefined;
function leerSystemPrompt(): string {
  systemPrompt ??= fs.readFileSync(path.join(process.cwd(), 'src', 'config', 'ai-system-prompt.txt'), 'utf8');
  return systemPrompt;
}

/** Se monta DESPUÉS de `authenticate` y del limitador por usuario. */
export const aiChatRouter = Router();

aiChatRouter.post('/', async (req, res) => {
  const cadena = await construirCadena();
  if (cadena.length === 0) return fallo(res, 500, 'La IA no está configurada en el servidor. Contacta al administrador.');

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return fallo(res, 400, parsed.error.issues[0]?.message ?? 'Petición inválida.');
  const { message, context, conversationContext, sessionId, sentiment, userSentiment } = parsed.data;

  let prompt: string;
  try {
    prompt = `${leerSystemPrompt()}\n`;
  } catch {
    console.error('[ai-chat] no se pudo leer el prompt de sistema');
    return fallo(res, 500, 'No se pudo preparar la consulta a la IA.');
  }
  if (conversationContext) prompt += `CONTEXTO DE LA CONVERSACIÓN:\n${conversationContext}\n`;
  else if (context) prompt += `CONVERSACIÓN PREVIA:\n${context}\n`;
  const s = userSentiment ?? sentiment;
  if (s) {
    const label = s.label ?? '';
    prompt += `ANÁLISIS DE SENTIMIENTO DEL CLIENTE:\n- Sentimiento: ${label} (puntuación: ${s.score ?? ''})\n`;
    if (label.includes('negative')) prompt += '- INSTRUCCIÓN: El cliente muestra sentimiento negativo. Usa un tono empático.\n';
    else if (label.includes('positive')) prompt += '- INSTRUCCIÓN: El cliente muestra entusiasmo. Mantén el tono positivo.\n';
    prompt += '\n';
  }
  if (sessionId) prompt += `ID de Sesión: ${sessionId}\n`;
  prompt += `\nMENSAJE DEL USUARIO:\n${message}\n`;

  const r = await responderConRotacion(cadena, prompt);
  if ('texto' in r) return res.json({ response: r.texto });
  if (r.error === 'saturada') return fallo(res, 429, 'La IA está saturada o se superó la cuota. Intenta nuevamente en unos minutos.');
  fallo(res, 503, 'El servicio de IA no pudo responder. Intenta de nuevo más tarde.');
});
