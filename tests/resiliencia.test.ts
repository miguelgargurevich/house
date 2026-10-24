import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { chatOk, estado, instalarIA, json, listaCompat, listaGemini, type LlamadaIA } from './helpers/ia';
import { claveCooldown, cooldownDeps, enfriandoHasta, estaEnfriando, limpiarTodo, registrarEstado } from '../src/server/lib/cooldown';
import { limpiarModelosMalos, modeloMalo } from '../src/server/lib/modelosMalos';
import { FRASE_CONTINGENCIA } from '../src/server/services/asistente/contexto';
import { MAX_INTENTOS, TOPE_TIEMPO_MS, topeTiempoMs } from '../src/server/services/asistente/motor';
import { LOCK_CANARY, canaryActivo, consumoDelDia, ejecutarCanary, pasadaDeCanary, reiniciarCanary, PRESUPUESTO_DIARIO } from '../src/server/services/asistente/canary';
import { ESPERA_RECUPERACION_MS, MAX_REINTENTOS_AUTOMATICOS, olvidarReintentos, recuperarRechazadas, reintentosDe } from '../src/server/services/asistente/recuperacion';
import { actualizarSalud, olvidarCausas, olvidarSaludEnMemoria, saludActual } from '../src/server/services/asistente/salud';
import { sincronizarClave, sincronizarTodas, syncDeps, pasadaDeSync } from '../src/server/services/modelos/sync';
import { construirCadena, olvidarTodoUso } from '../src/server/services/rotacion';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const MIN = 60_000;
const HORA = 3_600_000;
// 00:00 en Lima (05:00 UTC) de un día cualquiera: el presupuesto diario del canary se cuenta por día de Lima.
const MEDIANOCHE_LIMA = Date.UTC(2026, 9, 24, 5, 0, 0);
const MSG = 'Hola, ¿me ayudas con una consulta sobre mi cuenta de House, por favor?';

let base: string;
let cerrar: () => Promise<void>;
let D: Datos;
let T: { super: string; prop1: string };
let ia: ReturnType<typeof instalarIA>;
let manejador: (l: LlamadaIA) => Response | Promise<Response> = () => chatOk('Hola');
let reloj = MEDIANOCHE_LIMA;
const relojOriginal = cooldownDeps.ahora;
const syncAhoraOriginal = syncDeps.ahora;

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  D = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  ia = instalarIA((l) => manejador(l));
  cooldownDeps.ahora = () => reloj;
  syncDeps.ahora = () => new Date(reloj);
});
after(async () => {
  ia.restaurar();
  cooldownDeps.ahora = relojOriginal;
  syncDeps.ahora = syncAhoraOriginal;
  delete process.env.LLAVERO_ENC_KEY;
  delete process.env.LLAVERO_MAX_INTENTOS;
  delete process.env.LLAVERO_TOPE_MS;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.GEMINI_API_KEY;
  delete process.env.LLAVERO_MAX_INTENTOS;
  delete process.env.LLAVERO_TOPE_MS;
  await prisma.claveIntegracion.deleteMany();
  await prisma.conversacionIA.deleteMany();
  await prisma.notificacion.deleteMany();
  await prisma.estadoIA.deleteMany();
  limpiarTodo();
  limpiarModelosMalos();
  olvidarTodoUso();
  olvidarCausas();
  olvidarSaludEnMemoria();
  olvidarReintentos();
  reiniciarCanary();
  reloj = MEDIANOCHE_LIMA;
  ia.llamadas.length = 0;
  manejador = () => chatOk('Hola');
  console.warn = () => undefined;
  console.error = () => undefined;
});
afterEach(() => { console.warn = consolaWarn; console.error = consolaError; });
const consolaWarn = console.warn;
const consolaError = console.error;

const guardar = async (proveedor: string, clave: string, etiqueta?: string, extra: Record<string, unknown> = {}) =>
  (await llamar(base, 'PUT', `/api/llavero/${proveedor}`, T.super, { clave, ...(etiqueta ? { etiqueta } : {}), ...extra })).body as { id: number };
const catalogo = (claveId: number, ...ids: string[]) =>
  prisma.modeloIA.createMany({ data: ids.map((id) => ({ clave_id: claveId, modelo_id: id, estado: 'activo', categoria: /gpt-oss|r1/.test(id) ? 'razonamiento' : /flash/.test(id) ? 'rapido' : 'equilibrado', gratis: /:free$/.test(id) })) });
