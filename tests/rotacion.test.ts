import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import {
  claveCooldown, cooldownDeps, enfriandoHasta, estaEnfriando, limpiar, limpiarProveedor, limpiarTodo, parsearRetryAfter, registrarEstado, snapshot,
} from '../src/server/lib/cooldown';
import { llaveroDeps } from '../src/server/services/llavero';
import { construirCadena, olvidarTodoUso } from '../src/server/services/rotacion';
import { MAX_INTENTOS } from '../src/server/routes/aiChat';
import { FRASE_CONTINGENCIA } from '../src/server/services/asistente/contexto';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const T0 = 1_700_000_000_000;
const SEG = 1000;

let base: string;
let cerrar: () => Promise<void>;
let T: { super: string; adminA: string };
let ahora = T0;
const relojOriginal = cooldownDeps.ahora;
const fetchOriginal = llaveroDeps.fetch;

type Llamada = { url: string; clave: string };
let llamadas: Llamada[] = [];
let cuerpos: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
let responder: (clave: string, url: string, cuerpo: Record<string, any>) => Response | Promise<Response> = () => ok('Hola'); // eslint-disable-line @typescript-eslint/no-explicit-any

// Sirve a la vez de respuesta de chat (compatible y Gemini) y de lista de modelos (`GET /models`), para que «Probar» también salga bien.
const ok = (texto: string) => new Response(JSON.stringify({ choices: [{ message: { content: texto } }], candidates: [{ content: { parts: [{ text: texto }] } }], data: [{ id: 'm-test' }], models: [{ name: 'models/m-test', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 });
const estado = (status: number, headers: Record<string, string> = {}, cuerpo = '{"error":"cuerpo-secreto-del-proveedor"}') => new Response(cuerpo, { status, headers });
const claveDe = (init: RequestInit) => {
  const h = init.headers as Record<string, string>;
  return h['x-goog-api-key'] ?? h.Authorization.replace('Bearer ', '');
};

const logs: string[] = [];
const consolaOriginal = { log: console.log, warn: console.warn, error: console.error, info: console.info };

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
  cooldownDeps.ahora = () => ahora;
  llaveroDeps.fetch = async (url, init = {}) => {
    const clave = claveDe(init);
    llamadas.push({ url, clave });
    const cuerpo = JSON.parse(String(init.body ?? '{}'));
    cuerpos.push(cuerpo);
    return responder(clave, url, cuerpo);
  };
});
after(async () => {
  cooldownDeps.ahora = relojOriginal;
  llaveroDeps.fetch = fetchOriginal;
  delete process.env.LLAVERO_ENC_KEY;
  delete process.env.LLAVERO_MAX_INTENTOS;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLAVERO_MAX_INTENTOS;
  await prisma.claveIntegracion.deleteMany();
  await prisma.auditoria.deleteMany();
  limpiarTodo();
  olvidarTodoUso();
  ahora = T0;
  llamadas = [];
  cuerpos = [];
  logs.length = 0;
  responder = () => ok('Hola');
  for (const k of ['log', 'warn', 'error', 'info'] as const) {
    console[k] = (...a: unknown[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  }
});
afterEach(() => { Object.assign(console, consolaOriginal); });

const guardar = (proveedor: string, clave: string, etiqueta?: string) =>
  llamar(base, 'PUT', `/api/llavero/${proveedor}`, T.super, { clave, ...(etiqueta ? { etiqueta } : {}) });
const chat = () => llamar(base, 'POST', '/api/ai-chat', T.adminA, { message: 'Hola' });
const usadas = () => llamadas.map((l) => l.clave);
const cd = (proveedor: string, id: number) => claveCooldown(proveedor, id);


describe('parsearRetryAfter', () => {
  it('lee segundos, fecha HTTP y retryDelay del cuerpo; la basura da null', () => {
    assert.equal(parsearRetryAfter('42', null), 42_000);
    assert.equal(parsearRetryAfter(' 1.5 ', null), 1500);
    assert.equal(parsearRetryAfter(new Date(T0 + 90 * SEG).toUTCString(), null, T0), 90_000);
    assert.equal(parsearRetryAfter(new Date(T0 - 90 * SEG).toUTCString(), null, T0), 0, 'una fecha pasada no es negativa');
    assert.equal(parsearRetryAfter(null, '{"error":{"details":[{"retryDelay":"50s"}]}}'), 50_000);
    assert.equal(parsearRetryAfter(undefined, '{ "retryDelay" : "7.5s" }'), 7500);
    assert.equal(parsearRetryAfter('mañana', 'no es json'), null);
    assert.equal(parsearRetryAfter('', '{"retryDelay":"abc"}'), null);
    assert.equal(parsearRetryAfter(null, null), null);
    assert.equal(parsearRetryAfter('10', '{"retryDelay":"50s"}'), 10_000, 'la cabecera manda sobre el cuerpo');
  });
});

describe('cooldown', () => {
  it('429: cotas de 1 s a 5 min y 60 s si el proveedor no dice nada', () => {
    registrarEstado('x#1', 429, 200);
    assert.equal(enfriandoHasta('x#1'), T0 + 1000, 'mínimo 1 s');
    registrarEstado('x#2', 429, 3_600_000);
    assert.equal(enfriandoHasta('x#2'), T0 + 300_000, 'máximo 5 min');
    registrarEstado('x#3', 429, 42_000);
    assert.equal(enfriandoHasta('x#3'), T0 + 42_000);
    registrarEstado('x#4', 429);
    assert.equal(enfriandoHasta('x#4'), T0 + 60_000, '60 s por defecto');
    registrarEstado('x#5', 429, null);
    assert.equal(enfriandoHasta('x#5'), T0 + 60_000);
  });

  it('5xx y red/timeout (status 0) enfrían 30 s fijos; 2xx, 400 y 401 no enfrían', () => {
    registrarEstado('x#1', 503, 999_999);
    registrarEstado('x#2', 0);
    assert.equal(enfriandoHasta('x#1'), T0 + 30_000);
    assert.equal(enfriandoHasta('x#2'), T0 + 30_000);
    for (const s of [200, 400, 401, 402, 403, 404]) registrarEstado(`y#${s}`, s);
    assert.deepEqual(Object.keys(snapshot()).sort(), ['x#1', 'x#2']);
  });

  it('el enfriamiento vence con el reloj; limpiar, limpiarProveedor y snapshot', () => {
    registrarEstado('gemini#1', 429, 10_000);
    registrarEstado('gemini#2', 429, 10_000);
    registrarEstado('groq#1', 429, 10_000);
    assert.equal(estaEnfriando('gemini#1'), true);
    assert.equal(estaEnfriando('gemini#1', T0 + 10_000), false, 'justo al llegar al límite ya no enfría');
    assert.deepEqual(snapshot(T0 + 9_999), { 'gemini#1': T0 + 10_000, 'gemini#2': T0 + 10_000, 'groq#1': T0 + 10_000 });
    assert.deepEqual(snapshot(T0 + 10_000), {});
    limpiar('gemini#1');
    assert.equal(estaEnfriando('gemini#1'), false);
    limpiarProveedor('gemini');
    assert.deepEqual(Object.keys(snapshot()), ['groq#1'], 'limpiarProveedor no toca otros proveedores');
  });
});

describe('cadena de rotación', () => {
  it('orden: prioridad del proveedor, menos usada primero (nulos primero), enfriadas al final; pausadas y rechazadas fuera', async () => {
    const id = async (p: string, k: string, e: string) => (await guardar(p, k, e)).body.id as number;
    const gA = await id('gemini', 'gemini-A-prueba-0001', 'a');
    const oA = await id('openai', 'openai-A-prueba-0001', 'a');
    const rA = await id('groq', 'groq-A-prueba-00001', 'a');
    const rB = await id('groq', 'groq-B-prueba-00001', 'b');
    const rC = await id('groq', 'groq-C-prueba-00001', 'c');
    const rD = await id('groq', 'groq-D-prueba-00001', 'd');
    const rE = await id('groq', 'groq-E-prueba-00001', 'e');
    const dA = await id('deepseek', 'deepseek-A-prueba-001', 'a');
    const mA = await id('mistral', 'mistral-A-prueba-0001', 'a');
    const nombre: Record<number, string> = { [gA]: 'gemini-a', [oA]: 'openai-a', [rA]: 'groq-a', [rB]: 'groq-b', [rC]: 'groq-c', [rD]: 'groq-d', [rE]: 'groq-e', [dA]: 'deepseek-a', [mA]: 'mistral-a' };
    const uso = (n: number) => new Date(T0 - n * 60_000);
    await prisma.claveIntegracion.update({ where: { id: rA }, data: { ultimo_uso_at: uso(1) } });
    await prisma.claveIntegracion.update({ where: { id: rB }, data: { ultimo_uso_at: uso(30) } });
    await prisma.claveIntegracion.update({ where: { id: rD }, data: { habilitada: false } });
    await prisma.claveIntegracion.update({ where: { id: rE }, data: { estado: 'rechazada' } });
    // rC nunca se usó (nulo) → primero dentro de groq. mistral está pausada por enfriamiento: va al final, no se descarta.
    registrarEstado(cd('mistral', mA), 429, 60_000);
    registrarEstado(cd('gemini', gA), 429, 60_000);

    const cadena = await construirCadena(T0);
    assert.deepEqual(cadena.map((e) => nombre[e.claveId!]), ['groq-c', 'groq-b', 'groq-a', 'openai-a', 'deepseek-a', 'gemini-a', 'mistral-a']);
    // Al vencer el enfriamiento, Gemini vuelve a ir primero por prioridad.
    const luego = await construirCadena(T0 + 61_000);
    assert.deepEqual(luego.map((e) => nombre[e.claveId!]), ['gemini-a', 'groq-c', 'groq-b', 'groq-a', 'openai-a', 'deepseek-a', 'mistral-a']);
  });

  it('GEMINI_API_KEY del entorno sólo entra cuando el llavero no tiene nada usable', async () => {
    process.env.GEMINI_API_KEY = 'gemini-entorno-0004';
    assert.deepEqual((await construirCadena()).map((e) => e.cooldownKey), ['env#gemini']);
    const g = await guardar('groq', 'groq-A-prueba-00001');
    assert.deepEqual((await construirCadena()).map((e) => e.cooldownKey), [cd('groq', g.body.id)], 'con una clave usable no hay respaldo');
    await prisma.claveIntegracion.update({ where: { id: g.body.id }, data: { estado: 'rechazada' } });
    assert.deepEqual((await construirCadena()).map((e) => e.cooldownKey), ['env#gemini'], 'rechazada = no usable');
    await prisma.claveIntegracion.update({ where: { id: g.body.id }, data: { estado: 'ok', habilitada: false } });
    assert.deepEqual((await construirCadena()).map((e) => e.cooldownKey), ['env#gemini'], 'pausada = no usable');
    delete process.env.GEMINI_API_KEY;
    assert.deepEqual(await construirCadena(), []);
  });
});

describe('asistente con rotación', () => {
  it('429 en la clave A → atiende la B del mismo proveedor y A queda enfriada con su Retry-After', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001', 'a');
    await guardar('groq', 'groq-B-prueba-00001', 'b');
    responder = (k) => (k === 'groq-A-prueba-00001' ? estado(429, { 'retry-after': '42' }) : ok('Desde B'));
    const r = await chat();
    assert.equal(r.body.response, 'Desde B');
    assert.deepEqual(usadas(), ['groq-A-prueba-00001', 'groq-B-prueba-00001']);
    assert.equal(enfriandoHasta(cd('groq', a.body.id)), T0 + 42_000);
    // La siguiente consulta ya no toca A: B primero (A sigue enfriada).
    llamadas = [];
    await chat();
    assert.deepEqual(usadas(), ['groq-B-prueba-00001']);
    // Vencido el enfriamiento A vuelve a la cadena (y, al ser la menos usada, va primero).
    ahora = T0 + 43_000;
    llamadas = [];
    responder = () => ok('Otra vez');
    await chat();
    assert.equal(usadas()[0], 'groq-A-prueba-00001');
  });

  it('honra retryDelay del cuerpo (Gemini) y 429 en todas las de un proveedor → pasa al siguiente proveedor', async () => {
    const g1 = await guardar('gemini', 'gemini-A-prueba-0001', 'a');
    await guardar('gemini', 'gemini-B-prueba-0001', 'b');
    await guardar('groq', 'groq-A-prueba-00001');
    responder = (k) => (k.startsWith('gemini') ? estado(429, {}, '{"error":{"details":[{"retryDelay":"50s"}]}}') : ok('Desde Groq'));
    const r = await chat();
    assert.equal(r.body.response, 'Desde Groq');
    assert.equal(llamadas.length, 3);
    assert.equal(llamadas[2].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(enfriandoHasta(cd('gemini', g1.body.id)), T0 + 50_000);
  });

  it('todo enfriado: igual intenta (mejor un 429 que «no hay proveedores»)', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001');
    registrarEstado(cd('groq', a.body.id), 429, 120_000);
    const r = await chat();
    assert.equal(r.body.response, 'Hola');
    assert.equal(llamadas.length, 1);
    assert.equal(enfriandoHasta(cd('groq', a.body.id)), null, 'el éxito limpió el enfriamiento');
  });

  it('el éxito limpia el cooldown de esa clave y marca ultimo_uso_at', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001');
    registrarEstado(cd('groq', a.body.id), 500);
    assert.equal(estaEnfriando(cd('groq', a.body.id)), true);
    const antes = (await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: a.body.id } })).ultimo_uso_at;
    assert.equal(antes, null);
    await chat();
    assert.equal(estaEnfriando(cd('groq', a.body.id)), false);
    assert.ok((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: a.body.id } })).ultimo_uso_at);
  });

  it('401/403 → clave rechazada y persistida, no se vuelve a usar; 402 dice «sin saldo»', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001', 'a');
    const b = await guardar('groq', 'groq-B-prueba-00001', 'b');
    const o = await guardar('openai', 'openai-A-prueba-0001');
    responder = (k) => (k === 'groq-A-prueba-00001' ? estado(401) : k === 'groq-B-prueba-00001' ? estado(402) : ok('Desde OpenAI'));
    const r = await chat();
    assert.equal(r.body.response, 'Desde OpenAI');
    const fa = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: a.body.id } });
    const fb = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: b.body.id } });
    assert.equal(fa.estado, 'rechazada');
    assert.equal(fa.estado_detalle, 'La clave fue rechazada');
    assert.equal(fb.estado, 'rechazada');
    assert.equal(fb.estado_detalle, 'La cuenta no tiene saldo');
    assert.ok(logs.some((l) => l.includes(`[llavero] clave groq#${a.body.id} rechazada`)));
    llamadas = [];
    await chat();
    assert.deepEqual(usadas(), ['openai-A-prueba-0001'], 'las rechazadas ya no se intentan');
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: o.body.id } })).estado, 'sin_probar');
    // Una prueba fallida no la rehabilita; una exitosa sí.
    responder = () => estado(401);
    await llamar(base, 'POST', `/api/llavero/${a.body.id}/probar`, T.super);
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: a.body.id } })).estado, 'rechazada');
    responder = () => ok('x');
    const p = await llamar(base, 'POST', `/api/llavero/${a.body.id}/probar`, T.super);
    assert.equal(p.body.estado, 'ok');
    // Reemplazar la otra clave rechazada también la devuelve a sin_probar.
    const rep = await guardar('groq', 'groq-B-nueva-prueba-02', 'b');
    assert.equal(rep.body.estado, 'sin_probar');
    llamadas = [];
    await chat();
    assert.equal(llamadas.length, 1);
    assert.ok(usadas()[0].startsWith('groq-'));
  });

  it('400 por un parámetro no soportado: reintenta UNA vez sin los opcionales y no castiga la clave', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001');
    cuerpos = [];
    responder = (_k, _u, cuerpo) => (cuerpo.temperature !== undefined ? estado(400) : ok('Sin opcionales'));
    const r = await chat();
    assert.equal(r.body.response, 'Sin opcionales');
    assert.equal(llamadas.length, 2, 'un reintento sobre la misma clave');
    assert.ok(cuerpos[0].temperature !== undefined && cuerpos[0].top_p !== undefined, 'la primera lleva los opcionales');
    assert.equal(cuerpos[1].temperature, undefined);
    assert.equal(cuerpos[1].top_p, undefined);
    assert.equal(cuerpos[1].reasoning_effort, undefined);
    assert.equal(cuerpos[1].model, cuerpos[0].model, 'mismo modelo');
    assert.equal(estaEnfriando(cd('groq', a.body.id)), false, '400 no enfría');
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: a.body.id } })).estado, 'sin_probar');
  });

  it('400 que persiste aun sin opcionales: prueba la siguiente ruta, sin enfriar ni rechazar nada; si todas fallan, contingencia', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001');
    await guardar('openai', 'openai-A-prueba-0001');
    responder = () => estado(400);
    const r = await chat();
    assert.equal(r.status, 200);
    assert.equal(r.body.modo, 'contingencia');
    assert.equal(llamadas.length, 4, 'cada ruta: la petición y UN reintento sin opcionales');
    assert.equal(estaEnfriando(cd('groq', a.body.id)), false, '400 no enfría');
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: a.body.id } })).estado, 'sin_probar');
  });

  it('Gemini responde 400 «API key not valid» ante una clave inválida: la deja rechazada y rota al siguiente', async () => {
    const g = await guardar('gemini', 'AIza-invalida-prueba-0001');
    await guardar('groq', 'groq-A-prueba-00001');
    const cuerpo = '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}';
    responder = (k) => (k.startsWith('AIza') ? estado(400, {}, cuerpo) : ok('Desde Groq'));
    const r = await chat();
    assert.equal(r.body.response, 'Desde Groq');
    const f = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: g.body.id } });
    assert.equal(f.estado, 'rechazada');
    assert.equal(f.estado_detalle, 'La clave fue rechazada');
    llamadas = [];
    await chat();
    assert.equal(llamadas.some((l) => l.clave.startsWith('AIza')), false, 'la clave inválida ya no se intenta');
  });

  it('5xx, timeout y error de red → siguiente clave y cooldown corto de 30 s', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001', 'a');
    const b = await guardar('groq', 'groq-B-prueba-00001', 'b');
    const c = await guardar('groq', 'groq-C-prueba-00001', 'c');
    responder = (k) => {
      if (k === 'groq-A-prueba-00001') return estado(503);
      if (k === 'groq-B-prueba-00001') throw Object.assign(new Error('tiempo'), { name: 'TimeoutError' });
      return ok('Desde C');
    };
    const r = await chat();
    assert.equal(r.body.response, 'Desde C');
    assert.equal(enfriandoHasta(cd('groq', a.body.id)), T0 + 30_000);
    assert.equal(enfriandoHasta(cd('groq', b.body.id)), T0 + 30_000);
    assert.equal(estaEnfriando(cd('groq', b.body.id), T0 + 30_000), false, 'a los 30 s vuelve');
    assert.equal(enfriandoHasta(cd('groq', c.body.id)), null);
    // Error de red genérico (no timeout).
    limpiarTodo();
    llamadas = [];
    responder = (k) => { if (k !== 'groq-C-prueba-00001') throw new TypeError('fetch failed'); return ok('Desde C'); };
    assert.equal((await chat()).body.response, 'Desde C');
  });

  it('tope de intentos: MAX_INTENTOS (6 rutas) por defecto, a lo sumo el doble de llamadas, y LLAVERO_MAX_INTENTOS entre 1 y 8', async () => {
    assert.equal(MAX_INTENTOS, 6);
    for (const e of ['a', 'b', 'c', 'd', 'e']) await guardar('groq', `groq-${e}-prueba-00001`, e);
    for (const e of ['a', 'b', 'c', 'd', 'e']) await guardar('openai', `openai-${e}-prueba-001`, e);
    responder = () => estado(503);
    assert.equal((await chat()).body.modo, 'contingencia');
    assert.equal(llamadas.length, 10, 'las 10 claves (sólo 2 rutas distintas) caben en el tope de llamadas (12)');
    for (const [valor, esperado] of [['2', 4], ['3', 6], ['8', 10], ['0', 10], ['9', 10], ['x', 10]] as const) {
      process.env.LLAVERO_MAX_INTENTOS = valor;
      limpiarTodo();
      llamadas = [];
      await chat();
      assert.equal(llamadas.length, esperado, `LLAVERO_MAX_INTENTOS=${valor}`);
    }
  });

  it('agotadas las rutas: contingencia (200) sin claves ni cuerpos del proveedor; con 429 en todas, igual', async () => {
    await guardar('groq', 'groq-A-prueba-00001', 'a');
    await guardar('groq', 'groq-B-prueba-00001', 'b');
    await guardar('openai', 'openai-A-prueba-0001');
    responder = () => estado(503);
    let r = await chat();
    assert.equal(r.status, 200);
    assert.equal(r.body.modo, 'contingencia');
    assert.ok(r.body.response.startsWith(FRASE_CONTINGENCIA));
    responder = () => estado(429);
    limpiarTodo();
    r = await chat();
    assert.equal(r.status, 200);
    assert.equal(r.body.modo, 'contingencia');
    responder = (k) => (k.startsWith('openai') ? estado(503) : estado(429));
    limpiarTodo();
    assert.equal((await chat()).body.modo, 'contingencia', 'mezcla de 429 y 5xx');
    responder = (k) => { if (k.startsWith('openai')) throw new TypeError('fetch failed'); return estado(429); };
    limpiarTodo();
    assert.equal((await chat()).body.modo, 'contingencia', 'mezcla de 429 y error de red');
    const todo = logs.join('\n');
    for (const secreto of ['groq-A-prueba-00001', 'groq-B-prueba-00001', 'openai-A-prueba-0001', 'cuerpo-secreto-del-proveedor']) {
      assert.ok(!todo.includes(secreto), `los logs no contienen ${secreto}`);
      assert.ok(!r.texto.includes(secreto));
    }
    assert.ok(logs.some((l) => l.includes('[ai-chat] groq#')), 'sí se loguea proveedor y estado');
  });

  it('respaldo GEMINI_API_KEY: se usa sin llavero y no si el llavero tiene claves usables', async () => {
    process.env.GEMINI_API_KEY = 'gemini-entorno-0004';
    assert.equal((await chat()).body.response, 'Hola');
    assert.deepEqual(usadas(), ['gemini-entorno-0004']);
    await guardar('groq', 'groq-A-prueba-00001');
    llamadas = [];
    await chat();
    assert.deepEqual(usadas(), ['groq-A-prueba-00001']);
    responder = () => estado(503);
    llamadas = [];
    await chat();
    assert.deepEqual(usadas(), ['groq-A-prueba-00001'], 'el respaldo no se suma a un llavero usable');
  });

  it('el respaldo del entorno que recibe 401 se enfría pero no se persiste nada', async () => {
    process.env.GEMINI_API_KEY = 'gemini-entorno-0004';
    responder = () => estado(401);
    assert.equal((await chat()).body.modo, 'contingencia');
    assert.equal(estaEnfriando('env#gemini'), true);
    assert.equal(await prisma.claveIntegracion.count(), 0);
  });
});

