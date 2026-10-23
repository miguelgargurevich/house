import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { esperar, iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { aadClave, cifrar, descifrar } from '../src/server/lib/secretBox';
import { llaveroDeps, obtenerClaveParaUso } from '../src/server/services/llavero';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const KEY = 'sk-prueba-0000-AAAA';
const KEY2 = 'sk-prueba-0000-BBBB';

let base: string;
let cerrar: () => Promise<void>;
let T: { super: string; adminA: string; prop1: string };

type Llamada = { url: string; init: RequestInit };
let llamadas: Llamada[] = [];
let respuestaFalsa: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response('{}', { status: 200 });
const fetchOriginal = llaveroDeps.fetch;
const cabecera = (l: Llamada, nombre: string) => (l.init.headers as Record<string, string>)[nombre];

// Espía de consola: nada de lo que se loguea puede contener una clave.
const logs: string[] = [];
const consolaOriginal = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function espiar() {
  for (const k of ['log', 'warn', 'error', 'info'] as const) {
    console[k] = (...a: unknown[]) => {
      logs.push(a.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    };
  }
}
const restaurarConsola = () => { Object.assign(console, consolaOriginal); };

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  llaveroDeps.fetch = async (url, init = {}) => {
    llamadas.push({ url, init });
    return respuestaFalsa(url, init);
  };
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  delete process.env.LLAVERO_ENC_KEY;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.GEMINI_API_KEY;
  await prisma.claveIntegracion.deleteMany();
  await prisma.auditoria.deleteMany();
  llamadas = [];
  logs.length = 0;
  respuestaFalsa = () => new Response('{}', { status: 200 });
  espiar();
});
afterEach(restaurarConsola);

const guardar = (proveedor: string, clave = KEY, extra: Record<string, unknown> = {}, token = T.super) =>
  llamar(base, 'PUT', `/api/llavero/${proveedor}`, token, { clave, ...extra });

describe('acceso', () => {
  it('sin token → 401; admin y propietario → 403 en todas las rutas; superadmin → 200', async () => {
    const creada = await guardar('openai');
    assert.equal(creada.status, 201);
    const id = creada.body.id;
    const rutas: [string, string, unknown?][] = [
      ['GET', '/api/llavero'],
      ['PUT', '/api/llavero/openai', { clave: KEY2 }],
      ['POST', `/api/llavero/${id}/probar`],
      ['PATCH', `/api/llavero/${id}`, { habilitada: false }],
      ['DELETE', `/api/llavero/${id}`],
    ];
    for (const [m, ruta, cuerpo] of rutas) {
      assert.equal((await llamar(base, m, ruta, null, cuerpo)).status, 401, `${m} ${ruta} sin token`);
      assert.equal((await llamar(base, m, ruta, T.adminA, cuerpo)).status, 403, `${m} ${ruta} admin`);
      assert.equal((await llamar(base, m, ruta, T.prop1, cuerpo)).status, 403, `${m} ${ruta} propietario`);
    }
    const ok = await llamar(base, 'GET', '/api/llavero', T.super);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.configurado, true);
    assert.equal(ok.body.claves.length, 1, 'el admin no pudo borrar nada');
    assert.equal(ok.body.claves[0].habilitada, true);
    assert.equal(ok.body.claves[0].ultimos4, KEY.slice(-4), 'el admin no pudo reemplazar la clave');
    assert.deepEqual(ok.body.proveedores.map((p: { id: string }) => p.id).sort(), ['deepseek', 'gemini', 'groq', 'mistral', 'openai', 'openrouter']);
    assert.ok(ok.body.proveedores.every((p: Record<string, unknown>) => p.nombre && p.descripcion && p.urlParaConseguirKey && p.modeloPorDefecto && !('baseUrl' in p)));
  });
});