const chat = (cuerpo: Record<string, unknown> = {}) => llamar(base, 'POST', '/api/ai-chat', T.prop1, { message: MSG, ...cuerpo });
const chats = () => ia.llamadas.filter((l) => !l.esLista);
const modelosLlamados = () => chats().map((l) => `${l.proveedor}:${l.modelo}`);
const salud = async () => (await llamar(base, 'GET', '/api/llavero', T.super)).body.salud;

// ---------- El caso de producción ----------
describe('caída simultánea de todos los modelos por defecto (lo que pasó en producción)', () => {
  it('404 en Gemini y Groq y 402 en OpenRouter: contingencia sin repetir fallos; tras el sync y la recuperación vuelve sola', async () => {
    const g = await guardar('gemini', 'gemini-prueba-0001');
    const q = await guardar('groq', 'groq-prueba-00001');
    const o = await guardar('openrouter', 'openrouter-prueba-001');
    manejador = (l) => (l.modelo === 'gemini-flash-latest' || l.modelo === 'openai/gpt-oss-120b' ? estado(404) : l.modelo === 'google/gemma-4-31b-it:free' ? estado(402) : chatOk('no debería'));

    // 1) Todo cae a la vez: el vecino NO ve un error genérico, ve la contingencia.
    const r1 = await chat();
    assert.equal(r1.status, 200);
    assert.equal(r1.body.modo, 'contingencia');
    assert.ok(r1.body.response.startsWith(FRASE_CONTINGENCIA));
    assert.deepEqual(modelosLlamados(), ['gemini:gemini-flash-latest', 'groq:openai/gpt-oss-120b', 'openrouter:google/gemma-4-31b-it:free']);
    // La clave sin saldo queda rechazada; los modelos 404 quedan marcados para TODO el proveedor.
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: o.id } })).estado, 'rechazada');
    assert.equal(modeloMalo('gemini', 'gemini-flash-latest'), true);
    assert.equal(modeloMalo('groq', 'openai/gpt-oss-120b'), true);

    // 2) El estado visible dice qué pasa.
    const s1 = await salud();
    assert.equal(s1.ok, false);
    assert.equal(s1.desde, new Date(MEDIANOCHE_LIMA).toISOString());
    assert.equal(s1.motivo, 'Gemini 404, Groq 404, OpenRouter sin saldo');
    assert.deepEqual(s1.rutas.map((r: { proveedor: string; estado: string }) => [r.proveedor, r.estado]), [['gemini', 'modelo_no_disponible'], ['groq', 'modelo_no_disponible'], ['openrouter', 'sin_saldo']]);
    assert.ok(s1.rutas.every((r: Record<string, unknown>) => 'modelo' in r && 'hasta' in r));

    // 3) Las consultas siguientes NO repiten los intentos fallidos (ni gastan cuota ni latencia).
    ia.llamadas.length = 0;
    for (let i = 0; i < 3; i++) assert.equal((await chat()).body.modo, 'contingencia');
    assert.equal(ia.llamadas.length, 0, 'cero llamadas al proveedor mientras no cambie nada');

    // 4) El sync descubre los modelos vivos de cada clave (los por defecto ya no existen).
    manejador = (l) => {
      if (l.esLista) return l.proveedor === 'gemini' ? listaGemini('gemini-2.5-flash', 'gemini-2.5-flash-lite') : l.proveedor === 'groq' ? listaCompat('qwen/qwen3.8-27b', 'openai/gpt-oss-20b') : listaCompat('google/gemma-4-31b-it:free', 'poolside/laguna-s-2.1:free');
      return chatOk(`Desde ${l.proveedor}:${l.modelo}`);
    };
    reloj += 6 * HORA;
    assert.deepEqual(await sincronizarTodas(), { claves: 2, ok: 2 }, 'la clave rechazada no se sincroniza');
    ia.llamadas.length = 0;
    const r2 = await chat();
    assert.equal(r2.body.modo, undefined);
    assert.equal(r2.body.response, 'Desde gemini:gemini-2.5-flash', 'ya con un modelo vivo');

    // 5) La clave sin saldo se rehabilita sola cuando vuelve a responder (tarea periódica).
    const rec = await recuperarRechazadas();
    assert.deepEqual(rec, { revisadas: 1, rehabilitadas: 1 });
    const fo = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: o.id } });
    assert.deepEqual([fo.estado, fo.estado_detalle], ['ok', null]);
    // 6) Y el estado visible vuelve a verde.
    assert.equal((await salud()).ok, true);
    void g; void q;
  });

  it('con catálogo vivo la caída del modelo por defecto ni se nota: un 404 pasa al siguiente modelo de la MISMA clave', async () => {
    const g = await guardar('gemini', 'gemini-prueba-0001');
    await catalogo(g.id, 'gemini-flash-latest', 'gemini-2.5-flash');
    manejador = (l) => (l.modelo === 'gemini-flash-latest' ? estado(404) : chatOk('Con 2.5'));
    const r = await chat();
    assert.deepEqual([r.body.response, r.body.modo], ['Con 2.5', undefined]);
    assert.deepEqual(modelosLlamados(), ['gemini:gemini-flash-latest', 'gemini:gemini-2.5-flash']);
    assert.equal((await salud()).ok, true, 'nadie sufrió nada');
  });
});