describe('varias claves por proveedor', () => {
  it('la sexta clave de un proveedor → 422; reemplazar una existente o usar otro proveedor sigue permitido', async () => {
    for (const e of ['a', 'b', 'c', 'd', 'e']) assert.equal((await guardar('groq', `groq-${e}-prueba-00001`, e)).status, 201);
    const sexta = await guardar('groq', 'groq-f-prueba-00001', 'f');
    assert.equal(sexta.status, 422);
    assert.match(sexta.body.error, /hasta 5 claves/);
    assert.equal(await prisma.claveIntegracion.count({ where: { proveedor: 'groq' } }), 5);
    assert.equal((await guardar('groq', 'groq-nueva-prueba-0002', 'c')).status, 200);
    assert.equal((await guardar('openai', 'openai-A-prueba-0001')).status, 201);
    assert.equal((await guardar('groq', 'groq-g-prueba-00001', 'con espacio')).status, 422);
  });

  it('guardar o probar bien una clave limpia su enfriamiento', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001');
    registrarEstado(cd('groq', a.body.id), 429, 120_000);
    await guardar('groq', 'groq-A-nueva-prueba-01');
    assert.equal(estaEnfriando(cd('groq', a.body.id)), false, 'reemplazar limpia');
    registrarEstado(cd('groq', a.body.id), 429, 120_000);
    responder = () => estado(500);
    await llamar(base, 'POST', `/api/llavero/${a.body.id}/probar`, T.super);
    assert.equal(estaEnfriando(cd('groq', a.body.id)), true, 'una prueba fallida no limpia');
    responder = () => ok('x');
    await llamar(base, 'POST', `/api/llavero/${a.body.id}/probar`, T.super);
    assert.equal(estaEnfriando(cd('groq', a.body.id)), false, 'una prueba buena limpia');
  });
});

