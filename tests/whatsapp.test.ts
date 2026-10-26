import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';

const BASE_EVO = 'https://evo.pruebas.test';
const CLAVE_EVO = 'evo-CLAVE-FALSA-NO-REAL';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'adminSinEmpresa', string>;

/** Llamadas que hizo la app a la Evolution API (el resto de la red sigue siendo real). */
const aEvolution: { url: string; init: RequestInit }[] = [];
let responderEvo: (url: string) => Response = () => new Response('{}', { status: 200 });
const realFetch = globalThis.fetch;

const envOriginal = { url: process.env.EVOLUTION_URL, key: process.env.EVOLUTION_APIKEY };

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    adminSinEmpresa: await login(base, 'admin.huerfano@test.pe'),
  };
  process.env.EVOLUTION_URL = BASE_EVO;
  process.env.EVOLUTION_APIKEY = CLAVE_EVO;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(BASE_EVO)) return realFetch(input, init);
    aEvolution.push({ url, init: init ?? {} });
    return responderEvo(url);
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  if (envOriginal.url === undefined) delete process.env.EVOLUTION_URL; else process.env.EVOLUTION_URL = envOriginal.url;
  if (envOriginal.key === undefined) delete process.env.EVOLUTION_APIKEY; else process.env.EVOLUTION_APIKEY = envOriginal.key;
  await cerrar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  aEvolution.length = 0;
  responderEvo = () => new Response('{}', { status: 200 });
  await prisma.empresaAdministradora.updateMany({ data: { whatsapp_instance: null, whatsapp_token: null } });
});

const cuerpoDe = (llamada: { init: RequestInit }) => JSON.parse(String(llamada.init.body ?? '{}'));

describe('sincronización de WhatsApp por administradora', () => {
  it('sólo admin y superadmin: sin sesión 401 y un residente 403', async () => {
    assert.equal((await llamar(base, 'GET', '/api/whatsapp/status', null)).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/whatsapp/status', T.prop1)).status, 403);
    assert.equal((await llamar(base, 'POST', '/api/whatsapp/sync', T.prop1, {})).status, 403);
    assert.equal((await llamar(base, 'DELETE', '/api/whatsapp/disconnect', T.prop1)).status, 403);
    assert.equal(aEvolution.length, 0, 'no se llamó a la Evolution API');
  });

  it('un admin sin empresa administradora no puede vincular un número', async () => {
    const r = await llamar(base, 'POST', '/api/whatsapp/sync', T.adminSinEmpresa, {});
    assert.equal(r.status, 400);
    assert.match(r.body.error, /empresa administradora/i);
    assert.equal(aEvolution.length, 0);
  });

  it('sync crea la instancia de SU administradora, guarda el token y devuelve el QR', async () => {
    responderEvo = (url) => (url.endsWith('/instance/create')
      ? new Response('{}', { status: 201 })
      : new Response(JSON.stringify({ base64: 'QR-EN-BASE64', status: 'connecting' }), { status: 200 }));

    const r = await llamar(base, 'POST', '/api/whatsapp/sync', T.adminA, {});
    assert.equal(r.status, 200, r.texto);
    const esperado = `house_empresa_${d.empresaA.id}`;
    assert.equal(r.body.instance, esperado);
    assert.equal(r.body.qr, 'QR-EN-BASE64');
    assert.equal(r.body.status, 'connecting');

    const empresa = await prisma.empresaAdministradora.findUnique({ where: { id: d.empresaA.id } });
    assert.equal(empresa!.whatsapp_instance, esperado, 'la instancia queda en la administradora');
    assert.ok(empresa!.whatsapp_token && empresa!.whatsapp_token.length >= 32, 'el token se genera y se guarda');
    assert.notEqual(empresa!.whatsapp_token, 'HOUSE_TOKEN_SECRET', 'no hay un secreto fijo en el código');

    const urls = aEvolution.map((l) => l.url);
    assert.deepEqual(urls, [`${BASE_EVO}/instance/create`, `${BASE_EVO}/instance/connect/${esperado}`]);
    const creado = aEvolution.find((l) => l.url.endsWith('/instance/create'))!;
    assert.equal(cuerpoDe(creado).instanceName, esperado);
    assert.equal(cuerpoDe(creado).token, empresa!.whatsapp_token);
    assert.equal((creado.init.headers as Record<string, string>).apikey, CLAVE_EVO);
  });

  it('cada administradora tiene SU instancia (nada de instancia global)', async () => {
    responderEvo = () => new Response(JSON.stringify({ base64: 'QR', status: 'connecting' }), { status: 200 });
    await llamar(base, 'POST', '/api/whatsapp/sync', T.adminA, {});
    await llamar(base, 'POST', '/api/whatsapp/sync', T.adminB, {});
    const empresas = await prisma.empresaAdministradora.findMany({ orderBy: { id: 'asc' } });
    const a = empresas.find((e) => e.id === d.empresaA.id)!;
    const b = empresas.find((e) => e.id === d.empresaB.id)!;
    assert.equal(a.whatsapp_instance, `house_empresa_${a.id}`);
    assert.equal(b.whatsapp_instance, `house_empresa_${b.id}`);
    assert.notEqual(a.whatsapp_token, b.whatsapp_token, 'cada instancia tiene su propio token');
    assert.equal(aEvolution.filter((l) => l.url.endsWith('/instance/create')).length, 2);
  });

  it('sync no vuelve a crear la instancia si ya está vinculada', async () => {
    responderEvo = () => new Response(JSON.stringify({ base64: 'QR', status: 'connecting' }), { status: 200 });
    await llamar(base, 'POST', '/api/whatsapp/sync', T.adminA, {});
    aEvolution.length = 0;
    const r = await llamar(base, 'POST', '/api/whatsapp/sync', T.adminA, {});
    assert.equal(r.status, 200);
    assert.equal(aEvolution.filter((l) => l.url.endsWith('/instance/create')).length, 0, 'no crea otra');
    assert.equal(aEvolution.filter((l) => l.url.includes('/instance/connect/')).length, 1, 'sólo pide el QR');
  });

  it('si la instancia ya existe en Evolution, se sigue y queda vinculada', async () => {
    responderEvo = (url) => (url.endsWith('/instance/create')
      ? new Response(JSON.stringify({ message: 'instance already exists' }), { status: 409 })
      : new Response(JSON.stringify({ base64: 'QR', status: 'connecting' }), { status: 200 }));
    const r = await llamar(base, 'POST', '/api/whatsapp/sync', T.adminA, {});
    assert.equal(r.status, 200, r.texto);
    const empresa = await prisma.empresaAdministradora.findUnique({ where: { id: d.empresaA.id } });
    assert.equal(empresa!.whatsapp_instance, `house_empresa_${d.empresaA.id}`);
  });

  it('status: sin instancia no está vinculado; con instancia, refleja el estado de Evolution', async () => {
    const sin = await llamar(base, 'GET', '/api/whatsapp/status', T.adminA);
    assert.equal(sin.status, 200);
    assert.deepEqual(sin.body, { connected: false, status: 'not_linked', instance: null });

    responderEvo = () => new Response(JSON.stringify({ status: 'open' }), { status: 200 });
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'instancia-de-a' } });
    const abierto = await llamar(base, 'GET', '/api/whatsapp/status', T.adminA);
    assert.deepEqual(abierto.body, { connected: true, status: 'open', instance: 'instancia-de-a' });

    responderEvo = () => new Response(JSON.stringify({ status: 'closed' }), { status: 200 });
    const cerrado = await llamar(base, 'GET', '/api/whatsapp/status', T.adminA);
    assert.deepEqual(cerrado.body, { connected: false, status: 'closed', instance: 'instancia-de-a' });
  });

  it('disconnect: cierra la sesión en Evolution y desvincula la administradora', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'instancia-de-a', whatsapp_token: 'tok' } });
    responderEvo = () => new Response('{}', { status: 200 });
    const r = await llamar(base, 'DELETE', '/api/whatsapp/disconnect', T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.ok(aEvolution.some((l) => l.url === `${BASE_EVO}/instance/logout/instancia-de-a`), 'cierra la sesión');
    const empresa = await prisma.empresaAdministradora.findUnique({ where: { id: d.empresaA.id } });
    assert.equal(empresa!.whatsapp_instance, null);
    assert.equal(empresa!.whatsapp_token, null);
  });

  it('disconnect sin instancia vinculada: 404', async () => {
    const r = await llamar(base, 'DELETE', '/api/whatsapp/disconnect', T.adminA);
    assert.equal(r.status, 404);
  });

  it('sin Evolution API configurada: 503 y no se intenta nada', async () => {
    delete process.env.EVOLUTION_URL;
    const r = await llamar(base, 'POST', '/api/whatsapp/sync', T.adminA, {});
    assert.equal(r.status, 503);
    assert.match(r.body.error, /Evolution API/i);
    assert.equal(aEvolution.length, 0);
    process.env.EVOLUTION_URL = BASE_EVO;
  });
});