describe('sin LLAVERO_ENC_KEY', () => {
  it('responde 503, no guarda nada y la app sigue respondiendo', async () => {
    for (const valor of [undefined, 'corta']) {
      if (valor === undefined) delete process.env.LLAVERO_ENC_KEY;
      else process.env.LLAVERO_ENC_KEY = valor;
      const r = await guardar('openai');
      assert.equal(r.status, 503);
      assert.equal(r.body.error, 'El llavero no está configurado en el servidor');
      assert.equal(await prisma.claveIntegracion.count(), 0);
      const lista = await llamar(base, 'GET', '/api/llavero', T.super);
      assert.equal(lista.status, 200);
      assert.equal(lista.body.configurado, false);
      assert.equal((await llamar(base, 'GET', '/api/health')).status, 200);
    }
  });
});

describe('la clave nunca sale', () => {
  it('no aparece en respuestas, auditoría ni logs; en la base va cifrada con v2:', async () => {
    const textos: string[] = [];
    const reg = <R extends { texto: string }>(r: R) => { textos.push(r.texto); return r; };
    const creada = reg(await guardar('openai', KEY, { modelo: 'gpt-4o-mini' }));
    const id = JSON.parse(creada.texto).id;
    respuestaFalsa = () => new Response(JSON.stringify({ eco: KEY }), { status: 401 });
    reg(await llamar(base, 'POST', `/api/llavero/${id}/probar`, T.super));
    reg(await guardar('openai', KEY2));
    reg(await llamar(base, 'PATCH', `/api/llavero/${id}`, T.super, { habilitada: false }));
    reg(await llamar(base, 'GET', '/api/llavero', T.super));
    reg(await guardar('groq', 'corta'));
    reg(await guardar('groq', 'con espacios dentro'));

    const fila = await prisma.claveIntegracion.findFirstOrThrow({ where: { proveedor: 'openai' } });
    assert.ok(fila.api_key_enc.startsWith('v2:'));
    assert.equal(fila.api_key_enc.includes(KEY2), false);
    assert.equal(Buffer.from(fila.api_key_enc.slice(3), 'base64').toString('latin1').includes(KEY2), false);
    assert.equal(fila.ultimos4, KEY2.slice(-4));

    const aud = await esperar(async () => {
      const f = await prisma.auditoria.findMany({ where: { entidad: 'clave-ia' } });
      return f.length >= 4 ? f : null;
    });
    reg(await llamar(base, 'GET', '/api/auditoria?pageSize=100', T.super));
    for (const a of aud) assert.equal(JSON.stringify(a).includes('sk-prueba'), false);
    for (const t of textos) assert.equal(t.includes('sk-prueba'), false);
    // Tampoco sale la clave cifrada: ni el campo ni un valor con el prefijo del cifrado.
    for (const t of textos) {
      assert.equal(t.includes('api_key_enc'), false, 'la respuesta expone api_key_enc');
      assert.equal(t.includes('v2:'), false, 'la respuesta expone un valor cifrado');
    }
    assert.equal(logs.some((l) => l.includes('sk-prueba')), false, 'hay una clave en los logs');
  });

  it('la auditoría registra crear/editar/eliminar con entidad clave-ia y sin la clave', async () => {
    const c = await guardar('groq');
    await guardar('groq', KEY2);
    await llamar(base, 'DELETE', `/api/llavero/${c.body.id}`, T.super);
    const aud = await esperar(async () => {
      const f = await prisma.auditoria.findMany({ where: { entidad: 'clave-ia' }, orderBy: { id: 'asc' } });
      return f.length === 3 ? f : null;
    });
    assert.deepEqual(aud.map((a) => a.accion), ['crear', 'editar', 'eliminar']);
    assert.ok(aud.every((a) => a.entidad_id === c.body.id));
    assert.equal((aud[0].detalle as { proveedor: string }).proveedor, 'groq');
  });

  it('el auditor genérico redacta cualquier campo llamado clave/key/token/password', async () => {
    const r = await llamar(base, 'POST', '/api/conceptos', T.adminA, { nombre: 'Prueba', tipo_monto: 'fijo', clave: KEY, api_key: KEY, token: KEY, password: KEY });
    assert.equal(r.status, 201, r.texto);
    const a = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'crear' } }));
    const d = a.detalle as Record<string, unknown>;
    for (const k of ['clave', 'api_key', 'token', 'password']) assert.equal(d[k], '[omitido]', k);
    assert.equal(JSON.stringify(d).includes(KEY), false);
  });
});