describe('GET /api/llavero', () => {
  it('suma enfriando_hasta, uso, orden y el tope; la clave y api_key_enc no salen', async () => {
    const a = await guardar('groq', 'groq-A-prueba-00001', 'a');
    const b = await guardar('groq', 'groq-B-prueba-00001', 'b');
    responder = (k) => (k === 'groq-A-prueba-00001' ? estado(429, { 'retry-after': '30' }) : ok('Desde B'));
    await chat();
    await chat();
    const r = await llamar(base, 'GET', '/api/llavero', T.super);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.orden, ['gemini', 'groq', 'openrouter', 'openai', 'deepseek', 'mistral', 'cerebras', 'sambanova', 'nvidia', 'cohere', 'ollama', 'llm7', 'kilo']);
    assert.equal(r.body.max_claves_por_proveedor, 5);
    const fa = r.body.claves.find((c: { id: number }) => c.id === a.body.id);
    const fb = r.body.claves.find((c: { id: number }) => c.id === b.body.id);
    assert.equal(fa.enfriando_hasta, new Date(T0 + 30_000).toISOString());
    assert.equal(fb.enfriando_hasta, null);
    assert.deepEqual(fa.uso, { ok: 0, limite: 1, error: 0 });
    assert.deepEqual(fb.uso, { ok: 2, limite: 0, error: 0 });
    for (const c of r.body.claves) assert.ok(!('api_key_enc' in c));
    for (const secreto of ['groq-A-prueba-00001', 'groq-B-prueba-00001', 'v2:']) assert.ok(!r.texto.includes(secreto), `la respuesta no contiene ${secreto}`);
    // Vencido el enfriamiento deja de aparecer.
    ahora = T0 + 31_000;
    const luego = await llamar(base, 'GET', '/api/llavero', T.super);
    assert.equal(luego.body.claves.find((c: { id: number }) => c.id === a.body.id).enfriando_hasta, null);
  });
});