describe('interfaz: WhatsApp y usuarios del sistema', () => {
  it('la página de WhatsApp pide la API con `api()` (cookie + CSRF), no con fetch suelto', () => {
    const fuente = readFileSync('src/pages/admin/WhatsappSync.tsx', 'utf8');
    assert.match(fuente, /from '\.\.\/\.\.\/api'/, 'usa el helper de la app');
    assert.ok(!/\bfetch\(/.test(fuente), 'no hay un fetch sin credenciales ni CSRF');
    for (const ruta of ['/api/whatsapp/status', '/api/whatsapp/sync', '/api/whatsapp/disconnect']) {
      assert.match(fuente, new RegExp(`api(?:<[^>]+>)?\\('${ruta}'`), `llama a ${ruta} con api()`);
    }
    assert.match(fuente, /method: 'POST'/, 'la sincronización es POST');
    assert.match(fuente, /method: 'DELETE'/, 'la desvinculación es DELETE');
  });

  it('«Usuarios del sistema» muestra sólo superadmins (ni residentes ni personal)', () => {
    const fuente = readFileSync('src/pages/superadmin/Usuarios.tsx', 'utf8');
    assert.match(fuente, /tipo="superadmin"/, 'la lista es de superadmins');
    assert.ok(!/Tabs/.test(fuente), 'sin pestañas de residentes ni personal');
    assert.ok(!/tipo="residente"|tipo="personal"/.test(fuente));
    const nav = readFileSync('src/app/nav.ts', 'utf8');
    assert.match(nav, /label: 'Usuarios del sistema'/);
  });

  it('al quitar el departamento de un residente se manda unidad_id: null', () => {
    const fuente = readFileSync('src/pages/admin/_parts/personas/PersonasLista.tsx', 'utf8');
    assert.match(fuente, /body\.unidad_id = null/, 'el backend suelta la unidad anterior');
    assert.match(fuente, /body\.unidad_id = hit\.id/, 'al elegir otra unidad se manda la nueva');
  });
});