// ---------- (clave, modelo) como unidad de rotación ----------
describe('la unidad de rotación es (clave, modelo)', () => {
  it('un 404 de modelo vale para el PROVEEDOR: las otras claves del mismo proveedor saltan ese modelo y prueban otro', async () => {
    const claves = [];
    for (const e of ['a', 'b', 'c']) claves.push(await guardar('groq', `groq-${e}-prueba-00001`, e));
    for (const c of claves) await catalogo(c.id, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b');
    manejador = (l) => {
      if (l.modelo === 'openai/gpt-oss-120b') return estado(404);
      return l.clave === 'groq-c-prueba-00001' ? chatOk('Desde la tercera') : estado(503);
    };
    const r = await chat();
    assert.equal(r.body.response, 'Desde la tercera');
    assert.equal(chats().filter((l) => l.modelo === 'openai/gpt-oss-120b').length, 1, 'el 404 se gastó UNA sola vez, no una por clave');
    assert.deepEqual(chats().map((l) => `${l.clave.slice(5, 6)}:${l.modelo}`), ['a:openai/gpt-oss-120b', 'a:qwen/qwen3.8-27b', 'b:qwen/qwen3.8-27b', 'c:qwen/qwen3.8-27b']);
    // Las claves a y b no se rechazaron: sólo se enfriaron por el 503.
    assert.equal(await prisma.claveIntegracion.count({ where: { estado: 'rechazada' } }), 0);
  });

  it('un modelo marcado malo NO se repite en las consultas siguientes; el deprecado de la base sobrevive a la marca de 10 min hasta que el sync lo reviva', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    await catalogo(q.id, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b');
    manejador = (l) => (l.modelo === 'openai/gpt-oss-120b' ? estado(404) : chatOk('Con qwen'));
    await chat();
    for (let i = 0; i < 5; i++) await chat();
    assert.equal(chats().filter((l) => l.modelo === 'openai/gpt-oss-120b').length, 1, 'seis consultas, un solo 404');
    // Vence la marca en memoria (10 min)… pero está deprecado en la base: sigue sin intentarse.
    reloj += 11 * MIN;
    assert.equal(modeloMalo('groq', 'openai/gpt-oss-120b'), false);
    ia.llamadas.length = 0;
    await chat();
    assert.deepEqual(modelosLlamados(), ['groq:qwen/qwen3.8-27b']);
    // El sync lo ve de nuevo en la lista del proveedor: lo reactiva y vuelve a ser el preferido.
    manejador = (l) => (l.esLista ? listaCompat('openai/gpt-oss-120b', 'qwen/qwen3.8-27b') : chatOk('Con 120b'));
    const r = await sincronizarClave(q.id);
    assert.equal(r?.revividos, 1);
    ia.llamadas.length = 0;
    assert.equal((await chat()).body.response, 'Con 120b');
    assert.deepEqual(modelosLlamados(), ['groq:openai/gpt-oss-120b']);
  });

  it('sin catálogo, un 404 del modelo por defecto no se reintenta (marca de 10 min) y vuelve a darse una oportunidad al vencer', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = () => estado(404);
    await chat();
    await chat();
    assert.equal(chats().length, 1);
    reloj += 11 * MIN;
    limpiarTodo();
    await chat();
    assert.equal(chats().length, 2, 'al vencer la marca se vuelve a probar (por si el proveedor lo repuso)');
  });

  it('los intentos cuentan por RUTA distinta (proveedor+modelo): no se agotan con claves repetidas del mismo proveedor y modelo', async () => {
    assert.equal(MAX_INTENTOS, 6);
    for (const e of ['a', 'b', 'c', 'd', 'e']) await guardar('groq', `groq-${e}-prueba-00001`, e);
    manejador = (l) => (l.clave === 'groq-e-prueba-00001' ? chatOk('La quinta sirve') : estado(429));
    const r = await chat();
    assert.equal(r.body.response, 'La quinta sirve', 'cinco claves, una sola ruta: con el tope viejo (4 intentos) no habría llegado');
    assert.equal(chats().length, 5);
  });

  it('MAX_INTENTOS limita las rutas DISTINTAS; LLAVERO_MAX_INTENTOS lo cambia', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    const g = await guardar('gemini', 'gemini-prueba-0001');
    const o = await guardar('openrouter', 'openrouter-prueba-001');
    const a = await guardar('openai', 'openai-prueba-0001');
    await catalogo(g.id, 'gemini-flash-latest', 'gemini-2.5-flash');
    await catalogo(q.id, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b');
    await catalogo(o.id, 'google/gemma-4-31b-it:free', 'poolside/laguna-s-2.1:free');
    await catalogo(a.id, 'gpt-4o-mini', 'gpt-4o');
    manejador = () => estado(404); // todos los modelos fallan: cada clave prueba 2 rutas distintas
    process.env.LLAVERO_MAX_INTENTOS = '3';
    assert.equal((await chat()).body.modo, 'contingencia');
    assert.equal(chats().length, 3, 'tope de 3 rutas distintas');
    assert.equal(new Set(modelosLlamados()).size, 3, 'ninguna se repite');
    ia.llamadas.length = 0;
    limpiarModelosMalos();
    await prisma.modeloIA.updateMany({ data: { estado: 'activo', deprecado_at: null } });
    process.env.LLAVERO_MAX_INTENTOS = '6';
    await chat();
    assert.equal(chats().length, 6);
    assert.equal(new Set(modelosLlamados()).size, 6);
  });

  it('tope de tiempo total por consulta (~25 s) con el reloj inyectado', async () => {
    assert.equal(TOPE_TIEMPO_MS, 25_000);
    for (const e of ['a', 'b', 'c', 'd', 'e']) await guardar('groq', `groq-${e}-prueba-00001`, e);
    manejador = () => { reloj += 10_000; return estado(503); }; // cada llamada «tarda» 10 s
    const r = await chat();
    assert.equal(r.body.modo, 'contingencia');
    assert.equal(chats().length, 3, 'a los 30 s ya pasó el tope de 25 s: no se hace la cuarta');
    assert.equal(topeTiempoMs(), 25_000);
    process.env.LLAVERO_TOPE_MS = '5000';
    assert.equal(topeTiempoMs(), 5000);
    process.env.LLAVERO_TOPE_MS = '1';
    assert.equal(topeTiempoMs(), 25_000, 'fuera de rango se ignora');
    process.env.LLAVERO_TOPE_MS = 'x';
    assert.equal(topeTiempoMs(), 25_000);
  });
});

