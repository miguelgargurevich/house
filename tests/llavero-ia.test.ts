import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { chatOk, estado, instalarIA, json, listaCompat, listaGemini, type LlamadaIA } from './helpers/ia';
import { claveCooldown, limpiarTodo, registrarEstado, estaEnfriando } from '../src/server/lib/cooldown';
import { limpiarModelosMalos } from '../src/server/lib/modelosMalos';
import { syncDeps } from '../src/server/services/modelos/sync';
import { olvidarCausas, olvidarSaludEnMemoria } from '../src/server/services/asistente/salud';
import { olvidarTodoUso } from '../src/server/services/rotacion';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const KEY = 'sk-prueba-0000-AAAA';

let base: string;
let cerrar: () => Promise<void>;
let T: { super: string; adminA: string };
let ia: ReturnType<typeof instalarIA>;
let manejador: (l: LlamadaIA) => Response | Promise<Response> = () => chatOk('ok');
const logs: string[] = [];
const consolaOriginal = { log: console.log, warn: console.warn, error: console.error, info: console.info };

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
  ia = instalarIA((l) => manejador(l));
  syncDeps.ahora = () => new Date('2026-10-23T15:00:00.000Z');
});
after(async () => {
  ia.restaurar();
  delete process.env.LLAVERO_ENC_KEY;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.GEMINI_API_KEY;
  await prisma.claveIntegracion.deleteMany();
  await prisma.auditoria.deleteMany();
  await prisma.estadoIA.deleteMany();
  limpiarTodo();
  limpiarModelosMalos();
  olvidarTodoUso();
  olvidarCausas();
  olvidarSaludEnMemoria();
  ia.llamadas.length = 0;
  logs.length = 0;
  manejador = (l) => (l.esLista ? (l.proveedor === 'gemini' ? listaGemini('gemini-2.5-flash') : listaCompat('openai/gpt-oss-120b', 'qwen/qwen3.8-27b')) : chatOk('ok'));
  for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
});
afterEach(() => { Object.assign(console, consolaOriginal); });

const guardar = async (proveedor: string, clave = KEY, extra: Record<string, unknown> = {}) => (await llamar(base, 'PUT', `/api/llavero/${proveedor}`, T.super, { clave, ...extra })).body as { id: number };
const probar = (id: number) => llamar(base, 'POST', `/api/llavero/${id}/probar`, T.super);

