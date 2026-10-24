// Lógica pura del panel del asistente (sin navegador): lectura del stream, enlaces seguros, ajustes por usuario, errores por causa y scroll.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AJUSTES_DEFECTO, PARAMETROS_EQUILIBRADO, avisoEsfuerzo, cambiarParametro, claveAjustes, claveBorrador, cuerpoDeAjustes, elegirPreset,
  guardarAjustes, guardarBorrador, leerBorrador, leerJson, normalizarAjustes, presetEfectivo,
} from '../src/app/asistente/ajustes';
import { enviarMensaje, type EventoCliente } from '../src/app/asistente/cliente';
import { clasificarEnlace } from '../src/app/asistente/enlaces';
import { MENSAJE_ERROR, errorDeEvento, errorDeExcepcion, errorDeRespuesta } from '../src/app/asistente/errores';
import { estaAlFinal } from '../src/app/asistente/scroll';
import { AcumuladorSse, leerSse } from '../src/app/asistente/sse';
import { SUGERENCIAS } from '../src/app/asistente/sugerencias';
import type { OpcionesChat } from '../src/app/asistente/tipos';
import { ROLES } from '../src/server/config';

const enc = new TextEncoder();
const flujo = (...trozos: (string | Uint8Array)[]) => new ReadableStream<Uint8Array>({ start(c) { for (const t of trozos) c.enqueue(typeof t === 'string' ? enc.encode(t) : t); c.close(); } });
const sse = (evento: string, datos: unknown) => `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
async function todos<T>(g: AsyncGenerator<T>): Promise<T[]> { const r: T[] = []; for await (const x of g) r.push(x); return r; }

const PRESETS = [
  { id: 'preciso', nombre: 'Preciso', detalle: 'x', parametros: { temperature: 0.2, maxTokens: 1024, topP: 0.8, topK: 20 } },
  { id: 'equilibrado', nombre: 'Equilibrado', detalle: 'x', parametros: { temperature: 0.7, maxTokens: 1024, topP: 0.95, topK: 40 } },
  { id: 'creativo', nombre: 'Creativo', detalle: 'x', parametros: { temperature: 1.1, maxTokens: 2048, topP: 1, topK: 80 } },
  { id: 'a_medida', nombre: 'A medida', detalle: 'x', parametros: null },
] as const;
const opcionesAdmin: OpcionesChat = {
  modelos: [
    { id: 'openai/gpt-oss-120b', nombre: 'GPT OSS 120B', categoria: 'razonamiento', proveedor: 'Groq', gratis: false },
    { id: 'qwen/qwen3.8-27b', nombre: 'Qwen', categoria: 'equilibrado', proveedor: 'Groq', gratis: false },
    { id: 'gemini-2.5-flash', nombre: 'Gemini 2.5 Flash', categoria: 'rapido', proveedor: 'Google Gemini', gratis: false },
  ],
  categorias: [], presets: [...PRESETS] as never, esfuerzos: ['low', 'medium', 'high'], puede_elegir_modelo: true, puede_elegir_esfuerzo: true, max_tokens: 4096,
};
const opcionesResidente: OpcionesChat = { ...opcionesAdmin, modelos: [], esfuerzos: [], puede_elegir_modelo: false, puede_elegir_esfuerzo: false, max_tokens: 1024 };

describe('lectura del stream SSE', () => {
  it('junta fragmentos partidos en cualquier punto, con CRLF y comentarios', () => {
    const a = new AcumuladorSse();
    const total = sse('meta', { conversacion_id: 'c1' }) + ': latido\n\n' + sse('delta', { texto: 'Hola ' }) + sse('delta', { texto: 'mundo' });
    const trozos = [total.slice(0, 7), total.slice(7, 40), total.slice(40, 41), total.slice(41)];
    const evs = trozos.flatMap((t) => a.empujar(t));
    assert.deepEqual(evs.map((e) => e.evento), ['meta', 'delta', 'delta']);
    assert.deepEqual(evs[1].datos, { texto: 'Hola ' });
    const crlf = new AcumuladorSse().empujar('event: delta\r\ndata: {"texto":"x"}\r\n\r\n');
    assert.deepEqual(crlf, [{ evento: 'delta', datos: { texto: 'x' } }]);
    assert.deepEqual(new AcumuladorSse().empujar('event: delta\ndata: {no es json}\n\n'), [], 'datos ilegibles se ignoran');
    const fin = new AcumuladorSse();
    fin.empujar('event: done\ndata: {"ok":1}');
    assert.deepEqual(fin.terminar(), [{ evento: 'done', datos: { ok: 1 } }], 'lo que quedó sin línea en blanco final');
  });

  it('un carácter multibyte partido entre dos fragmentos de red no se corrompe', async () => {
    const bytes = enc.encode(sse('delta', { texto: 'añoñ…' }));
    const corte = bytes.indexOf(0xc3) + 1; // en medio de la «ñ»
    const evs = await todos(leerSse(flujo(bytes.slice(0, corte), bytes.slice(corte))));
    assert.deepEqual(evs[0].datos, { texto: 'añoñ…' });
  });
});

describe('cliente del stream', () => {
  const csrf = () => ({ 'X-CSRF-Token': 'tok-123' });
  const sesion = { perdida: 0 };
  const cuerpoOk = () => sse('meta', { conversacion_id: 'c9' }) + sse('delta', { texto: 'Hola' }) + sse('delta', { texto: ' tú' }) + sse('done', { modelo: 'm', proveedor: 'groq', latencia_ms: 1234 });
  const deps = (f: typeof fetch) => ({ fetch: f, csrf, sesionPerdida: () => { sesion.perdida++; } });

  it('manda cookie y CSRF, y emite meta → delta… → fin', async () => {
    let init: RequestInit | undefined;
    let url = '';
    const f = (async (u: string, i: RequestInit) => { url = u; init = i; return new Response(flujo(cuerpoOk()), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }) as unknown as typeof fetch;
    const evs = await todos(enviarMensaje(deps(f), { message: 'Hola', ruta: '/perfil', preset: 'equilibrado' }));
    assert.equal(url, '/api/ai-chat/stream');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-Token'], 'tok-123');
    assert.deepEqual(JSON.parse(String(init?.body)), { message: 'Hola', ruta: '/perfil', preset: 'equilibrado' });
    assert.deepEqual(evs, [
      { tipo: 'meta', conversacion_id: 'c9' },
      { tipo: 'delta', texto: 'Hola' },
      { tipo: 'delta', texto: ' tú' },
      { tipo: 'fin', modelo: 'm', proveedor: 'groq', latencia_ms: 1234, modo: null },
    ]);
  });

  it('errores previos al stream (JSON) → causa clara; 401 avisa que se perdió la sesión', async () => {
    const mk = (status: number, cuerpo: unknown) => (async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;
    const caso = async (status: number, cuerpo: unknown) => (await todos(enviarMensaje(deps(mk(status, cuerpo)), { message: 'x' })))[0] as Extract<EventoCliente, { tipo: 'error' }>;
    assert.equal((await caso(500, { error: { code: 500, message: 'La IA no está configurada en el servidor. Contacta al administrador.' } })).error.causa, 'no_configurado');
    assert.equal((await caso(429, { error: 'Has alcanzado el límite de consultas a la IA, intenta de nuevo más tarde' })).error.causa, 'limite_uso');
    assert.equal((await caso(429, { error: { code: 429, message: 'La IA está saturada o se superó la cuota. Intenta nuevamente en unos minutos.' } })).error.causa, 'saturado');
    assert.equal((await caso(503, { error: { code: 503, message: 'x' } })).error.causa, 'caido');
    assert.equal((await caso(504, {})).error.causa, 'tiempo');
    const antes = sesion.perdida;
    assert.equal((await caso(401, { error: 'Sesión inválida o vencida' })).error.causa, 'sesion');
    assert.equal(sesion.perdida, antes + 1);
    const validacion = await caso(400, { error: { code: 400, message: 'El mensaje es demasiado largo.' } });
    assert.equal(validacion.error.mensaje, 'El mensaje es demasiado largo.');
    const fijo = await caso(503, { error: { code: 503, message: 'El modelo qwen/x no respondió; prueba con Auto.' } });
    assert.deepEqual([fijo.error.causa, fijo.error.mensaje], ['modelo', 'El modelo qwen/x no respondió; prueba con Auto.']);
  });

  it('sin red → «sin conexión»; cancelar con AbortController no emite nada', async () => {
    const sinRed = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const e = await todos(enviarMensaje(deps(sinRed), { message: 'x' }));
    assert.deepEqual(e, [{ tipo: 'error', error: { causa: 'sin_conexion', mensaje: MENSAJE_ERROR.sin_conexion } }]);
    const control = new AbortController();
    control.abort();
    const cancelado = (async (_u: string, i: RequestInit) => { if (i.signal?.aborted) throw new DOMException('abortado', 'AbortError'); return new Response(''); }) as unknown as typeof fetch;
    assert.deepEqual(await todos(enviarMensaje(deps(cancelado), { message: 'x' }, control.signal)), []);
  });

  it('evento `error` del servidor, y conexión que se cierra sin `done`: «cortada»', async () => {
    const f = (cuerpo: string) => (async () => new Response(flujo(cuerpo), { status: 200 })) as unknown as typeof fetch;
    const a = await todos(enviarMensaje(deps(f(sse('meta', { conversacion_id: 'c' }) + sse('delta', { texto: 'Te cuento' }) + sse('error', { codigo: 'cortada', mensaje: 'x' }))), { message: 'x' }));
    assert.equal((a.at(-1) as { error: { causa: string } }).error.causa, 'cortada');
    const b = await todos(enviarMensaje(deps(f(sse('delta', { texto: 'a medias' }))), { message: 'x' }));
    assert.deepEqual(b.map((x) => x.tipo), ['delta', 'error']);
    assert.equal((b[1] as { error: { causa: string } }).error.causa, 'cortada');
    const c = await todos(enviarMensaje(deps(f(sse('done', { modelo: null, proveedor: null, latencia_ms: 5, modo: 'contingencia' }))), { message: 'x' }));
    assert.deepEqual(c, [{ tipo: 'fin', modelo: null, proveedor: null, latencia_ms: 5, modo: 'contingencia' }]);
    const d = await todos(enviarMensaje(deps(f(sse('error', { codigo: 'modelo_fijo', mensaje: 'El modelo q no respondió; prueba con Auto.' }))), { message: 'x' }));
    assert.deepEqual((d[0] as { error: unknown }).error, { causa: 'modelo', mensaje: 'El modelo q no respondió; prueba con Auto.' });
  });

  it('cada causa tiene un texto propio y sin jerga', () => {
    const textos = Object.values(MENSAJE_ERROR);
    assert.equal(new Set(textos).size, textos.length);
    for (const t of textos) assert.ok(!/(HTTP|\b[45]\d\d\b|timeout|token|API|proveedor|stream|JSON)/i.test(t), t);
    assert.equal(errorDeExcepcion(new DOMException('x', 'TimeoutError')).causa, 'tiempo');
    assert.equal(errorDeEvento('fallo', '').causa, 'caido');
    assert.equal(errorDeRespuesta(502).causa, 'caido');
  });
});

describe('enlaces del Markdown', () => {
  it('rutas internas de la app y https; todo lo demás se descarta', () => {
    const interno = (h: string) => clasificarEnlace(h).tipo === 'interno';
    for (const ok of ['/propietario/cargos', '/admin/medios-pago', '/perfil', '/propietario/cargos?x=1#a']) assert.ok(interno(ok), ok);
    assert.deepEqual(clasificarEnlace('https://aistudio.google.com/apikey'), { tipo: 'externo', url: 'https://aistudio.google.com/apikey' });
    for (const mal of [
      'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>1</script>', 'http://evil.com', 'mailto:a@b.pe', 'tel:123', 'vbscript:x',
      '//evil.com/x', '//evil', '//evil/propietario/cargos', '/\\evil.com', '/ruta con espacio', '/a"onclick="x', 'ftp://x.com', 'file:///etc/passwd', 'https://user:pw@evil.com/', 'https://', 'relativo/sin/barra', '', '#ancla', 'blob:https://x.com/1', '/x\u0000y',
    ]) assert.equal(clasificarEnlace(mal).tipo, 'descartado', JSON.stringify(mal));
    assert.equal(clasificarEnlace(undefined).tipo, 'descartado');
  });
});

describe('ajustes del compositor', () => {
  it('por omisión: Auto + Equilibrado + Medio', () => {
    assert.deepEqual(AJUSTES_DEFECTO, { modelo: 'auto', preset: 'equilibrado', parametros: PARAMETROS_EQUILIBRADO, esfuerzo: 'medium' });
    assert.deepEqual(normalizarAjustes(null, opcionesAdmin), AJUSTES_DEFECTO);
    assert.deepEqual(normalizarAjustes('basura', null), AJUSTES_DEFECTO);
  });

  it('nunca muestra «Equilibrado» sobre valores distintos: tocar una barra pasa a «A medida»', () => {
    const a = cambiarParametro(AJUSTES_DEFECTO, 'temperature', 1.3);
    assert.equal(a.preset, 'a_medida');
    assert.equal(a.parametros.temperature, 1.3);
    assert.equal(a.parametros.topK, 40, 'lo demás se conserva');
    // Un guardado incoherente («equilibrado» con otros valores) se corrige al leerlo.
    const raro = normalizarAjustes({ preset: 'equilibrado', parametros: { temperature: 1.5, maxTokens: 1024, topP: 0.95, topK: 40 } }, opcionesAdmin);
    assert.equal(raro.preset, 'a_medida');
    assert.equal(presetEfectivo('creativo', PRESETS[2].parametros, [...PRESETS] as never), 'creativo');
    assert.equal(presetEfectivo('creativo', { ...PRESETS[2].parametros, topK: 79 }, [...PRESETS] as never), 'a_medida');
    // Elegir un preset carga sus valores; «A medida» conserva los actuales.
    const c = elegirPreset(a, 'creativo', [...PRESETS] as never);
    assert.deepEqual([c.preset, c.parametros], ['creativo', PRESETS[2].parametros]);
    assert.deepEqual(elegirPreset(c, 'a_medida', [...PRESETS] as never).parametros, PRESETS[2].parametros);
  });

  it('los límites son los del servidor y se acotan', () => {
    const a = normalizarAjustes({ parametros: { temperature: 9, maxTokens: 99999, topP: -1, topK: 500 }, preset: 'a_medida' }, opcionesAdmin);
    assert.deepEqual(a.parametros, { temperature: 2, maxTokens: 4096, topP: 0, topK: 100 });
    const b = normalizarAjustes({ parametros: { temperature: 'x', maxTokens: 10, topP: null, topK: 0 }, preset: 'a_medida' }, opcionesAdmin);
    assert.deepEqual(b.parametros, { temperature: 0.7, maxTokens: 128, topP: 0.95, topK: 1 });
    assert.equal(cambiarParametro(AJUSTES_DEFECTO, 'maxTokens', 100000).parametros.maxTokens, 4096);
  });

  it('un residente no conserva modelo ni esfuerzo, y su tope de tokens es 1024; un modelo retirado vuelve a Auto', () => {
    const guardado = { modelo: 'qwen/qwen3.8-27b', esfuerzo: 'high', preset: 'a_medida', parametros: { temperature: 1, maxTokens: 4096, topP: 1, topK: 50 } };
    const r = normalizarAjustes(guardado, opcionesResidente);
    assert.deepEqual([r.modelo, r.esfuerzo, r.parametros.maxTokens], ['auto', 'medium', 1024]);
    const a = normalizarAjustes(guardado, opcionesAdmin);
    assert.deepEqual([a.modelo, a.esfuerzo, a.parametros.maxTokens], ['qwen/qwen3.8-27b', 'high', 4096]);
    assert.equal(normalizarAjustes({ ...guardado, modelo: 'ya-no-existe' }, opcionesAdmin).modelo, 'auto');
    // Defensa extra: aunque la lista llegara con modelos, si no puede elegir, no se conserva.
    assert.equal(normalizarAjustes(guardado, { ...opcionesAdmin, puede_elegir_modelo: false, puede_elegir_esfuerzo: false }).modelo, 'auto');
  });

  it('el cuerpo sólo lleva lo que ese usuario puede elegir; `parametros` sólo con «A medida»', () => {
    assert.deepEqual(cuerpoDeAjustes(AJUSTES_DEFECTO, opcionesResidente), { preset: 'equilibrado' });
    assert.deepEqual(cuerpoDeAjustes(AJUSTES_DEFECTO, opcionesAdmin), { preset: 'equilibrado', esfuerzo: 'medium' });
    const a = { ...cambiarParametro(AJUSTES_DEFECTO, 'topK', 7), modelo: 'qwen/qwen3.8-27b', esfuerzo: 'high' as const };
    assert.deepEqual(cuerpoDeAjustes(a, opcionesAdmin), { modelo: 'qwen/qwen3.8-27b', preset: 'a_medida', parametros: a.parametros, esfuerzo: 'high' });
    assert.deepEqual(cuerpoDeAjustes(a, opcionesResidente), { preset: 'a_medida', parametros: a.parametros });
    assert.deepEqual(cuerpoDeAjustes(a, null), { preset: 'a_medida', parametros: a.parametros });
  });

  it('el menú dice cuándo el esfuerzo no se aplicará', () => {
    assert.match(avisoEsfuerzo({ ...AJUSTES_DEFECTO, modelo: 'auto' }, opcionesAdmin)!, /Auto.*no está garantizado/);
    assert.equal(avisoEsfuerzo({ ...AJUSTES_DEFECTO, modelo: 'openai/gpt-oss-120b' }, opcionesAdmin), null);
    assert.equal(avisoEsfuerzo({ ...AJUSTES_DEFECTO, modelo: 'gemini-2.5-flash' }, opcionesAdmin), null, 'Gemini 2.5 piensa');
    assert.match(avisoEsfuerzo({ ...AJUSTES_DEFECTO, modelo: 'qwen/qwen3.8-27b' }, opcionesAdmin)!, /no razona/);
  });

  it('se guardan POR USUARIO y todo almacenamiento va con try/catch (bloqueado, lleno o corrupto)', () => {
    const datos = new Map<string, string>();
    const almacen = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); }, removeItem: (k: string) => { datos.delete(k); } };
    guardarAjustes(7, { ...AJUSTES_DEFECTO, esfuerzo: 'high' }, almacen);
    guardarAjustes(8, { ...AJUSTES_DEFECTO, esfuerzo: 'low' }, almacen);
    assert.equal(normalizarAjustes(leerJson(7, almacen), opcionesAdmin).esfuerzo, 'high');
    assert.equal(normalizarAjustes(leerJson(8, almacen), opcionesAdmin).esfuerzo, 'low');
    assert.notEqual(claveAjustes(7), claveAjustes(8));
    guardarBorrador(7, 'Mi borrador', almacen);
    assert.equal(leerBorrador(7, almacen), 'Mi borrador');
    assert.equal(leerBorrador(8, almacen), '');
    guardarBorrador(7, '', almacen);
    assert.equal(datos.has(claveBorrador(7)), false, 'borrador vacío = se borra');
    datos.set(claveAjustes(9), '{no es json');
    assert.deepEqual(normalizarAjustes(leerJson(9, almacen), opcionesAdmin), AJUSTES_DEFECTO);
    const roto = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('x'); } };
    assert.doesNotThrow(() => { guardarAjustes(1, AJUSTES_DEFECTO, roto); guardarBorrador(1, 'x', roto); guardarBorrador(1, '', roto); });
    assert.equal(leerBorrador(1, roto), '');
    assert.equal(leerJson(1, roto), null);
    assert.equal(leerBorrador(1, null), '');
  });
});

describe('scroll y sugerencias', () => {
  it('sólo sigue al texto nuevo si el usuario ya estaba al final', () => {
    assert.equal(estaAlFinal({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }), true);
    assert.equal(estaAlFinal({ scrollTop: 570, clientHeight: 400, scrollHeight: 1000 }), true, 'a 30 px del final cuenta como al final');
    assert.equal(estaAlFinal({ scrollTop: 100, clientHeight: 400, scrollHeight: 1000 }), false, 'subió a leer: no se le arrastra');
  });

  it('hay chips para TODOS los roles; el residente y el superadmin tienen los pedidos', () => {
    for (const rol of ROLES) assert.ok(SUGERENCIAS[rol].length >= 2, rol);
    assert.deepEqual(SUGERENCIAS.propietario, ['¿Cuánto debo?', '¿Cómo pago?', '¿Cómo subo mi comprobante?']);
    assert.deepEqual(SUGERENCIAS.inquilino, SUGERENCIAS.propietario);
    assert.deepEqual(SUGERENCIAS.admin.slice(0, 2), ['¿Qué pagos debo validar?', '¿Quién está en mora?']);
    assert.equal(SUGERENCIAS.superadmin[0], '¿Cómo agrego una clave de IA?');
  });
});