// ---------- Reserva ----------
describe('proveedor de reserva', () => {
  it('sólo se usa cuando las rutas normales están agotadas, aunque tenga mejor prioridad de proveedor', async () => {
    await guardar('groq', 'groq-prueba-00001');
    const g = await guardar('gemini', 'gemini-prueba-0001');
    const r = await llamar(base, 'PATCH', `/api/llavero/${g.id}`, T.super, { reserva: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.reserva, true);
    // Orden de la cadena: la reserva SIEMPRE al final (Gemini tiene prioridad 1, pero es reserva).
    assert.deepEqual((await construirCadena()).map((e) => [e.proveedor.id, e.reserva]), [['groq', false], ['gemini', true]]);
    manejador = () => chatOk('Normal');
    for (let i = 0; i < 3; i++) assert.equal((await chat()).body.response, 'Normal');
    assert.ok(chats().every((l) => l.proveedor === 'groq'), 'la reserva no se gasta en el uso normal');
    // Las normales fallan → entra la reserva.
    ia.llamadas.length = 0;
    manejador = (l) => (l.proveedor === 'groq' ? estado(503) : chatOk('Desde la reserva'));
    const rr = await chat();
    assert.deepEqual([rr.body.response, rr.body.modo], ['Desde la reserva', undefined]);
    assert.deepEqual(chats().map((l) => l.proveedor), ['groq', 'gemini']);
  });

  it('la reserva tiene su propio margen: aunque las normales gasten todo el tope de rutas, se le da su oportunidad', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    const o = await guardar('openrouter', 'openrouter-prueba-001', undefined, { });
    await llamar(base, 'PATCH', `/api/llavero/${o.id}`, T.super, { reserva: true });
    await catalogo(q.id, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b');
    process.env.LLAVERO_MAX_INTENTOS = '1';
    manejador = (l) => (l.proveedor === 'openrouter' ? chatOk('Reserva') : estado(404));
    const r = await chat();
    assert.equal(r.body.response, 'Reserva');
    assert.equal(chats().filter((l) => l.proveedor === 'groq').length, 1, 'las normales usaron su único intento');
  });

  it('sin reserva marcada nada cambia; la reserva usada queda en la métrica como cualquier ruta', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    await llamar(base, 'PATCH', `/api/llavero/${q.id}`, T.super, { reserva: true });
    assert.equal((await chat()).body.response, 'Hola', 'una reserva única igual se usa si es lo único que hay');
    const lista = await llamar(base, 'GET', '/api/llavero', T.super);
    assert.equal(lista.body.claves[0].reserva, true);
  });
});