describe('«Probar» de verdad (consulta mínima de chat)', () => {
  it('ok sólo si el modelo respondió texto: lista + sincroniza + UNA consulta mínima con el modelo elegido', async () => {
    const f = await guardar('groq');
    const r = await probar(f.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.estado, 'ok');
    assert.equal(r.body.estado_detalle, null);
    assert.equal(r.body.modelo_probado, 'openai/gpt-oss-120b');
    assert.deepEqual(r.body.sync, { ok: true, nuevos: 2, deprecados: 0, revividos: 0, total: 2 });
    assert.deepEqual(ia.llamadas.map((l) => [l.metodo, l.esLista]), [['GET', true], ['POST', false]]);
    const c = ia.llamadas[1].cuerpo;
    assert.equal(c.model, 'openai/gpt-oss-120b');
    assert.equal(c.max_tokens, 8 + 256, '≈ 8 tokens (más el margen de razonamiento de gpt-oss, esfuerzo bajo)');
    assert.equal(c.reasoning_effort, 'low');
    assert.equal(await prisma.modeloIA.count({ where: { clave_id: f.id } }), 2, 'la prueba dejó el catálogo al día');
    assert.ok(ia.llamadas[1].signal, 'con tiempo límite');
  });

  it('un 200 SIN texto no es «ok»', async () => {
    const f = await guardar('groq');
    manejador = (l) => (l.esLista ? listaCompat('qwen/qwen3.8-27b') : json({ choices: [{ message: { content: '' } }] }));
    const r = await probar(f.id);
    assert.equal(r.body.estado, 'error');
    assert.equal(r.body.estado_detalle, 'El modelo qwen/qwen3.8-27b no devolvió texto');
  });

  it('detalles accionables: rechazada, modelo no disponible, límite, sin saldo, tiempo agotado, sin conexión, proveedor caído', async () => {
    const f = await guardar('groq');
    const casos: [(l: LlamadaIA) => Response, string][] = [
      [() => estado(401), 'La clave fue rechazada'],
      [() => estado(403), 'La clave fue rechazada'],
      [() => estado(404), 'La clave sirve pero el modelo openai/gpt-oss-120b no está disponible (se probará otro)'],
      [() => estado(429), 'Límite del proveedor'],
      [() => estado(402), 'La cuenta no tiene saldo'],
      [() => estado(503), 'El proveedor tuvo un problema, intenta más tarde'],
      [() => { throw new DOMException('timeout', 'TimeoutError'); }, 'El proveedor no respondió a tiempo'],
      [() => { throw new TypeError(`fetch failed ${KEY}`); }, 'No se pudo conectar con el proveedor'],
      [() => estado(400), 'El modelo openai/gpt-oss-120b no aceptó la consulta de prueba'],
    ];
    for (const [resp, detalle] of casos) {
      limpiarModelosMalos();
      await prisma.modeloIA.updateMany({ data: { estado: 'activo', deprecado_at: null } });
      manejador = (l) => (l.esLista ? listaCompat('openai/gpt-oss-120b', 'qwen/qwen3.8-27b') : resp(l));
      const r = await probar(f.id);
      assert.equal(r.status, 200);
      assert.equal(r.body.estado, 'error', detalle);
      assert.equal(r.body.estado_detalle, detalle);
      assert.ok(!r.texto.includes(KEY), 'sin filtrar la clave');
      assert.ok(!r.texto.includes('cuerpo-secreto'), 'sin filtrar el cuerpo del proveedor');
    }
    assert.ok(!logs.join('\n').includes(KEY));
  });

  it('el 404 de la consulta retira ese modelo (deprecado) y la próxima prueba usa otro', async () => {
    const f = await guardar('groq');
    manejador = (l) => (l.esLista ? listaCompat('openai/gpt-oss-120b', 'qwen/qwen3.8-27b') : l.modelo === 'openai/gpt-oss-120b' ? estado(404) : chatOk('ok'));
    const a = await probar(f.id);
    assert.equal(a.body.estado, 'error');
    assert.equal((await prisma.modeloIA.findUniqueOrThrow({ where: { clave_id_modelo_id: { clave_id: f.id, modelo_id: 'openai/gpt-oss-120b' } } })).estado, 'deprecado');
    // Ojo: el sync de la segunda prueba vuelve a ver el modelo en la lista y lo reactiva; el proveedor es quien manda. Aquí ya no está en la lista.
    manejador = (l) => (l.esLista ? listaCompat('qwen/qwen3.8-27b') : chatOk('ok'));
    const b = await probar(f.id);
    assert.equal(b.body.estado, 'ok');
    assert.equal(b.body.modelo_probado, 'qwen/qwen3.8-27b');
  });

  it('un 400 por un parámetro opcional no es un modelo caído: reintenta sin opcionales y sale ok', async () => {
    const f = await guardar('groq');
    manejador = (l) => (l.esLista ? listaCompat('qwen/qwen3.8-27b') : l.cuerpo.temperature !== undefined ? estado(400) : chatOk('ok'));
    assert.equal((await probar(f.id)).body.estado, 'ok');
    assert.equal(ia.llamadas.filter((l) => !l.esLista).length, 2);
  });

  it('si falla la lista de modelos no hay consulta de chat; una clave rechazada sigue rechazada mientras la prueba no salga bien', async () => {
    const f = await guardar('groq');
    await prisma.claveIntegracion.update({ where: { id: f.id }, data: { estado: 'rechazada', estado_detalle: 'La clave fue rechazada' } });
    manejador = () => estado(401);
    const r = await probar(f.id);
    assert.equal(r.body.estado, 'rechazada');
    assert.equal(ia.llamadas.length, 1, 'sólo se intentó listar');
    manejador = (l) => (l.esLista ? listaCompat('qwen/qwen3.8-27b') : chatOk('ok'));
    assert.equal((await probar(f.id)).body.estado, 'ok', 'una prueba buena la rehabilita');
  });

  it('un modelo fijado en la clave que ya no existe: «Probar» lo suelta, usa otro y la pantalla lo dice', async () => {
    const f = await guardar('groq', KEY, { modelo: 'modelo-retirado' });
    const r = await probar(f.id);
    assert.equal(r.body.estado, 'ok');
    assert.equal(r.body.modelo, null);
    assert.equal(r.body.aviso_modelo, 'El modelo modelo-retirado ya no existe; ahora usa openai/gpt-oss-120b');
    assert.equal(r.body.modelo_probado, 'openai/gpt-oss-120b');
  });

  it('una prueba buena limpia el enfriamiento; una mala no', async () => {
    const f = await guardar('groq');
    registrarEstado(claveCooldown('groq', f.id), 429, 120_000);
    manejador = () => estado(500);
    await probar(f.id);
    assert.equal(estaEnfriando(claveCooldown('groq', f.id)), true);
    manejador = (l) => (l.esLista ? listaCompat('qwen/qwen3.8-27b') : chatOk('ok'));
    await probar(f.id);
    assert.equal(estaEnfriando(claveCooldown('groq', f.id)), false);
  });
});

