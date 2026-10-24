// Llamada de bajo nivel a un proveedor de IA: arma el cuerpo (traduciendo los parámetros del turno a lo que entiende cada
// proveedor), abre la respuesta (completa o en streaming SSE) y clasifica los fallos. No rota ni decide nada: eso es del motor.
import { parsearRetryAfter } from '../../lib/cooldown';
import {
  MARGEN_RAZONAMIENTO, PRESUPUESTO_PENSAR_GEMINI, aceptaTopK, admiteEsfuerzo, geminiAdmitePensar,
  type Esfuerzo, type ParametrosGeneracion,
} from '../../lib/modelosIA';
import { cabecerasDe, llaveroDeps } from '../llavero';
import type { Eslabon } from '../rotacion';

export interface MensajeTurno { rol: 'user' | 'assistant'; texto: string }
/** Lo que se le manda al modelo: instrucciones del sistema (prompt + datos verificados) y la conversación. */
export interface Turno { sistema: string; mensajes: MensajeTurno[] }

export interface OpcionesLlamada {
  parametros: ParametrosGeneracion;
  esfuerzo: Esfuerzo;
  /** `false` = reintento sin los parámetros opcionales (temperatura, top‑p/k, esfuerzo, razonamiento). */
  opcionales: boolean;
  stream: boolean;
  signal?: AbortSignal;
  /** Tope hasta recibir la primera respuesta (ms). */
  esperaMs: number;
}

export interface Uso { entrada: number | null; salida: number | null }

export interface Fallo {
  tipo: 'fallo';
  /** 0 = red o tiempo agotado. */
  status: number;
  retryAfterMs: number | null;
  claveInvalida: boolean;
  /** 404 (o 400) por un modelo que no existe, fue retirado o no sirve para esta clave. */
  modeloNoDisponible: boolean;
  /** 200 pero sin texto. */
  sinTexto: boolean;
  /** El cliente canceló (no es culpa del proveedor). */
  cancelado: boolean;
  /** Se acabó el tiempo de espera (status 0). */
  tiempoAgotado: boolean;
}
export interface Completa { tipo: 'completa'; texto: string; uso: Uso }
export interface Flujo { tipo: 'flujo'; primero: string; resto: AsyncGenerator<string, void, void>; uso: () => Uso; cerrar: () => void }
export type Salida = Completa | Flujo | Fallo;

/** ¿Falló por tiempo agotado? */
const esTiempoAgotado = (err: unknown) => err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

const fallo = (p: Partial<Fallo>): Fallo => ({ tipo: 'fallo', status: 0, retryAfterMs: null, claveInvalida: false, modeloNoDisponible: false, sinTexto: false, cancelado: false, tiempoAgotado: false, ...p });

const RE_MODELO = /model[^"]{0,80}(decommission|not found|does not exist|not supported|unknown|no longer|not available|deprecated)|decommissioned|not a valid model|invalid model|is not found for api version|no endpoints found/i;
/** ¿El proveedor dice que el MODELO no sirve? Un 404 de una URL fija siempre lo es; el 400 sólo si el cuerpo lo menciona. */
export const esModeloNoDisponible = (status: number, cuerpo: string) => status === 404 || (status === 400 && RE_MODELO.test(cuerpo));

// ---------- Cuerpo según el proveedor ----------
interface CuerpoOpts { modelo: string; turno: Turno; o: OpcionesLlamada }

function cuerpoGemini({ modelo, turno, o }: CuerpoOpts) {
  const cuerpo: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: turno.sistema }] },
    contents: turno.mensajes.map((m) => ({ role: m.rol === 'user' ? 'user' : 'model', parts: [{ text: m.texto }] })),
  };
  if (o.opcionales) {
    const gc: Record<string, unknown> = { temperature: o.parametros.temperature, topP: o.parametros.topP, topK: o.parametros.topK, maxOutputTokens: o.parametros.maxTokens };
    if (geminiAdmitePensar(modelo)) {
      // Los tokens de «pensar» cuentan contra el tope de salida: se suma el presupuesto para no cortar la respuesta.
      const presupuesto = PRESUPUESTO_PENSAR_GEMINI[o.esfuerzo];
      gc.thinkingConfig = { thinkingBudget: presupuesto };
      gc.maxOutputTokens = o.parametros.maxTokens + presupuesto;
    }
    cuerpo.generationConfig = gc;
  }
  return cuerpo;
}

