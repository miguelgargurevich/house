// Proveedores de IA falsos para las pruebas: nada sale a la red. Un solo manejador recibe cada llamada ya «entendida»
// (proveedor, modelo, si es lista o chat, si pide stream) y devuelve la `Response` que corresponda.
import { llaveroDeps } from '../../src/server/services/llavero';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface LlamadaIA {
  url: string;
  metodo: string;
  clave: string;
  cuerpo: any;
  signal: AbortSignal | null | undefined;
  proveedor: string;
  modelo: string | null;
  esLista: boolean;
  stream: boolean;
}

export function proveedorDeUrl(url: string): string {
  if (url.includes('generativelanguage')) return 'gemini';
  if (url.includes('groq.com')) return 'groq';
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('openai.com')) return 'openai';
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('mistral')) return 'mistral';
  return 'desconocido';
}

export function entender(url: string, init: RequestInit = {}): LlamadaIA {
  const h = (init.headers ?? {}) as Record<string, string>;
  const metodo = init.method ?? 'GET';
  const cuerpo = init.body ? JSON.parse(String(init.body)) : null;
  const proveedor = proveedorDeUrl(url);
  const esLista = metodo === 'GET';
  const gemini = proveedor === 'gemini';
  const modelo = esLista ? null : gemini ? decodeURIComponent(/\/models\/([^:/?]+)/.exec(url)?.[1] ?? '') : (cuerpo?.model ?? null);
  const stream = !esLista && (gemini ? url.includes('streamGenerateContent') : cuerpo?.stream === true);
  return { url, metodo, clave: h['x-goog-api-key'] ?? (h.Authorization ?? '').replace('Bearer ', ''), cuerpo, signal: init.signal, proveedor, modelo, esLista, stream };
}

/** Instala el manejador y devuelve las llamadas capturadas; `restaurar()` deja el `fetch` original. */
export function instalarIA(manejador: (l: LlamadaIA) => Response | Promise<Response>) {
  const original = llaveroDeps.fetch;
  const llamadas: LlamadaIA[] = [];
  llaveroDeps.fetch = async (url, init) => {
    const l = entender(url, init);
    llamadas.push(l);
    return manejador(l);
  };
  return { llamadas, restaurar: () => { llaveroDeps.fetch = original; } };
}

export const json = (cuerpo: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(cuerpo), { status, headers });
export const estado = (status: number, headers: Record<string, string> = {}, cuerpo = '{"error":"cuerpo-secreto-del-proveedor"}') => new Response(cuerpo, { status, headers });

/** Respuesta completa de chat válida para Gemini y compatibles, con uso de tokens. */
export const chatOk = (texto: string, uso = { entrada: 11, salida: 7 }) =>
  json({
    choices: [{ message: { content: texto } }],
    candidates: [{ content: { parts: [{ text: texto }] } }],
    usage: { prompt_tokens: uso.entrada, completion_tokens: uso.salida },
    usageMetadata: { promptTokenCount: uso.entrada, candidatesTokenCount: uso.salida },
  });

export const listaGemini = (...ids: string[]) => json({ models: ids.map((id) => ({ name: `models/${id}`, displayName: id, inputTokenLimit: 1_000_000, supportedGenerationMethods: ['generateContent'] })) });
export const listaCompat = (...ids: string[]) => json({ data: ids.map((id) => ({ id, name: `Pantalla ${id}` })) });

const enc = new TextEncoder();
type Fragmento = string | { usoEntrada?: number; usoSalida?: number };

function lineaSse(proveedor: string, f: Fragmento): string {
  if (typeof f === 'string') {
    const dato = proveedor === 'gemini' ? { candidates: [{ content: { parts: [{ text: f }] } }] } : { choices: [{ delta: { content: f } }] };
    return `data: ${JSON.stringify(dato)}\n\n`;
  }
  const dato = proveedor === 'gemini'
    ? { candidates: [{ content: { parts: [{ text: '' }] } }], usageMetadata: { promptTokenCount: f.usoEntrada, candidatesTokenCount: f.usoSalida } }
    : { choices: [], usage: { prompt_tokens: f.usoEntrada, completion_tokens: f.usoSalida } };
  return `data: ${JSON.stringify(dato)}\n\n`;
}

/** Respuesta SSE completa de un proveedor. */
export function flujoSse(proveedor: string, ...fragmentos: Fragmento[]): Response {
  const cuerpo = fragmentos.map((f) => lineaSse(proveedor, f)).join('') + (proveedor === 'gemini' ? '' : 'data: [DONE]\n\n');
  return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(cuerpo)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Flujo que se controla a mano: enviar fragmentos, cerrar o fallar a mitad. Se corta solo si la llamada se aborta. */
export function flujoManual(proveedor: string, signal?: AbortSignal | null) {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } });
  let abortado = false;
  signal?.addEventListener('abort', () => { abortado = true; try { ctl.error(new DOMException('abortado', 'AbortError')); } catch { /* ya cerrado */ } }, { once: true });
  return {
    response: new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    enviar: (f: Fragmento) => ctl.enqueue(enc.encode(lineaSse(proveedor, f))),
    cerrar: () => { if (proveedor !== 'gemini') ctl.enqueue(enc.encode('data: [DONE]\n\n')); ctl.close(); },
    fallar: () => ctl.error(new TypeError('terminated')),
    abortado: () => abortado,
  };
}