// ---------- Claves rechazadas que se recuperan solas ----------
describe('recuperación de claves rechazadas', () => {
  const rechazar = async (claveId: number, hace: number, detalle = 'La cuenta no tiene saldo') =>
    prisma.claveIntegracion.update({ where: { id: claveId }, data: { estado: 'rechazada', estado_detalle: detalle, probada_at: new Date(reloj - hace) } });

  it('una clave sin saldo que vuelve a responder se rehabilita sola; respeta la separación mínima entre pruebas', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    await rechazar(q.id, ESPERA_RECUPERACION_MS + MIN);
    manejador = () => estado(402);
    assert.deepEqual(await recuperarRechazadas(), { revisadas: 1, rehabilitadas: 0 });
    let f = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: q.id } });
    assert.equal(f.estado, 'rechazada');
    assert.equal(f.estado_detalle, 'La cuenta no tiene saldo');
    assert.equal(f.probada_at?.getTime(), reloj, 'se anotó la hora del intento');
    // Todavía no pasó la separación: ni siquiera pregunta.
    ia.llamadas.length = 0;
    manejador = () => chatOk('ya hay saldo');
    reloj += 4 * HORA;
    assert.deepEqual(await recuperarRechazadas(), { revisadas: 0, rehabilitadas: 0 });
    assert.equal(ia.llamadas.length, 0);
    // Pasada la separación, responde → vuelve a la rotación.
    reloj += 2 * HORA;
    assert.deepEqual(await recuperarRechazadas(), { revisadas: 1, rehabilitadas: 1 });
    f = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: q.id } });
    assert.deepEqual([f.estado, f.estado_detalle], ['ok', null]);
    assert.equal(reintentosDe(q.id), 0, 'el contador se reinicia al rehabilitarla');
    assert.equal(ia.llamadas.length, 1, 'una consulta mínima, nada más');
    assert.equal(ia.llamadas[0].cuerpo.max_tokens <= 8 + 1024, true);
    // Y la usa el chat otra vez.
    ia.llamadas.length = 0;
    assert.equal((await chat()).body.response, 'ya hay saldo');
  });

  it('un 401 transitorio también se recupera; las pausadas y las que no están rechazadas no se tocan', async () => {
    const a = await guardar('groq', 'groq-a-prueba-00001', 'a');
    const b = await guardar('groq', 'groq-b-prueba-00001', 'b');
    const c = await guardar('groq', 'groq-c-prueba-00001', 'c');
    await rechazar(a.id, 6 * HORA, 'La clave fue rechazada');
    await rechazar(b.id, 6 * HORA);
    await prisma.claveIntegracion.update({ where: { id: b.id }, data: { habilitada: false } });
    manejador = () => chatOk('ok');
    assert.deepEqual(await recuperarRechazadas(), { revisadas: 1, rehabilitadas: 1 });
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: a.id } })).estado, 'ok');
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: b.id } })).estado, 'rechazada', 'pausada: no se toca');
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: c.id } })).estado, 'sin_probar');
    assert.ok(ia.llamadas.every((l) => l.clave === 'groq-a-prueba-00001'));
  });

  it('tope de reintentos automáticos: no martilla al proveedor para siempre', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    await rechazar(q.id, 6 * HORA);
    manejador = () => estado(401);
    let total = 0;
    for (let i = 0; i < MAX_REINTENTOS_AUTOMATICOS + 4; i++) {
      reloj += 6 * HORA;
      total += (await recuperarRechazadas()).revisadas;
    }
    assert.equal(total, MAX_REINTENTOS_AUTOMATICOS);
    assert.equal(reintentosDe(q.id), MAX_REINTENTOS_AUTOMATICOS);
    // Una prueba manual sí puede rehabilitarla.
    manejador = () => json({ data: [{ id: 'm' }], models: [{ name: 'models/m', supportedGenerationMethods: ['generateContent'] }], choices: [{ message: { content: 'ok' } }] });
    const p = await llamar(base, 'POST', `/api/llavero/${q.id}/probar`, T.super);
    assert.equal(p.body.estado, 'ok');
  });

  it('la pasada del sync también recupera rechazadas (y con el candado entre réplicas)', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    const o = await guardar('openrouter', 'openrouter-prueba-001');
    await rechazar(o.id, 6 * HORA);
    manejador = (l) => (l.esLista ? listaCompat('qwen/qwen3.8-27b') : chatOk('ok'));
    const r = await pasadaDeSync();
    assert.deepEqual(r, { claves: 1, ok: 1, revisadas: 1, rehabilitadas: 1 });
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: o.id } })).estado, 'ok');
    void q;
  });
});