describe('PATCH /api/llavero/:id (modelo, reserva, pausa)', () => {
  it('fija un modelo ACTIVO de esa clave; uno inexistente → 422; null vuelve a Auto y borra el aviso', async () => {
    const f = await guardar('groq');
    await probar(f.id);
    let r = await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { modelo: 'qwen/qwen3.8-27b' });
    assert.equal(r.status, 200);
    assert.equal(r.body.modelo, 'qwen/qwen3.8-27b');
    r = await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { modelo: 'no-existe' });
    assert.equal(r.status, 422);
    assert.equal(r.body.campos.modelo, 'Ese modelo no está disponible para esta clave');
    await prisma.modeloIA.update({ where: { clave_id_modelo_id: { clave_id: f.id, modelo_id: 'qwen/qwen3.8-27b' } }, data: { estado: 'deprecado' } });
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { modelo: 'qwen/qwen3.8-27b' })).status, 422, 'uno deprecado no se puede fijar');
    await prisma.claveIntegracion.update({ where: { id: f.id }, data: { aviso_modelo: 'El modelo x ya no existe; ahora usa y' } });
    r = await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { modelo: null });
    assert.deepEqual([r.body.modelo, r.body.aviso_modelo], [null, null]);
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { modelo: '' })).body.modelo, null);
    // Habilitar/pausar y reserva siguen funcionando; un cuerpo vacío es 422.
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { habilitada: false })).body.habilitada, false);
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { reserva: true })).body.reserva, true);
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, {})).status, 422);
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { reserva: 'si' })).status, 422);
    assert.equal((await llamar(base, 'PATCH', '/api/llavero/99999', T.super, { reserva: true })).status, 404);
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.adminA, { reserva: true })).status, 403);
    // Queda en la auditoría sin claves.
    const aud = await prisma.auditoria.findMany({ where: { entidad: 'clave-ia' } });
    assert.ok(aud.length >= 3);
    assert.ok(!JSON.stringify(aud).includes(KEY));
  });

  it('sin catálogo todavía (nunca se sincronizó) se acepta cualquier modelo bien formado', async () => {
    const f = await guardar('groq');
    const r = await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { modelo: 'algun/modelo-nuevo' });
    assert.equal(r.status, 200);
    assert.equal(r.body.modelo, 'algun/modelo-nuevo');
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { modelo: 'con espacios' })).status, 422);
  });

  it('con MODELOS_SYNC activo, habilitar una clave dispara la sincronización', async () => {
    const f = await guardar('groq');
    await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { habilitada: false });
    process.env.MODELOS_SYNC = 'on';
    try {
      ia.llamadas.length = 0;
      await llamar(base, 'PATCH', `/api/llavero/${f.id}`, T.super, { habilitada: true });
      const { esperarSincronizaciones } = await import('../src/server/services/modelos/sync');
      await esperarSincronizaciones();
      assert.equal(ia.llamadas.filter((l) => l.esLista).length, 1);
    } finally {
      process.env.MODELOS_SYNC = 'off';
    }
  });
});