export interface EventoSse { evento: string; datos: any }
export function parsearSse(texto: string): EventoSse[] {
  return texto.split(/\n\n/).filter((b) => b.trim()).map((b) => {
    const evento = /^event: (.*)$/m.exec(b)?.[1] ?? 'message';
    const datos = /^data: (.*)$/m.exec(b)?.[1];
    return { evento, datos: datos ? JSON.parse(datos) : null };
  });
}

/** Texto de instrucciones del sistema que recibió el modelo (ya sea Gemini o compatible). */
export const sistemaDe = (l: LlamadaIA): string => (l.proveedor === 'gemini' ? l.cuerpo.systemInstruction.parts[0].text : l.cuerpo.messages[0].content);
/** Conversación que recibió el modelo, como [{rol, texto}]. */
export const mensajesDe = (l: LlamadaIA): { rol: string; texto: string }[] =>
  l.proveedor === 'gemini'
    ? l.cuerpo.contents.map((c: any) => ({ rol: c.role === 'model' ? 'assistant' : 'user', texto: c.parts[0].text }))
    : l.cuerpo.messages.slice(1).map((m: any) => ({ rol: m.role, texto: m.content }));

// ---------- Herramientas (tool-calling) ----------
export interface PedidoHerramienta { nombre: string; args?: unknown }
/** El modelo pide herramientas (Gemini: partes `functionCall`; compatible: `tool_calls`). */
export function pideHerramientas(proveedor: string, ...pedidos: PedidoHerramienta[]): Response {
  if (proveedor === 'gemini') {
    return json({
      candidates: [{ content: { role: 'model', parts: pedidos.map((p) => ({ functionCall: { name: p.nombre, args: p.args ?? {} } })) } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
    });
  }
  return json({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: pedidos.map((p, i) => ({ id: `call_${i}`, type: 'function', function: { name: p.nombre, arguments: JSON.stringify(p.args ?? {}) } })) } }],
    usage: { prompt_tokens: 20, completion_tokens: 5 },
  });
}
/** Herramientas declaradas en la petición, por nombre. */
export const herramientasDeclaradas = (l: LlamadaIA): string[] =>
  l.proveedor === 'gemini' ? (l.cuerpo.tools?.[0]?.functionDeclarations ?? []).map((d: any) => d.name) : (l.cuerpo.tools ?? []).map((t: any) => t.function.name);
/** Resultados de herramientas que ya trae la petición (lo que se le devolvió al modelo), ya convertidos a objetos. */
export const resultadosDe = (l: LlamadaIA): { nombre: string; contenido: any }[] =>
  l.proveedor === 'gemini'
    ? l.cuerpo.contents.flatMap((c: any) => c.parts.filter((p: any) => p.functionResponse).map((p: any) => ({ nombre: p.functionResponse.name, contenido: p.functionResponse.response })))
    : l.cuerpo.messages.filter((m: any) => m.role === 'tool').map((m: any) => ({ nombre: m.tool_call_id, contenido: JSON.parse(m.content) }));
/** ¿La petición obliga a contestar con texto (última ronda)? */
export const fuerzaTexto = (l: LlamadaIA): boolean => (l.proveedor === 'gemini' ? l.cuerpo.toolConfig?.functionCallingConfig?.mode === 'NONE' : l.cuerpo.tool_choice === 'none');

/** Flujo SSE en el que el modelo escribe texto y después pide una herramienta. */
export function flujoTextoYLlamada(proveedor: string, texto: string, pedido: PedidoHerramienta): Response {
  const partes = proveedor === 'gemini'
    ? [{ candidates: [{ content: { parts: [{ text: texto }] } }] }, { candidates: [{ content: { parts: [{ functionCall: { name: pedido.nombre, args: pedido.args ?? {} } }] } }] }]
    : [{ choices: [{ delta: { content: texto } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_0', function: { name: pedido.nombre, arguments: JSON.stringify(pedido.args ?? {}).slice(0, 3) } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(pedido.args ?? {}).slice(3) } }] } }] }];
  const cuerpo = partes.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('') + (proveedor === 'gemini' ? '' : 'data: [DONE]\n\n');
  return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(cuerpo)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
/** Flujo SSE en el que el modelo pide una herramienta SIN texto antes. */
export function flujoSoloLlamada(proveedor: string, pedido: PedidoHerramienta): Response {
  const args = JSON.stringify(pedido.args ?? {});
  const partes = proveedor === 'gemini'
    ? [{ candidates: [{ content: { parts: [{ functionCall: { name: pedido.nombre, args: pedido.args ?? {} } }] } }] }]
    : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_0', function: { name: pedido.nombre, arguments: args.slice(0, 2) } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(2) } }] } }] }];
  const cuerpo = partes.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('') + (proveedor === 'gemini' ? '' : 'data: [DONE]\n\n');
  return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(cuerpo)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