function cuerpoCompatible(e: Eslabon, { modelo, turno, o }: CuerpoOpts) {
  const cuerpo: Record<string, unknown> = {
    model: modelo,
    messages: [{ role: 'system', content: turno.sistema }, ...turno.mensajes.map((m) => ({ role: m.rol, content: m.texto }))],
  };
  if (o.stream) { cuerpo.stream = true; if (o.opcionales) cuerpo.stream_options = { include_usage: true }; }
  if (o.opcionales) {
    const razona = admiteEsfuerzo(modelo);
    cuerpo.temperature = o.parametros.temperature;
    cuerpo.top_p = o.parametros.topP;
    if (aceptaTopK(e.proveedor)) cuerpo.top_k = o.parametros.topK;
    // Los tokens de razonamiento cuentan contra el tope: sin margen la respuesta llega vacía.
    const tope = o.parametros.maxTokens + (razona ? MARGEN_RAZONAMIENTO[o.esfuerzo] : 0);
    cuerpo[e.proveedor.id === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = tope;
    if (razona) cuerpo.reasoning_effort = o.esfuerzo;
  }
  return cuerpo;
}

// ---------- Lectura de respuestas ----------
type Partes = { text?: string; thought?: boolean }[];
interface Dato {
  candidates?: { content?: { parts?: Partes } }[];
  choices?: { message?: { content?: unknown }; delta?: { content?: unknown } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function textoDe(d: Dato, gemini: boolean, delta: boolean): string {
  if (gemini) return (d.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  const c = delta ? d.choices?.[0]?.delta?.content : d.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}
function usoDe(d: Dato, previo: Uso): Uso {
  return {
    entrada: num(d.usageMetadata?.promptTokenCount) ?? num(d.usage?.prompt_tokens) ?? previo.entrada,
    salida: num(d.usageMetadata?.candidatesTokenCount) ?? num(d.usage?.completion_tokens) ?? previo.salida,
  };
}

/** Eventos `data:` de un cuerpo SSE, de a uno. */
async function* eventosSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const lector = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const bloque = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const datos = bloque.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (datos) yield datos;
      }
    }
    const resto = buf.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (resto) yield resto;
  } finally {
    await lector.cancel().catch(() => undefined);
  }
}

/**
 * Llama al proveedor. Con `stream` abre la respuesta y espera al PRIMER texto: si falla antes de eso devuelve un `Fallo`
 * (el motor rota sin que el cliente lo note); lo que venga después se lee del `Flujo`. Si el proveedor/modelo no sirve el
 * stream y responde con JSON completo, se devuelve como `Completa`.
 * La clave va en cabecera, no en la URL, para que no quede en logs de proxies. Lo que diga el proveedor jamás se loguea.
 */