describe('sincronizar y modelos por clave', () => {
  it('POST /:id/sincronizar devuelve el resumen; GET /:id/modelos lista los activos agrupables por categoría', async () => {
    const f = await guardar('groq');
    const r = await llamar(base, 'POST', `/api/llavero/${f.id}/sincronizar`, T.super);
    assert.deepEqual(r.body, { ok: true, nuevos: 2, deprecados: 0, revividos: 0, total: 2, error: null, aviso_modelo: null });
    const m = await llamar(base, 'GET', `/api/llavero/${f.id}/modelos`, T.super);
    assert.equal(m.status, 200);
    assert.deepEqual(m.body, [
      { id: 'qwen/qwen3.8-27b', nombre: 'Pantalla qwen/qwen3.8-27b', categoria: 'equilibrado', categoria_nombre: 'Equilibrado', gratis: false },
      { id: 'openai/gpt-oss-120b', nombre: 'Pantalla openai/gpt-oss-120b', categoria: 'razonamiento', categoria_nombre: 'Razonamiento', gratis: false },
    ].sort((a, b) => a.categoria.localeCompare(b.categoria) || a.id.localeCompare(b.id)));
    // Un error del proveedor no deprecia nada y se reporta.
    manejador = () => estado(500);
    const e = await llamar(base, 'POST', `/api/llavero/${f.id}/sincronizar`, T.super);
    assert.deepEqual([e.body.ok, e.body.deprecados, e.body.error], [false, 0, 'El proveedor tuvo un problema, intenta más tarde']);
    assert.equal((await llamar(base, 'GET', `/api/llavero/${f.id}/modelos`, T.super)).body.length, 2);
    assert.equal((await llamar(base, 'POST', '/api/llavero/99999/sincronizar', T.super)).status, 404);
    assert.equal((await llamar(base, 'POST', `/api/llavero/${f.id}/sincronizar`, T.adminA)).status, 403);
    assert.equal((await llamar(base, 'GET', `/api/llavero/${f.id}/modelos`, T.adminA)).status, 403);
  });

  it('GET /api/llavero: modelo en uso, activos/deprecados, última sincronización, cambios recientes y salud', async () => {
    const f = await guardar('groq');
    await llamar(base, 'POST', `/api/llavero/${f.id}/sincronizar`, T.super);
    manejador = (l) => (l.esLista ? listaCompat('openai/gpt-oss-120b', 'llama-nueva-70b') : chatOk('ok'));
    await llamar(base, 'POST', `/api/llavero/${f.id}/sincronizar`, T.super);
    const r = await llamar(base, 'GET', '/api/llavero', T.super);
    const c = r.body.claves[0];
    assert.equal(c.modelo_en_uso, 'openai/gpt-oss-120b');
    assert.equal(c.modelos_activos, 2);
    assert.equal(c.modelos_deprecados, 1);
    assert.match(c.ultima_sync.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual({ ...c.ultima_sync, at: undefined }, { at: undefined, ok: true, nuevos: 1, deprecados: 1, revividos: 0, error: null });
    assert.deepEqual(r.body.cambios_recientes.map((x: { tipo: string; modelo: string }) => [x.tipo, x.modelo]).sort(), [['nuevo', 'llama-nueva-70b'], ['nuevo', 'openai/gpt-oss-120b'], ['nuevo', 'qwen/qwen3.8-27b'], ['retirado', 'qwen/qwen3.8-27b']].sort());
    assert.ok(r.body.cambios_recientes.every((x: Record<string, unknown>) => x.fecha && x.proveedor === 'groq' && x.origen === 'sincronización'));
    assert.deepEqual(Object.keys(r.body.salud).sort(), ['configurada', 'desde', 'motivo', 'ok', 'rutas']);
    assert.equal(r.body.salud.ok, true);
    assert.deepEqual(r.body.consultas_recientes, []);
    assert.ok(!r.texto.includes(KEY) && !r.texto.includes('api_key_enc'));
  });
});