describe('cifrado', () => {
  it('descifrar un valor copiado a otro proveedor/etiqueta falla (AAD)', async () => {
    await guardar('gemini');
    await guardar('groq', KEY2);
    const g = await prisma.claveIntegracion.findFirstOrThrow({ where: { proveedor: 'gemini' } });
    assert.equal(descifrar(g.api_key_enc, aadClave('gemini', 'principal')), KEY);
    assert.throws(() => descifrar(g.api_key_enc, aadClave('groq', 'principal')));
    assert.throws(() => descifrar(g.api_key_enc, aadClave('gemini', 'otra')));
    await prisma.claveIntegracion.updateMany({ where: { proveedor: 'groq' }, data: { api_key_enc: g.api_key_enc } });
    assert.equal(await obtenerClaveParaUso('groq'), null);
    assert.equal((await obtenerClaveParaUso('gemini'))?.clave, KEY);
  });

  it('formato v2 con IV aleatorio; otra clave maestra no descifra; la AAD es obligatoria', () => {
    const a = cifrar('secreto-de-prueba', 'x:1');
    const b = cifrar('secreto-de-prueba', 'x:1');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('v2:'));
    assert.throws(() => descifrar(a, 'x:1', { ...process.env, LLAVERO_ENC_KEY: 'otra-clave-maestra-distinta-de-mas-de-32-caracteres' }));
    assert.throws(() => cifrar('x', ''), /AAD/);
  });
});

describe('guardar', () => {
  it('201 nueva / 200 reemplazo; el reemplazo vuelve a sin_probar', async () => {
    const a = await guardar('mistral');
    assert.equal(a.status, 201);
    assert.equal(a.body.ultimos4, KEY.slice(-4));
    assert.equal(a.body.estado, 'sin_probar');
    await llamar(base, 'POST', `/api/llavero/${a.body.id}/probar`, T.super);
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: a.body.id } })).estado, 'ok');
    const b = await guardar('mistral', KEY2, { modelo: 'mistral-large-latest' });
    assert.equal(b.status, 200);
    assert.equal(b.body.id, a.body.id);
    assert.equal(b.body.estado, 'sin_probar');
    assert.equal(b.body.probada_at, null);
    assert.equal(b.body.modelo, 'mistral-large-latest');
    assert.equal(await prisma.claveIntegracion.count(), 1);
  });

  it('valida la clave: 8–400 caracteres, sin espacios; proveedor desconocido → 404', async () => {
    assert.equal((await guardar('openai', '1234567')).status, 422);
    assert.equal((await guardar('openai', 'a'.repeat(401))).status, 422);
    assert.equal((await guardar('openai', 'abcd efgh1')).status, 422);
    assert.equal((await guardar('openai', 'abcdefgh\n12')).status, 422);
    assert.equal((await llamar(base, 'PUT', '/api/llavero/openai', T.super, {})).status, 422);
    assert.equal((await guardar('openai', KEY, { etiqueta: 'con espacio' })).status, 422);
    assert.equal(await prisma.claveIntegracion.count(), 0);
    assert.equal((await guardar('openai', 'a'.repeat(400))).status, 201);
    assert.equal((await guardar('no-existe')).status, 404);
    assert.equal(await prisma.claveIntegracion.count(), 1);
  });
});