export async function llamarProveedor(e: Eslabon, modelo: string, turno: Turno, o: OpcionesLlamada): Promise<Salida> {
  const gemini = e.proveedor.tipo === 'gemini';
  const url = gemini
    ? `${e.proveedor.baseUrl}/models/${encodeURIComponent(modelo)}:${o.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
    : `${e.proveedor.baseUrl}/chat/completions`;
  const cuerpo = gemini ? cuerpoGemini({ modelo, turno, o }) : cuerpoCompatible(e, { modelo, turno, o });

  const control = new AbortController();
  const cancelaUsuario = () => control.abort(o.signal?.reason ?? new DOMException('cancelado', 'AbortError'));
  if (o.signal?.aborted) return fallo({ cancelado: true });
  o.signal?.addEventListener('abort', cancelaUsuario, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => control.abort(new DOMException('tiempo agotado', 'TimeoutError')), o.esperaMs);
  timer.unref?.();
  const limpiar = () => { if (timer) clearTimeout(timer); timer = undefined; o.signal?.removeEventListener('abort', cancelaUsuario); };

  try {
    const r = await llaveroDeps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: o.stream ? 'text/event-stream' : 'application/json', ...cabecerasDe(e.proveedor, e.clave) },
      body: JSON.stringify(cuerpo),
      redirect: 'manual',
      signal: control.signal,
    });

    if (!r.ok) {
      const crudo = await r.text().catch(() => '');
      limpiar();
      return fallo({
        status: r.status,
        retryAfterMs: r.status === 429 ? parsearRetryAfter(r.headers.get('retry-after'), crudo) : null,
        // Gemini responde 400 (no 401) ante una clave inválida: eso es una clave rechazada, no una petición mala.
        claveInvalida: r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(crudo),
        modeloNoDisponible: esModeloNoDisponible(r.status, crudo),
      });
    }

    const tipo = r.headers.get('content-type') ?? '';
    if (!o.stream || !/text\/event-stream/i.test(tipo) || !r.body) {
      // Respuesta completa (la pedida, o el proveedor no sirve el stream y contestó con JSON).
      const crudo = await r.text().catch(() => '');
      limpiar();
      let d: Dato = {};
      try { d = JSON.parse(crudo) as Dato; } catch { /* cuerpo no JSON */ }
      const texto = textoDe(d, gemini, false);
      if (!texto.trim()) return fallo({ status: r.status, sinTexto: true });
      return { tipo: 'completa', texto, uso: usoDe(d, { entrada: null, salida: null }) };
    }

    // Streaming: se espera al primer texto; si el flujo termina sin nada, es un fallo previo al primer byte.
    let uso: Uso = { entrada: null, salida: null };
    const eventos = eventosSse(r.body);
    async function* textos(): AsyncGenerator<string, void, void> {
      for await (const crudo of eventos) {
        if (crudo.trim() === '[DONE]') return;
        let d: Dato;
        try { d = JSON.parse(crudo) as Dato; } catch { continue; }
        uso = usoDe(d, uso);
        const t = textoDe(d, gemini, true);
        if (t) yield t;
      }
    }
    const it = textos();
    let primero: IteratorResult<string, void>;
    try {
      primero = await it.next();
    } catch (err) {
      limpiar();
      if (o.signal?.aborted) return fallo({ cancelado: true });
      return fallo({ status: 0, tiempoAgotado: esTiempoAgotado(err) });
    }
    if (primero.done) { limpiar(); return fallo({ status: r.status, sinTexto: true }); }
    // Con el primer texto ya no vale el tope de «primera respuesta»; queda un tope general largo.
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => control.abort(new DOMException('tiempo agotado', 'TimeoutError')), 120_000);
    timer.unref?.();
    return {
      tipo: 'flujo',
      primero: primero.value,
      resto: (async function* () { try { yield* it; } finally { limpiar(); } })(),
      uso: () => uso,
      cerrar: () => { control.abort(new DOMException('cerrado', 'AbortError')); limpiar(); },
    };
  } catch (err) {
    limpiar();
    if (o.signal?.aborted) return fallo({ cancelado: true });
    return fallo({ status: 0, tiempoAgotado: esTiempoAgotado(err) });
  }
}


/** Consulta mínima de chat (≈ 8 tokens, 10 s): la usan la «Prueba», la recuperación de claves rechazadas y el canary. */
export const TOPE_CONSULTA_MINIMA_MS = 10_000;
export async function consultaMinima(e: Eslabon, modelo: string, signal?: AbortSignal): Promise<Completa | Fallo> {
  const turno: Turno = { sistema: 'Responde con una sola palabra.', mensajes: [{ rol: 'user', texto: 'Di ok.' }] };
  const base = { parametros: { temperature: 0, maxTokens: 8, topP: 1, topK: 1 }, esfuerzo: 'low' as const, stream: false, signal, esperaMs: TOPE_CONSULTA_MINIMA_MS };
  let s = (await llamarProveedor(e, modelo, turno, { ...base, opcionales: true })) as Completa | Fallo; // `stream: false` nunca devuelve un flujo
  // Un modelo que no admite algún parámetro opcional no es un modelo caído: UNA vez más, sin ellos.
  if (s.tipo === 'fallo' && s.status === 400 && !s.claveInvalida && !s.modeloNoDisponible) s = (await llamarProveedor(e, modelo, turno, { ...base, opcionales: false })) as Completa | Fallo;
  return s;
}
