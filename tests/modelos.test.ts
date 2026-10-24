import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { clasificarModelo, esGratis, esModeloDeChat, leerListaModelos } from '../src/server/lib/modelosIA';
import { limpiarModelosMalos, marcarModeloMalo } from '../src/server/lib/modelosMalos';
import { limpiarTodo, cooldownDeps } from '../src/server/lib/cooldown';
import { proveedorPorId } from '../src/server/lib/proveedoresIA';
import { llaveroDeps } from '../src/server/services/llavero';
import { elegirModeloAuto, candidatosDeClave } from '../src/server/services/modelos/seleccion';
import { LOCK_MODELOS, pasadaDeSync, esperarSincronizaciones, sincronizacionActiva, sincronizarClave, sincronizarEnSegundoPlano, sincronizarTodas, syncDeps } from '../src/server/services/modelos/sync';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const fetchOriginal = llaveroDeps.fetch;
const AHORA = new Date('2026-10-23T15:00:00.000Z');

let base: string;
let cerrar: () => Promise<void>;
let superadmin: string;
let llamadas: { url: string; clave: string }[] = [];
let listas: Record<string, () => Response> = {};

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });
const gemini = (...ids: [string, string[]?][]) => json({ models: ids.map(([id, metodos]) => ({ name: `models/${id}`, displayName: id, inputTokenLimit: 1_000_000, supportedGenerationMethods: metodos ?? ['generateContent'] })) });
const compat = (...ids: [string, string?][]) => json({ data: ids.map(([id, name]) => ({ id, name: name ?? `Pantalla ${id}`, object: 'model' })) });

const GEMINI_REAL = () => gemini(['gemini-2.5-flash'], ['gemini-2.5-flash-lite'], ['gemini-flash-latest'], ['gemini-flash-lite-latest'], ['gemini-3.5-flash'], ['gemini-embedding-001', ['embedContent']], ['gemini-2.5-flash-preview-tts']);
const GROQ_REAL = () => compat(['openai/gpt-oss-120b'], ['openai/gpt-oss-20b'], ['qwen/qwen3.8-27b'], ['whisper-large-v3'], ['llama-guard-4-12b']);
const OPENROUTER_REAL = () => compat(['google/gemma-4-31b-it:free', 'Google: Gemma 4 31B (free)'], ['nvidia/nemotron-3-super-120b-a12b:free'], ['poolside/laguna-s-2.1:free'], ['openai/gpt-4o'], ['openai/text-embedding-3-small']);

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, llavero: 100_000 } }));
  superadmin = await login(base, 'super@test.pe');
  llaveroDeps.fetch = async (url, init = {}) => {
    const h = init.headers as Record<string, string>;
    llamadas.push({ url, clave: h['x-goog-api-key'] ?? h.Authorization.replace('Bearer ', '') });
    const proveedor = url.includes('generativelanguage') ? 'gemini' : url.includes('groq') ? 'groq' : 'openrouter';
    return (listas[proveedor] ?? (() => json({}, 500)))();
  };
  syncDeps.ahora = () => AHORA;
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  delete process.env.LLAVERO_ENC_KEY;
  delete process.env.MODELOS_SYNC;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  process.env.MODELOS_SYNC = 'off';
  await prisma.claveIntegracion.deleteMany();
  limpiarTodo();
  limpiarModelosMalos();
  llamadas = [];
  listas = { gemini: GEMINI_REAL, groq: GROQ_REAL, openrouter: OPENROUTER_REAL };
});
afterEach(() => { syncDeps.ahora = () => AHORA; cooldownDeps.ahora = () => Date.now(); });

const guardar = async (proveedor: string, clave: string, etiqueta?: string, extra: Record<string, unknown> = {}) =>
  (await llamar(base, 'PUT', `/api/llavero/${proveedor}`, superadmin, { clave, ...(etiqueta ? { etiqueta } : {}), ...extra })).body as { id: number };