// ---------- Canary ----------
describe('canary de salud', () => {
  it('ASISTENTE_CANARY: on/off y, sin definir, sólo en producción', () => {
    assert.equal(canaryActivo({ ASISTENTE_CANARY: 'on' } as NodeJS.ProcessEnv), true);
    assert.equal(canaryActivo({ ASISTENTE_CANARY: 'off', NODE_ENV: 'production' } as NodeJS.ProcessEnv), false);
    assert.equal(canaryActivo({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), true);
    assert.equal(canaryActivo({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), false);
  });

  it('una consulta mínima por proveedor: el resultado alimenta el enfriamiento, el retiro de modelos y el rechazo de claves', async () => {
    const g = await guardar('gemini', 'gemini-prueba-0001');
    const q = await guardar('groq', 'groq-prueba-00001');
    const o = await guardar('openrouter', 'openrouter-prueba-001');
    manejador = (l) => (l.proveedor === 'gemini' ? estado(404) : l.proveedor === 'groq' ? estado(503) : estado(402));
    const r = await ejecutarCanary({ maxPorPasada: 3 });
    assert.equal(r.consultas, 3);
    assert.deepEqual(r.resultados.map((x) => [x.proveedor, x.tipo]).sort(), [['gemini', 'modelo'], ['groq', 'caido'], ['openrouter', 'sin_saldo']]);
    assert.equal(modeloMalo('gemini', 'gemini-flash-latest'), true, 'modelo retirado ANTES de que lo sufra un vecino');
    assert.equal(estaEnfriando(claveCooldown('groq', q.id)), true);
    assert.equal(enfriandoHasta(claveCooldown('groq', q.id)), reloj + 30_000);
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: o.id } })).estado, 'rechazada');
    assert.equal(ia.llamadas.length, 3);
    assert.ok(ia.llamadas.every((l) => !l.esLista && l.cuerpo !== null), 'sólo chat mínimo, sin listar modelos');
    // El estado visible refleja lo que vio el canary.
    const s = await salud();
    assert.equal(s.ok, false);
    assert.equal(s.motivo, 'Gemini 404, Groq no responde, OpenRouter sin saldo');
    void g;
  });

  it('un proveedor en 429 se anota con su espera; lo sano se limpia y no se castiga a nadie por «sin texto»', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    registrarEspera(q.id);
    manejador = () => estado(429, { 'retry-after': '90' });
    // La clave está enfriada: el canary no la molesta.
    assert.equal((await ejecutarCanary({ maxPorPasada: 3 })).consultas, 0);
    limpiarTodo();
    const r = await ejecutarCanary({ maxPorPasada: 3 });
    assert.equal(r.resultados[0].tipo, 'limite');
    assert.equal(enfriandoHasta(claveCooldown('groq', q.id)), reloj + 90_000);
  });

  it('rota entre las claves sanas del proveedor (una por pasada) y salta las enfriadas', async () => {
    const a = await guardar('groq', 'groq-a-prueba-00001', 'a');
    await guardar('groq', 'groq-b-prueba-00001', 'b');
    const c = await guardar('groq', 'groq-c-prueba-00001', 'c');
    registrarEspera(c.id);
    await ejecutarCanary({ maxPorPasada: 3 });
    await ejecutarCanary({ maxPorPasada: 3 });
    await ejecutarCanary({ maxPorPasada: 3 });
    assert.deepEqual(ia.llamadas.map((l) => l.clave.slice(5, 6)), ['a', 'b', 'a'], 'alterna a/b; la enfriada c nunca');
    void a;
  });

  it('presupuesto bajo: máx. ~50 consultas al día en total, con pasadas de 30 min durante todo el día; al día siguiente se renueva', async () => {
    assert.equal(PRESUPUESTO_DIARIO, 50);
    await guardar('gemini', 'gemini-prueba-0001');
    await guardar('groq', 'groq-prueba-00001');
    await guardar('openrouter', 'openrouter-prueba-001');
    // Aun pidiendo 3 por pasada, el presupuesto del día corta en 50.
    let total = 0;
    for (let i = 0; i < 48; i++) {
      total += (await ejecutarCanary({ maxPorPasada: 3 })).consultas;
      reloj += 30 * MIN;
    }
    reloj -= 30 * MIN; // el último paso del bucle ya cruzó a otro día
    assert.equal(total, 50);
    assert.equal(consumoDelDia(reloj), 50);
    assert.equal((await ejecutarCanary({ maxPorPasada: 3 })).consultas, 0, 'presupuesto agotado');
    // Día nuevo (Lima): se renueva.
    reloj = MEDIANOCHE_LIMA + 24 * HORA + MIN;
    assert.ok((await ejecutarCanary({ maxPorPasada: 3 })).consultas > 0);
    assert.equal(consumoDelDia(reloj), 3);
  });

  it('con el ritmo por omisión reparte el presupuesto a lo largo del día (alcanza para las 48 pasadas) y revisa primero al más rezagado', async () => {
    await guardar('gemini', 'gemini-prueba-0001');
    await guardar('groq', 'groq-prueba-00001');
    await guardar('openrouter', 'openrouter-prueba-001');
    let total = 0;
    const orden: string[] = [];
    for (let i = 0; i < 48; i++) {
      const r = await ejecutarCanary();
      total += r.consultas;
      orden.push(...r.resultados.map((x) => x.proveedor));
      reloj += 30 * MIN;
    }
    assert.ok(total >= 40 && total <= 50, `consultas del día: ${total}`);
    assert.deepEqual(orden.slice(0, 3), ['gemini', 'groq', 'openrouter'], 'cada pasada toma al más rezagado: rota');
    for (const p of ['gemini', 'groq', 'openrouter']) assert.ok(orden.filter((x) => x === p).length >= 13, `${p} se revisó con regularidad`);
  });

  it('sin claves no hace nada; con el candado de otra réplica la pasada no corre', async () => {
    assert.equal((await ejecutarCanary()).consultas, 0);
    await guardar('groq', 'groq-prueba-00001');
    const libre = await pasadaDeCanary();
    assert.equal(libre?.consultas, 1);
    ia.llamadas.length = 0;
    reiniciarCanary();
    await prisma.$transaction(async (tx) => {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_CANARY}) AS ok`;
      assert.equal(ok, true);
      assert.equal(await pasadaDeCanary(), null);
    });
    assert.equal(ia.llamadas.length, 0);
  });
});

/** Atajo: deja la clave enfriada ahora (429 sin Retry-After = 60 s). */
const registrarEspera = (claveId: number) => registrarEstado(claveCooldown('groq', claveId), 429);

// ---------- Alertas ----------
describe('alerta al superadmin cuando no queda NINGUNA ruta sana', () => {
  const alertas = (tipo: string) => prisma.notificacion.findMany({ where: { tipo }, orderBy: { id: 'asc' } });

  it('una sola alerta por estado (≥ 6 h para repetir), al recuperarse un aviso de «IA restablecida», y GET /api/llavero lo muestra', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = () => estado(503);
    // Sana al principio: sin banner ni avisos.
    let s = await salud();
    assert.deepEqual([s.ok, s.desde, s.motivo], [true, null, null]);
    assert.equal(await prisma.notificacion.count(), 0);

    assert.equal((await chat()).body.modo, 'contingencia');
    s = await salud();
    assert.equal(s.ok, false);
    assert.equal(s.desde, new Date(MEDIANOCHE_LIMA).toISOString());
    assert.equal(s.motivo, 'Groq no responde');
    assert.deepEqual(s.rutas, [{ proveedor: 'groq', modelo: 'openai/gpt-oss-120b', estado: 'enfriando', hasta: new Date(MEDIANOCHE_LIMA + 30_000).toISOString(), reserva: false, clave_id: s.rutas[0].clave_id }]);
    let a = await alertas('ia_caida');
    assert.equal(a.length, 1);
    assert.equal(a[0].usuario_id, D.superadmin.id, 'sólo al superadmin');
    assert.equal(a[0].canal, 'email');
    assert.equal(a[0].ref_entidad, 'ia');
    assert.match(a[0].cuerpo, /Sin IA disponible desde las 00:00: Groq no responde\./);
    assert.match(a[0].asunto, /sin proveedores/);

    // Mismo estado, dentro de las 6 h: ninguna alerta más (aunque pasen los 30 s del enfriamiento y siga cayendo).
    for (let i = 0; i < 4; i++) { reloj += 90_000; await chat(); }
    assert.equal((await alertas('ia_caida')).length, 1);
    // Aun con el enfriamiento vencido, la pantalla sigue en rojo hasta que se confirme que volvió.
    reloj += HORA;
    assert.equal((await salud()).ok, false);
    assert.equal((await alertas('ia_caida')).length, 1, 'cinco horas después, mismo estado');
    reloj += 5 * HORA;
    await chat();
    a = await alertas('ia_caida');
    assert.equal(a.length, 2, 'pasadas 6 h del mismo estado se recuerda');

    // Recuperación: un aviso, no más.
    manejador = () => chatOk('Ya volvió');
    limpiarTodo();
    assert.equal((await chat()).body.response, 'Ya volvió');
    const r = await alertas('ia_restablecida');
    assert.equal(r.length, 1);
    assert.equal(r[0].usuario_id, D.superadmin.id);
    assert.match(r[0].cuerpo, /se restableció\. Estuvo sin servicio desde las 00:00\./);
    s = await salud();
    assert.deepEqual([s.ok, s.desde, s.motivo], [true, null, null]);
    for (let i = 0; i < 3; i++) await chat();
    assert.equal((await alertas('ia_restablecida')).length, 1);
    // Una caída nueva más adelante vuelve a avisar.
    manejador = () => estado(503);
    limpiarTodo();
    reloj += 2 * HORA;
    await chat();
    assert.equal((await alertas('ia_caida')).length, 3);
    assert.equal((await salud()).desde, new Date(reloj).toISOString());
  });

  it('un cambio de estado (otra causa) se avisa, pero no más de una alerta por hora', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    manejador = () => estado(503);
    await chat();
    assert.equal((await alertas('ia_caida')).length, 1);
    // A los 10 min la clave queda rechazada (otro estado): dentro de la hora no se repite el aviso.
    reloj += 10 * MIN;
    await prisma.claveIntegracion.update({ where: { id: q.id }, data: { estado: 'rechazada', estado_detalle: 'La cuenta no tiene saldo' } });
    await actualizarSalud();
    assert.equal((await alertas('ia_caida')).length, 1);
    reloj += 55 * MIN;
    await actualizarSalud();
    const a = await alertas('ia_caida');
    assert.equal(a.length, 2);
    assert.match(a[1].cuerpo, /Groq sin saldo/);
  });

  it('sin claves configuradas no hay nada que vigilar: ni banner ni avisos; con la clave del entorno cuenta como ruta', async () => {
    let s = await salud();
    assert.deepEqual([s.configurada, s.ok, s.desde], [false, false, null]);
    assert.deepEqual(await prisma.notificacion.count(), 0);
    await actualizarSalud();
    assert.equal(await prisma.notificacion.count(), 0);
    process.env.GEMINI_API_KEY = 'gemini-entorno-0004';
    s = await saludActual();
    assert.deepEqual([s.configurada, s.ok, s.rutas.length], [true, true, 1]);
  });

  it('los avisos usan la cola de avisos (pendientes) y respetan las preferencias del superadmin', async () => {
    await guardar('groq', 'groq-prueba-00001');
    await prisma.usuario.update({ where: { id: D.superadmin.id }, data: { aviso_email: false, aviso_whatsapp: true, telefono: '987654321' } });
    manejador = () => estado(503);
    await chat();
    const a = await prisma.notificacion.findMany({ where: { tipo: 'ia_caida' } });
    assert.deepEqual(a.map((n) => [n.canal, n.estado]), [['whatsapp', 'pendiente']]);
    await prisma.usuario.update({ where: { id: D.superadmin.id }, data: { aviso_email: true, aviso_whatsapp: false, telefono: null } });
  });
});