describe('probar', () => {
  it('ok: llama a /models de la URL fija con la cabecera correcta y sin seguir redirecciones', async () => {
    const g = await guardar('gemini');
    const o = await guardar('openai', KEY2);
    const rg = await llamar(base, 'POST', `/api/llavero/${g.body.id}/probar`, T.super);
    assert.equal(rg.status, 200);
    assert.equal(rg.body.estado, 'ok');
    assert.ok(rg.body.probada_at);
    await llamar(base, 'POST', `/api/llavero/${o.body.id}/probar`, T.super);
    assert.equal(llamadas[0].url, 'https://generativelanguage.googleapis.com/v1beta/models');
    assert.equal(cabecera(llamadas[0], 'x-goog-api-key'), KEY);
    assert.equal(llamadas[0].init.method, 'GET');
    assert.equal(llamadas[0].init.redirect, 'manual');
    assert.ok(llamadas[0].init.signal);
    assert.equal(llamadas[1].url, 'https://api.openai.com/v1/models');
    assert.equal(cabecera(llamadas[1], 'Authorization'), `Bearer ${KEY2}`);
  });

  it('error: 401/403, 429, redirección, 500, timeout y red; el detalle no filtra la clave ni el cuerpo', async () => {
    const f = await guardar('groq');
    const probar = () => llamar(base, 'POST', `/api/llavero/${f.body.id}/probar`, T.super);
    const casos: [() => Response, string][] = [
      [() => new Response(`{"error":"${KEY} no vale"}`, { status: 401 }), 'La clave fue rechazada o no es válida'],
      [() => new Response('x', { status: 403 }), 'La clave fue rechazada o no es válida'],
      [() => new Response('x', { status: 400 }), 'La clave fue rechazada o no es válida'],
      [() => new Response('x', { status: 429 }), 'Límite del proveedor'],
      [() => new Response('x', { status: 302, headers: { location: 'http://169.254.169.254/' } }), 'El proveedor respondió con una redirección'],
      [() => new Response('boom', { status: 500 }), 'El proveedor tuvo un problema, intenta más tarde'],
      [() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, 'El proveedor no respondió a tiempo'],
      [() => { throw new Error(`fallo de red con ${KEY}`); }, 'No se pudo conectar con el proveedor'],
    ];
    for (const [resp, detalle] of casos) {
      respuestaFalsa = resp;
      const r = await probar();
      assert.equal(r.status, 200);
      assert.equal(r.body.estado, 'error');
      assert.equal(r.body.estado_detalle, detalle);
      assert.equal(r.texto.includes(KEY), false);
    }
    const guardada = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: f.body.id } });
    assert.equal(guardada.estado, 'error');
    assert.ok(guardada.probada_at);
    assert.equal(logs.some((l) => l.includes(KEY)), false);
    assert.equal((await llamar(base, 'POST', '/api/llavero/99999/probar', T.super)).status, 404);
  });
});