const modelos = (claveId: number) => prisma.modeloIA.findMany({ where: { clave_id: claveId }, orderBy: { modelo_id: 'asc' } });
const estadoDe = async (claveId: number, id: string) => (await prisma.modeloIA.findUniqueOrThrow({ where: { clave_id_modelo_id: { clave_id: claveId, modelo_id: id } } })).estado;

describe('clasificador y filtro de modelos', () => {
  it('categoriza por patrones de nombre con los modelos reales de producción', () => {
    const esperado: Record<string, string> = {
      'gemini-2.5-flash': 'rapido',
      'gemini-2.5-flash-lite': 'rapido',
      'gemini-flash-latest': 'rapido',
      'gemini-flash-lite-latest': 'rapido',
      'gemini-3.5-flash': 'rapido',
      'gemini-3-pro-preview': 'avanzado',
      'openai/gpt-oss-120b': 'razonamiento',
      'openai/gpt-oss-20b': 'razonamiento',
      'qwen/qwen3.8-27b': 'equilibrado',
      'google/gemma-4-31b-it:free': 'equilibrado',
      'nvidia/nemotron-3-super-120b-a12b:free': 'avanzado',
      'poolside/laguna-s-2.1:free': 'equilibrado',
      'llama-3.1-8b-instant': 'rapido',
      'deepseek-r1-distill': 'razonamiento',
      'o3-mini': 'razonamiento',
      'gpt-4o-mini': 'rapido',
      'mistral-large-latest': 'avanzado',
      'claude-opus-5-5': 'avanzado',
      'gpt-4o': 'equilibrado',
    };
    for (const [id, categoria] of Object.entries(esperado)) assert.equal(clasificarModelo(id), categoria, id);
  });

  it('descarta embeddings, voz, imagen/video y moderación (categoría «otro», no elegibles)', () => {
    for (const id of ['gemini-embedding-001', 'openai/text-embedding-3-small', 'whisper-large-v3', 'whisper-large-v3-turbo', 'playai-tts', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-image', 'imagen-4.0-generate', 'veo-3.0', 'llama-guard-4-12b', 'omni-moderation-latest', 'meta-llama/llama-prompt-guard-2-86m', 'gpt-4o-transcribe', 'gemini-live-2.5-flash']) {
      assert.equal(esModeloDeChat(id), false, id);
      assert.equal(clasificarModelo(id), 'otro', id);
    }
    assert.equal(esModeloDeChat('gemini-2.5-flash'), true);
  });

  it('gratis sólo por el sufijo :free de OpenRouter', () => {
    assert.equal(esGratis('openrouter', 'google/gemma-4-31b-it:free'), true);
    assert.equal(esGratis('openrouter', 'openai/gpt-4o'), false);
    assert.equal(esGratis('groq', 'algo:free'), false);
  });

  it('Gemini: quita models/ y exige generateContent; compatibles: usan `id`, no el nombre de pantalla; cuerpo raro → null', () => {
    const g = leerListaModelos({ id: 'gemini', tipo: 'gemini' }, { models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/sin-metodos' },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    ] });
    assert.deepEqual(g, [{ modelo_id: 'gemini-2.5-flash', nombre: 'Gemini 2.5 Flash', ventana: 1048576, vision: true }]);
    const o = leerListaModelos({ id: 'openrouter', tipo: 'openai-compatible' }, { data: [
      { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (free)', context_length: 131072, architecture: { input_modalities: ['text', 'image'] } },
      { id: 'raro con espacios' },
      { name: 'sin id' },
    ] });
    assert.deepEqual(o, [{ modelo_id: 'google/gemma-4-31b-it:free', nombre: 'Google: Gemma 4 31B (free)', ventana: 131072, vision: true }]);
    assert.equal(leerListaModelos({ id: 'groq', tipo: 'openai-compatible' }, { error: 'x' }), null);
    assert.equal(leerListaModelos({ id: 'groq', tipo: 'openai-compatible' }, '<html>'), null);
    assert.deepEqual(leerListaModelos({ id: 'groq', tipo: 'openai-compatible' }, { data: [] }), []);
  });
});

describe('sincronización', () => {
  it('modelo nuevo → se inserta ACTIVO, deja historial; los que no son de chat quedan como «otro» y no cuentan', async () => {
    const g = await guardar('gemini', 'gemini-prueba-0001');
    const r = await sincronizarClave(g.id);
    assert.ok(r?.ok);
    assert.equal(r.nuevos, 5);
    assert.equal(r.total, 5);
    const filas = await modelos(g.id);
    assert.equal(filas.length, 6, 'el de embeddings no sale en la lista de Gemini; el TTS se guarda como «otro»');
    for (const f of filas.filter((x) => x.categoria !== 'otro')) assert.equal(f.estado, 'activo');
    const tts = filas.find((f) => f.modelo_id === 'gemini-2.5-flash-preview-tts')!;
    assert.equal(tts.categoria, 'otro');
    assert.ok(!filas.some((f) => f.modelo_id.startsWith('models/')), 'sin el prefijo models/');
    const h = await prisma.syncModelosIA.findMany({ where: { clave_id: g.id } });
    assert.equal(h.length, 1);
    assert.equal(h[0].ok, true);
    assert.equal(h[0].nuevos, 5);
    assert.ok((h[0].detalle as { nuevos: string[] }).nuevos.includes('gemini-flash-latest'));
    assert.equal(llamadas[0].url, 'https://generativelanguage.googleapis.com/v1beta/models');
    // Una segunda pasada igual no cambia nada.
    const r2 = await sincronizarClave(g.id);
    assert.deepEqual([r2?.nuevos, r2?.deprecados, r2?.revividos], [0, 0, 0]);
  });

  it('Groq y OpenRouter: usa el id (no el nombre de pantalla), marca gratis y filtra whisper/guard/embeddings', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    const o = await guardar('openrouter', 'openrouter-prueba-001');
    await sincronizarClave(q.id);
    await sincronizarClave(o.id);
    const gq = await modelos(q.id);
    assert.deepEqual(gq.filter((m) => m.categoria !== 'otro').map((m) => m.modelo_id), ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
    assert.deepEqual(gq.filter((m) => m.categoria === 'otro').map((m) => m.modelo_id), ['llama-guard-4-12b', 'whisper-large-v3']);
    const go = await modelos(o.id);
    assert.equal(go.find((m) => m.modelo_id === 'google/gemma-4-31b-it:free')?.gratis, true);
    assert.equal(go.find((m) => m.modelo_id === 'google/gemma-4-31b-it:free')?.nombre, 'Google: Gemma 4 31B (free)');
    assert.equal(go.find((m) => m.modelo_id === 'openai/gpt-4o')?.gratis, false);
    assert.equal(go.find((m) => m.modelo_id === 'openai/text-embedding-3-small')?.categoria, 'otro');
  });

  it('el que ya no aparece pasa a deprecado CON fecha (no se borra); si reaparece vuelve a activo', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    await sincronizarClave(q.id);
    listas.groq = () => compat(['openai/gpt-oss-120b'], ['qwen/qwen3.8-27b']);
    syncDeps.ahora = () => new Date('2026-10-24T09:00:00.000Z');
    const r = await sincronizarClave(q.id);
    assert.deepEqual([r?.nuevos, r?.deprecados, r?.revividos], [0, 1, 0]);
    const gone = await prisma.modeloIA.findUniqueOrThrow({ where: { clave_id_modelo_id: { clave_id: q.id, modelo_id: 'openai/gpt-oss-20b' } } });
    assert.equal(gone.estado, 'deprecado');
    assert.equal(gone.deprecado_at?.toISOString(), '2026-10-24T09:00:00.000Z');
    // Los de «otro» que desaparecen también se deprecan, pero no cuentan como retirados de chat.
    assert.equal(await estadoDe(q.id, 'whisper-large-v3'), 'deprecado');
    const ultimo = (await prisma.syncModelosIA.findMany({ where: { clave_id: q.id }, orderBy: { id: 'desc' } }))[0];
    assert.deepEqual((ultimo.detalle as { deprecados: string[] }).deprecados, ['openai/gpt-oss-20b']);
    // Reaparece.
    listas.groq = GROQ_REAL;
    const r3 = await sincronizarClave(q.id);
    assert.equal(r3?.revividos, 1);
    const vuelve = await prisma.modeloIA.findUniqueOrThrow({ where: { clave_id_modelo_id: { clave_id: q.id, modelo_id: 'openai/gpt-oss-20b' } } });
    assert.equal(vuelve.estado, 'activo');
    assert.equal(vuelve.deprecado_at, null);
  });

  it('lista vacía, cuerpo ilegible, error del proveedor, red y timeout NO deprecan nada', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    await sincronizarClave(q.id);
    const antes = (await modelos(q.id)).map((m) => `${m.modelo_id}:${m.estado}`);
    const casos: [() => Response, string, number | null][] = [
      [() => compat(), 'El proveedor devolvió una lista vacía', 200],
      [() => new Response('<html>', { status: 200 }), 'El proveedor devolvió una lista ilegible', 200],
      [() => json({ error: 'x' }, 500), 'El proveedor tuvo un problema, intenta más tarde', 500],
      [() => json({}, 401), 'La clave fue rechazada o no es válida', 401],
      [() => { throw new TypeError('fetch failed'); }, 'No se pudo conectar con el proveedor', null],
      [() => { throw new DOMException('timeout', 'TimeoutError'); }, 'El proveedor no respondió a tiempo', null],
    ];
    for (const [resp, error, status] of casos) {
      listas.groq = resp;
      const r = await sincronizarClave(q.id);
      assert.equal(r?.ok, false);
      assert.equal(r?.error, error);
      assert.equal(r?.status, status);
      assert.equal(r?.deprecados, 0);
      assert.deepEqual((await modelos(q.id)).map((m) => `${m.modelo_id}:${m.estado}`), antes);
    }
    const h = await prisma.syncModelosIA.findMany({ where: { clave_id: q.id, ok: false } });
    assert.equal(h.length, casos.length, 'cada fallo queda en el historial');
  });

  it('si el modelo fijado en la clave deja de existir, la clave vuelve a automático y la pantalla lo dice', async () => {
    const q = await guardar('groq', 'groq-prueba-00001', undefined, { modelo: 'openai/gpt-oss-20b' });
    await sincronizarClave(q.id);
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: q.id } })).modelo, 'openai/gpt-oss-20b', 'vigente: se respeta');
    listas.groq = () => compat(['openai/gpt-oss-120b'], ['qwen/qwen3.8-27b']);
    const r = await sincronizarClave(q.id);
    assert.equal(r?.avisoModelo, 'El modelo openai/gpt-oss-20b ya no existe; ahora usa openai/gpt-oss-120b');
    const f = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: q.id } });
    assert.equal(f.modelo, null);
    assert.equal(f.aviso_modelo, r?.avisoModelo);
  });

  it('un modelo revivido por el sync deja de estar en la memoria negativa del proveedor', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    await sincronizarClave(q.id);
    listas.groq = () => compat(['qwen/qwen3.8-27b']);
    await sincronizarClave(q.id);
    marcarModeloMalo('groq', 'openai/gpt-oss-120b');
    listas.groq = GROQ_REAL;
    await sincronizarClave(q.id);
    assert.equal((await candidatosDeClave({ claveId: q.id, proveedor: proveedorPorId('groq')!, modelo: null })).modelos[0], 'openai/gpt-oss-120b');
  });

  it('sincronizarTodas: sólo claves habilitadas y no rechazadas; una que falla no frena a las otras', async () => {
    const a = await guardar('gemini', 'gemini-prueba-0001');
    const b = await guardar('groq', 'groq-prueba-00001');
    const c = await guardar('openrouter', 'openrouter-prueba-001');
    const d = await guardar('groq', 'groq-prueba-00002', 'otra');
    await prisma.claveIntegracion.update({ where: { id: c.id }, data: { habilitada: false } });
    await prisma.claveIntegracion.update({ where: { id: d.id }, data: { estado: 'rechazada' } });
    listas.gemini = () => json({}, 500);
    const r = await sincronizarTodas();
    assert.deepEqual(r, { claves: 2, ok: 1 });
    assert.equal(llamadas.length, 2);
    assert.equal((await modelos(b.id)).length > 0, true);
    assert.equal((await modelos(a.id)).length, 0);
    assert.equal((await modelos(c.id)).length, 0);
  });

  it('MODELOS_SYNC: off/on/sin definir (sólo producción) y el disparo al guardar sólo corre si está activo', async () => {
    assert.equal(sincronizacionActiva({ MODELOS_SYNC: 'on' } as NodeJS.ProcessEnv), true);
    assert.equal(sincronizacionActiva({ MODELOS_SYNC: 'off', NODE_ENV: 'production' } as NodeJS.ProcessEnv), false);
    assert.equal(sincronizacionActiva({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), true);
    assert.equal(sincronizacionActiva({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), false);
    // Apagado: guardar no sincroniza.
    const q = await guardar('groq', 'groq-prueba-00001');
    sincronizarEnSegundoPlano(q.id);
    await esperarSincronizaciones();
    assert.equal(llamadas.length, 0);
    // Activo: guardar una clave dispara la sincronización.
    process.env.MODELOS_SYNC = 'on';
    const g = await guardar('gemini', 'gemini-prueba-0001');
    await esperarSincronizaciones();
    assert.ok((await modelos(g.id)).length > 0, 'guardar sincronizó');
  });

  it('bloqueo entre réplicas: si otra tiene el turno, la pasada no hace nada', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    const libre = await pasadaDeSync();
    assert.deepEqual(libre, { claves: 1, ok: 1 });
    llamadas = [];
    await prisma.$transaction(async (tx) => {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_MODELOS}) AS ok`;
      assert.equal(ok, true);
      assert.equal(await pasadaDeSync(), null);
    });
    assert.equal(llamadas.length, 0);
    assert.equal((await prisma.syncModelosIA.count({ where: { clave_id: q.id } })), 1);
  });

  it('la clave de la API de Groq nunca queda en el historial ni en el catálogo', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    await sincronizarClave(q.id);
    const todo = JSON.stringify([await modelos(q.id), await prisma.syncModelosIA.findMany()]);
    assert.equal(todo.includes('groq-prueba-00001'), false);
  });
});

describe('elegirModeloAuto', () => {
  const clave = (proveedor: string, claveId: number | null, modelo: string | null = null) => ({ claveId, proveedor: proveedorPorId(proveedor)!, modelo });

  it('sin lista viva usa el modeloPorDefecto del catálogo (o el fijado)', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    assert.equal(await elegirModeloAuto(clave('groq', q.id)), 'openai/gpt-oss-120b');
    assert.equal(await elegirModeloAuto(clave('groq', q.id, 'qwen/qwen3.8-27b')), 'qwen/qwen3.8-27b');
    assert.equal(await elegirModeloAuto(clave('gemini', null)), 'gemini-flash-latest');
  });

  it('prefiere por proveedor: Gemini flash-latest, Groq gpt-oss-120b, OpenRouter sólo :free', async () => {
    const g = await guardar('gemini', 'gemini-prueba-0001');
    const q = await guardar('groq', 'groq-prueba-00001');
    const o = await guardar('openrouter', 'openrouter-prueba-001');
    await Promise.all([g, q, o].map((c) => sincronizarClave(c.id)));
    assert.equal(await elegirModeloAuto(clave('gemini', g.id), { esfuerzo: 'medium' }), 'gemini-flash-latest');
    assert.equal(await elegirModeloAuto(clave('groq', q.id), { esfuerzo: 'medium' }), 'openai/gpt-oss-120b');
    const c = await candidatosDeClave(clave('openrouter', o.id));
    assert.equal(c.modelos[0], 'google/gemma-4-31b-it:free');
    assert.ok(c.modelos.every((m) => m.endsWith(':free')), 'OpenRouter en Auto nunca elige uno de pago');
    assert.equal(c.modelos.length, 2, 'máximo 2 modelos por clave');
    // El admin que fija uno de pago en la clave lo obtiene.
    assert.equal((await candidatosDeClave(clave('openrouter', o.id, 'openai/gpt-4o'))).modelos[0], 'openai/gpt-4o');
  });

  it('la categoría sigue a la petición: esfuerzo bajo o mensaje corto → rápido; alto → razonamiento/avanzado si existe', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    listas.groq = () => compat(['openai/gpt-oss-120b'], ['llama-3.1-8b-instant'], ['qwen/qwen3.8-27b'], ['llama-3.3-70b-versatile']);
    await sincronizarClave(q.id);
    const c = clave('groq', q.id);
    assert.equal(await elegirModeloAuto(c, { esfuerzo: 'low' }), 'llama-3.1-8b-instant');
    assert.equal(await elegirModeloAuto(c, { esfuerzo: 'medium', mensajeCorto: true }), 'llama-3.1-8b-instant');
    assert.equal(await elegirModeloAuto(c, { esfuerzo: 'high' }), 'openai/gpt-oss-120b');
    assert.equal(await elegirModeloAuto(c, { esfuerzo: 'medium' }), 'openai/gpt-oss-120b');
    // Sin modelos de la categoría pedida, no se queda sin respuesta: cae a la preferencia normal.
    const g = await guardar('gemini', 'gemini-prueba-0001');
    await sincronizarClave(g.id);
    assert.equal(await elegirModeloAuto(clave('gemini', g.id), { esfuerzo: 'high' }), 'gemini-flash-latest');
  });

  it('un modelo deprecado jamás se elige; el fijado deprecado se ignora; los marcados malos se saltan', async () => {
    const q = await guardar('groq', 'groq-prueba-00001', undefined, { modelo: 'openai/gpt-oss-20b' });
    await sincronizarClave(q.id);
    await prisma.modeloIA.update({ where: { clave_id_modelo_id: { clave_id: q.id, modelo_id: 'openai/gpt-oss-120b' } }, data: { estado: 'deprecado' } });
    await prisma.modeloIA.update({ where: { clave_id_modelo_id: { clave_id: q.id, modelo_id: 'openai/gpt-oss-20b' } }, data: { estado: 'deprecado' } });
    // La clave todavía dice 20b (el sync no corrió): igual se ignora porque está deprecado.
    assert.equal(await elegirModeloAuto(clave('groq', q.id, 'openai/gpt-oss-20b')), 'qwen/qwen3.8-27b');
    marcarModeloMalo('groq', 'qwen/qwen3.8-27b');
    assert.deepEqual((await candidatosDeClave(clave('groq', q.id))).modelos, []);
    assert.equal(await elegirModeloAuto(clave('groq', q.id)), 'openai/gpt-oss-120b', 'sin candidatos: el defecto del catálogo');
  });

  it('modelo fijo por el usuario: sólo cuenta en las claves que lo tienen activo', async () => {
    const q = await guardar('groq', 'groq-prueba-00001');
    const g = await guardar('gemini', 'gemini-prueba-0001');
    await sincronizarClave(q.id);
    await sincronizarClave(g.id);
    assert.deepEqual((await candidatosDeClave(clave('groq', q.id), { modeloFijo: 'qwen/qwen3.8-27b' })).modelos, ['qwen/qwen3.8-27b']);
    assert.deepEqual((await candidatosDeClave(clave('gemini', g.id), { modeloFijo: 'qwen/qwen3.8-27b' })).modelos, []);
    assert.deepEqual((await candidatosDeClave(clave('groq', q.id), { modeloFijo: 'whisper-large-v3' })).modelos, [], 'los que no son de chat no son elegibles');
  });
});
