import fs from 'node:fs';
import path from 'node:path';
import { Router, type Response } from 'express';
import { z } from '../validation';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallo(res, 500, 'La IA no está configurada en el servidor. Contacta al administrador.');

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

  try {
    // La clave va en cabecera, no en la URL, para que no quede en logs de proxies.
    const r = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    if (!r.ok) {
      if (r.status === 429) return fallo(res, 429, 'La IA está saturada o se superó la cuota. Intenta nuevamente en unos minutos.');
      console.error(`[ai-chat] el proveedor respondió ${r.status}`);
      return fallo(res, 503, 'El servicio de IA no pudo responder. Intenta de nuevo más tarde.');
    }
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').replace(/€(\d+)/g, '$$$1 USD');
    if (!text.trim()) return fallo(res, 503, 'El servicio de IA no está disponible. Intenta de nuevo más tarde.');
    res.json({ response: text });
  } catch (err) {
    console.error('[ai-chat] falló la llamada al proveedor', err instanceof Error ? err.name : 'error');
    fallo(res, 503, 'El servicio de IA no está disponible. Intenta de nuevo más tarde.');
  }
});