describe('pausar y borrar', () => {
  it('pausar excluye la clave del uso; habilitar la devuelve y marca ultimo_uso_at', async () => {
    const c = await guardar('deepseek');
    assert.equal((await obtenerClaveParaUso('deepseek'))?.clave, KEY);
    assert.ok((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: c.body.id } })).ultimo_uso_at);
    const p = await llamar(base, 'PATCH', `/api/llavero/${c.body.id}`, T.super, { habilitada: false });
    assert.equal(p.status, 200);
    assert.equal(p.body.habilitada, false);
    assert.equal(await obtenerClaveParaUso('deepseek'), null);
    await llamar(base, 'PATCH', `/api/llavero/${c.body.id}`, T.super, { habilitada: true });
    assert.equal((await obtenerClaveParaUso('deepseek'))?.clave, KEY);
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/${c.body.id}`, T.super, { habilitada: 'si' })).status, 422);
  });

  it('borrar: 204, desaparece de la lista y de la base; otro id → 404', async () => {
    const c = await guardar('openrouter');
    assert.equal((await llamar(base, 'DELETE', `/api/llavero/${c.body.id}`, T.super)).status, 204);
    assert.equal((await llamar(base, 'GET', '/api/llavero', T.super)).body.claves.length, 0);
    assert.equal(await prisma.claveIntegracion.count(), 0);
    assert.equal(await obtenerClaveParaUso('openrouter'), null);
    assert.equal((await llamar(base, 'DELETE', `/api/llavero/${c.body.id}`, T.super)).status, 404);
  });
});

describe('asistente IA', () => {
  const chat = () => llamar(base, 'POST', '/api/ai-chat', T.adminA, { message: 'Hola' });
  const geminiOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Respuesta de Gemini' }] } }] }), { status: 200 });
  const openaiOk = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Respuesta compatible' } }] }), { status: 200 });

  it('elige por prioridad, respeta pausadas y cae a GEMINI_API_KEY', async () => {
    respuestaFalsa = (url) => (url.includes('generativelanguage') ? geminiOk() : openaiOk());
    const gem = await guardar('gemini', 'gemini-prueba-0001');
    await guardar('openai', 'openai-prueba-0002', { modelo: 'gpt-4o' });
    const groq = await guardar('groq', 'groq-prueba-00003');

    let r = await chat();
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { response: 'Respuesta de Gemini' });
    assert.equal(llamadas.at(-1)!.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
    assert.equal(cabecera(llamadas.at(-1)!, 'x-goog-api-key'), 'gemini-prueba-0001');

    await llamar(base, 'PATCH', `/api/llavero/${gem.body.id}`, T.super, { habilitada: false });
    r = await chat();
    assert.deepEqual(r.body, { response: 'Respuesta compatible' });
    assert.equal(llamadas.at(-1)!.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(cabecera(llamadas.at(-1)!, 'Authorization'), 'Bearer groq-prueba-00003');
    const cuerpo = JSON.parse(llamadas.at(-1)!.init.body as string);
    assert.equal(cuerpo.model, 'llama-3.3-70b-versatile');
    assert.ok(cuerpo.messages[0].content.includes('MENSAJE DEL USUARIO:\nHola'));

    await llamar(base, 'PATCH', `/api/llavero/${groq.body.id}`, T.super, { habilitada: false });
    await chat();
    assert.equal(llamadas.at(-1)!.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(JSON.parse(llamadas.at(-1)!.init.body as string).model, 'gpt-4o', 'usa el modelo de la fila');

    await prisma.claveIntegracion.deleteMany();
    process.env.GEMINI_API_KEY = 'gemini-entorno-0004';
    r = await chat();
    assert.deepEqual(r.body, { response: 'Respuesta de Gemini' });
    assert.equal(cabecera(llamadas.at(-1)!, 'x-goog-api-key'), 'gemini-entorno-0004');
  });

  it('sin proveedor: el error de siempre; si el elegido falla no prueba otro', async () => {
    let r = await chat();
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: { code: 500, message: 'La IA no está configurada en el servidor. Contacta al administrador.' } });
    assert.equal(llamadas.length, 0);

    await guardar('gemini', 'gemini-prueba-0001');
    await guardar('groq', 'groq-prueba-00003');
    respuestaFalsa = () => new Response('{}', { status: 500 });
    r = await chat();
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: { code: 503, message: 'El servicio de IA no pudo responder. Intenta de nuevo más tarde.' } });
    assert.equal(llamadas.length, 1, 'no se reintentó con otro proveedor');
    respuestaFalsa = () => new Response('{}', { status: 429 });
    assert.equal((await chat()).status, 429);
  });
});

describe('límite', () => {
  it('las escrituras y pruebas tienen tope por usuario; la lectura no', async () => {
    const s = await iniciar({ rateLimits: { api: 100_000, login: 100_000, llavero: 2 } });
    try {
      const t = await login(s.base, 'super@test.pe');
      const put = () => llamar(s.base, 'PUT', '/api/llavero/openai', t, { clave: KEY });
      assert.notEqual((await put()).status, 429);
      assert.notEqual((await put()).status, 429);
      assert.equal((await put()).status, 429);
      assert.equal((await llamar(s.base, 'GET', '/api/llavero', t)).status, 200);
    } finally {
      await s.cerrar();
    }
  });
});
