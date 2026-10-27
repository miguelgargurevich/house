// Gateways propios en el Llavero: registro (sólo superadmin, auditado), lista permitida de dominios en la base, barrera de red en CADA llamada,
// OCR en la base, migraciones. Fetch y DNS SIEMPRE inyectados: nunca hay red ni resolución real.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { esperar, iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { DOMINIO_DASHBOARDIA, IP_PUBLICA, URL_DASHBOARDIA, dnsFalso, limpiarGateways, restaurarDns } from './helpers/gateways';
import { limpiarTodo } from '../src/server/lib/cooldown';
import { GatewayError } from '../src/server/lib/gateways';
import { ocrParaUso, migrarOcrDesdeEnv } from '../src/server/lib/gatewaysDatos';
import { guardarOcr } from '../src/server/lib/gatewaysAdmin';
import { migrarDashboardia } from '../src/server/lib/gatewaysMigracion';
import { aadClave, cifrar, descifrar } from '../src/server/lib/secretBox';
import { consultaMinima } from '../src/server/services/asistente/proveedor';
import { sincronizarClave } from '../src/server/services/modelos/sync';
import { fetchProveedor, guardar as guardarClave, llaveroDeps } from '../src/server/services/llavero';
import { extraerTexto, ocrDeps } from '../src/server/services/ocrVoucher';
import { construirCadena, olvidarTodoUso } from '../src/server/services/rotacion';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const KEY = 'sk-gateway-0000-AAAA';
const KEY2 = 'sk-gateway-0000-BBBB';
const KEY_OCR = 'ocr-clave-0000-ZZZZ';

let base: string;
let cerrar: () => Promise<void>;
let T: { super: string; adminA: string; prop1: string };
let superId: number;

type Llamada = { url: string; init: RequestInit & { destino?: { host: string; ip: string; family: number } } };
let llamadas: Llamada[] = [];
const todoOk = () => new Response(JSON.stringify({ data: [{ id: 'qwen3-vl-flash' }, { id: 'm-texto' }], choices: [{ message: { content: 'ok' } }] }), { status: 200 });
let respuesta: (url: string, init: Llamada['init']) => Response | Promise<Response> = todoOk;
const fetchOriginal = llaveroDeps.fetch;
const ocrOriginal = { ...ocrDeps };

const logs: string[] = [];
const consolaOriginal = { log: console.log, warn: console.warn, error: console.error, info: console.info };
const espiar = () => { for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }; };

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  superId = (await prisma.usuario.findFirstOrThrow({ where: { email: 'super@test.pe' } })).id;
  llaveroDeps.fetch = async (url, init = {}) => { llamadas.push({ url, init }); return respuesta(url, init); };
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  Object.assign(ocrDeps, ocrOriginal);
  restaurarDns();
  delete process.env.LLAVERO_ENC_KEY;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.GEMINI_API_KEY;
  await limpiarGateways();
  await prisma.auditoria.deleteMany();
  limpiarTodo();
  olvidarTodoUso();
  llamadas = [];
  logs.length = 0;
  respuesta = todoOk;
  Object.assign(ocrDeps, ocrOriginal);
  dnsFalso();
  espiar();
});
afterEach(() => { Object.assign(console, consolaOriginal); });

// ---------- Atajos ----------
const dominio = (d: string, token: string | null = T.super) => llamar(base, 'POST', '/api/llavero/dominios', token, { dominio: d });
const crearGw = (cuerpo: Record<string, unknown> = {}, token: string | null = T.super) => llamar(base, 'POST', '/api/llavero/gateways', token, { nombre: 'Dashboard IA', base_url: URL_DASHBOARDIA, modelo_por_defecto: 'qwen3-vl-flash', vision: true, prioridad: 2, ...cuerpo });
const claveGw = (gatewayId: number, clave = KEY, extra: Record<string, unknown> = {}, token: string | null = T.super) => llamar(base, 'PUT', '/api/llavero/gateway', token, { gateway_id: gatewayId, clave, ...extra });
/** Dominio permitido + gateway «Dashboard IA» + una clave: lo normal. */
async function gatewayConClave() {
  assert.equal((await dominio(DOMINIO_DASHBOARDIA)).status, 201);
  const g = await crearGw();
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const c = await claveGw(g.body.id);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  return { gateway: g.body as { id: number }, clave: c.body as { id: number } };
}
const eslabonDeGateway = async () => {
  const e = (await construirCadena()).find((x) => x.proveedor.gatewayId !== undefined);
  assert.ok(e, 'el gateway debía estar en la cadena de rotación');
  return e;
};
const auditoriaDe = (entidad: string) => esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad } }); return f.length > 0 ? f : null; });
const sinClaves = (texto: string) => { for (const k of [KEY, KEY2, KEY_OCR, 'clave-ocr-env']) assert.ok(!texto.includes(k), 'una clave se filtró'); };

// =====================================================================================================
describe('acceso: sólo el superadmin', () => {
  it('sin token → 401; admin y propietario → 403 en TODAS las rutas nuevas, y no cambia nada', async () => {
    const rutas: [string, string, unknown?][] = [
      ['POST', '/api/llavero/dominios', { dominio: DOMINIO_DASHBOARDIA }],
      ['DELETE', '/api/llavero/dominios/1'],
      ['POST', '/api/llavero/gateways', { nombre: 'X', base_url: URL_DASHBOARDIA }],
      ['PATCH', '/api/llavero/gateways/1', { habilitado: false }],
      ['DELETE', '/api/llavero/gateways/1'],
      ['PUT', '/api/llavero/gateway', { gateway_id: 1, clave: KEY }],
      ['PUT', '/api/llavero/ocr', { modo: 'interno' }],
      ['PATCH', '/api/llavero/ocr', { habilitado: false }],
      ['DELETE', '/api/llavero/ocr'],
      ['GET', '/api/llavero'],
    ];
    for (const [m, ruta, cuerpo] of rutas) {
      assert.equal((await llamar(base, m, ruta, null, cuerpo)).status, 401, `${m} ${ruta} sin token`);
      assert.equal((await llamar(base, m, ruta, T.adminA, cuerpo)).status, 403, `${m} ${ruta} admin`);
      assert.equal((await llamar(base, m, ruta, T.prop1, cuerpo)).status, 403, `${m} ${ruta} propietario`);
    }
    assert.deepEqual(
      [await prisma.dominioGatewayPermitido.count(), await prisma.gatewayIA.count(), await prisma.configuracionOcr.count(), await prisma.claveIntegracion.count()],
      [0, 0, 0, 0],
    );
  });

  it('un admin tampoco puede borrar lo que el superadmin registró', async () => {
    const { gateway } = await gatewayConClave();
    const dom = await prisma.dominioGatewayPermitido.findFirstOrThrow();
    assert.equal((await llamar(base, 'DELETE', `/api/llavero/gateways/${gateway.id}`, T.adminA)).status, 403);
    assert.equal((await llamar(base, 'DELETE', `/api/llavero/dominios/${dom.id}`, T.adminA)).status, 403);
    assert.equal(await prisma.gatewayIA.count(), 1);
    assert.equal(await prisma.dominioGatewayPermitido.count(), 1);
  });
});

describe('lista de dominios permitidos (en la base, auditada)', () => {
  it('agrega, normaliza, rechaza duplicados y basura, y quita; todo auditado', async () => {
    const r = await dominio('  API.Dashboardia.Gargurevich.DEV ');
    assert.equal(r.status, 201);
    assert.equal(r.body.dominio, DOMINIO_DASHBOARDIA);
    assert.equal((await dominio(DOMINIO_DASHBOARDIA)).status, 409);
    for (const malo of ['1.2.3.4', 'https://api.ejemplo.dev', 'api.ejemplo.dev/v1', '*.ejemplo.dev', 'localhost', '']) {
      const x = await dominio(malo);
      assert.equal(x.status, 422, `«${malo}»`);
      assert.ok(x.body.campos?.dominio || x.body.campos?._ || x.body.campos, `«${malo}» dice qué campo falló`);
    }
    assert.equal(await prisma.dominioGatewayPermitido.count(), 1);
    assert.equal((await llamar(base, 'DELETE', `/api/llavero/dominios/${r.body.id}`, T.super)).status, 204);
    assert.equal((await llamar(base, 'DELETE', `/api/llavero/dominios/${r.body.id}`, T.super)).status, 404);
    const filas = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'dominio-gateway' }, orderBy: { id: 'asc' } }); return f.length >= 2 ? f : null; });
    assert.deepEqual(filas.map((f) => f.accion), ['crear', 'eliminar']);
    assert.deepEqual(filas.map((f) => (f.detalle as { dominio: string }).dominio), [DOMINIO_DASHBOARDIA, DOMINIO_DASHBOARDIA]);
    assert.equal(filas[0]!.usuario_id, superId);
  });

  it('GET /api/llavero la devuelve', async () => {
    await dominio(DOMINIO_DASHBOARDIA);
    const r = await llamar(base, 'GET', '/api/llavero', T.super);
    assert.deepEqual(r.body.dominios_permitidos.map((d: { dominio: string }) => d.dominio), [DOMINIO_DASHBOARDIA]);
  });
});

describe('registrar un gateway: las barreras al guardar (y nada sale a la red)', () => {
  it('dominio permitido + https + 443 → se crea; sale con dominio, estado ok y sin claves; auditado sin llaves', async () => {
    await dominio(DOMINIO_DASHBOARDIA);
    const r = await crearGw({ base_url: `https://${DOMINIO_DASHBOARDIA}:443/v1/`, modelo_vision: 'qwen3-vl-flash' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.nombre, r.body.base_url, r.body.dominio, r.body.vision, r.body.estado, r.body.claves, r.body.prioridad], ['Dashboard IA', URL_DASHBOARDIA, DOMINIO_DASHBOARDIA, true, 'ok', 0, 2]);
    assert.equal((await crearGw({ nombre: 'Sin prioridad', prioridad: undefined })).body.prioridad, 20, 'por omisión va detrás del catálogo');
    const filas = await auditoriaDe('gateway-ia');
    assert.equal(filas[0]!.accion, 'crear');
    assert.equal(llamadas.length, 0, 'registrar no llama a nadie');
  });

  const MALAS: [string, string, RegExp][] = [
    ['http', `http://${DOMINIO_DASHBOARDIA}/v1`, /https/],
    ['IP literal v4', 'https://93.184.216.34/v1', /dirección IP/],
    ['IP literal v6', 'https://[2606:4700:4700::1111]/v1', /dirección IP/],
    ['loopback', 'https://127.0.0.1/v1', /dirección IP/],
    ['metadata de la nube', 'https://169.254.169.254/latest/meta-data', /dirección IP/],
    ['puerto raro', `https://${DOMINIO_DASHBOARDIA}:8443/v1`, /443/],
    ['credenciales en la URL', `https://usuario:clave@${DOMINIO_DASHBOARDIA}/v1`, /usuario ni contraseña/],
    ['dominio fuera de la lista', 'https://otro.ejemplo.dev/v1', /lista de dominios permitidos/],
    ['subdominio de uno permitido', `https://sub.${DOMINIO_DASHBOARDIA}/v1`, /lista de dominios permitidos/],
    ['con parámetros', `${URL_DASHBOARDIA}?token=1`, /parámetros/],
  ];
  for (const [nombre, url, mensaje] of MALAS) {
    it(`${nombre} → 422 con un mensaje claro, no se crea nada y no hay llamadas`, async () => {
      await dominio(DOMINIO_DASHBOARDIA);
      const r = await crearGw({ base_url: url });
      assert.equal(r.status, 422, JSON.stringify(r.body));
      assert.match(r.body.campos.base_url, mensaje);
      assert.equal(await prisma.gatewayIA.count(), 0);
      assert.equal(llamadas.length, 0);
    });
  }

  it('el nombre no se repite (sin distinguir mayúsculas) y los datos pasan por zod', async () => {
    await dominio(DOMINIO_DASHBOARDIA);
    assert.equal((await crearGw()).status, 201);
    const dup = await crearGw({ nombre: 'dashboard ia' });
    assert.equal(dup.status, 422);
    assert.ok(dup.body.campos.nombre);
    assert.equal((await crearGw({ nombre: '' })).status, 422);
    assert.equal((await crearGw({ nombre: 'Otro', prioridad: 0 })).status, 422);
    assert.equal((await crearGw({ nombre: 'Otro', modelo_vision: 'mod elo raro!' })).status, 422);
    assert.equal(await prisma.gatewayIA.count(), 1);
  });
});

describe('claves de un gateway: mismo cifrado, probar y modelos que las demás', () => {
  it('se guarda cifrada (v2:, AAD con su gateway), con etiqueta visible «principal» y sin que la clave salga jamás', async () => {
    const { gateway, clave } = await gatewayConClave();
    const fila = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: clave.id } });
    assert.deepEqual([fila.proveedor, fila.gateway_id, fila.etiqueta, fila.ultimos4], ['gateway', gateway.id, `g${gateway.id}:principal`, KEY.slice(-4)]);
    assert.ok(fila.api_key_enc.startsWith('v2:') && !fila.api_key_enc.includes(KEY));
    assert.equal(descifrar(fila.api_key_enc, aadClave('gateway', fila.etiqueta)), KEY);
    assert.throws(() => descifrar(fila.api_key_enc, aadClave('gateway', 'principal')), 'la AAD ata la clave a su gateway');
    assert.equal((await claveGw(gateway.id, KEY)).body.etiqueta, 'principal', 'la respuesta trae la etiqueta visible');
    const lista = await llamar(base, 'GET', '/api/llavero', T.super);
    const c = lista.body.claves.find((x: { id: number }) => x.id === clave.id);
    assert.deepEqual([c.proveedor, c.gateway_id, c.etiqueta, c.ultimos4], ['gateway', gateway.id, 'principal', KEY.slice(-4)]);
    sinClaves(JSON.stringify(lista.body));
    const aud = await auditoriaDe('clave-ia');
    sinClaves(JSON.stringify(aud));
    sinClaves(logs.join('\n'));
  });

  it('dos gateways pueden tener cada uno su clave «principal»; cada uno admite hasta 5; sin gateway_id → 422; gateway inexistente → 404', async () => {
    await dominio(DOMINIO_DASHBOARDIA);
    await dominio('omniroute.gargurevich.dev');
    const a = (await crearGw()).body;
    const b = (await crearGw({ nombre: 'OmniRoute', base_url: 'https://omniroute.gargurevich.dev/v1', vision: false })).body;
    assert.equal((await claveGw(a.id, KEY)).status, 201);
    assert.equal((await claveGw(b.id, KEY2)).status, 201, 'misma etiqueta, otro gateway');
    assert.equal((await claveGw(a.id, KEY2)).status, 200, 'reemplazar la «principal» del mismo gateway');
    for (const n of [2, 3, 4, 5]) assert.equal((await claveGw(a.id, `sk-gateway-0000-${n}${n}${n}${n}`, { etiqueta: `clave-${n}` })).status, 201);
    const sexta = await claveGw(a.id, 'sk-gateway-0000-6666', { etiqueta: 'clave-6' });
    assert.equal(sexta.status, 422, 'el sexto del gateway A');
    assert.equal((await claveGw(b.id, 'sk-gateway-0000-7777', { etiqueta: 'clave-2' })).status, 201, 'el tope es por gateway');
    assert.equal((await llamar(base, 'PUT', '/api/llavero/gateway', T.super, { clave: KEY })).status, 422);
    assert.equal((await claveGw(99999)).status, 404);
    assert.equal((await llamar(base, 'PUT', '/api/llavero/groq', T.super, { clave: KEY, gateway_id: a.id })).status, 422, 'gateway_id sólo para gateways');
  });

  it('probar: llama a {base}/models y a /chat/completions del gateway, con Bearer y a la IP validada', async () => {
    const { clave } = await gatewayConClave();
    const r = await llamar(base, 'POST', `/api/llavero/${clave.id}/probar`, T.super);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.estado, 'ok');
    assert.deepEqual(llamadas.map((l) => l.url), [`${URL_DASHBOARDIA}/models`, `${URL_DASHBOARDIA}/chat/completions`]);
    for (const l of llamadas) {
      assert.equal((l.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
      assert.deepEqual(l.init.destino, { host: DOMINIO_DASHBOARDIA, ip: IP_PUBLICA, family: 4 }, 'se conecta a la IP que se validó');
      assert.equal(l.init.redirect, 'manual');
    }
    assert.equal(r.body.etiqueta, 'principal');
    assert.ok((await prisma.modeloIA.count({ where: { clave_id: clave.id } })) > 0, 'el sync de modelos funciona igual');
    sinClaves(JSON.stringify(r.body) + logs.join('\n'));
  });

  it('entra a la cadena de rotación (con visión) y a la consulta del asistente', async () => {
    await gatewayConClave();
    const e = await eslabonDeGateway();
    assert.deepEqual([e.proveedor.nombre, e.proveedor.vision, e.proveedor.baseUrl, e.proveedor.prioridad, e.cooldownKey.startsWith('gateway#')], ['Dashboard IA', true, URL_DASHBOARDIA, 2, true]);
    assert.equal(e.modelo, 'qwen3-vl-flash');
    const s = await consultaMinima(e, 'qwen3-vl-flash');
    assert.equal(s.tipo, 'completa');
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0]!.url, `${URL_DASHBOARDIA}/chat/completions`);
    assert.equal(llamadas[0]!.init.destino!.ip, IP_PUBLICA);
  });

  it('la prioridad del gateway lo ordena frente al catálogo (2 → antes que Groq, después de Gemini)', async () => {
    const { gateway } = await gatewayConClave();
    await guardarClave({ proveedor: 'groq', clave: 'groq-clave-0000-1', usuarioId: superId });
    await guardarClave({ proveedor: 'gemini', clave: 'gemini-clave-0000-1', usuarioId: superId });
    assert.deepEqual((await construirCadena()).map((e) => e.proveedor.id), ['gemini', 'gateway', 'groq']);
    await llamar(base, 'PATCH', `/api/llavero/gateways/${gateway.id}`, T.super, { prioridad: 30 });
    assert.deepEqual((await construirCadena()).map((e) => e.proveedor.id), ['gemini', 'groq', 'gateway']);
    assert.deepEqual((await llamar(base, 'GET', '/api/llavero', T.super)).body.orden.slice(0, 3), ['gemini', 'groq', 'openrouter']);
  });
});

describe('la barrera de FONDO es la red: se resuelve en CADA llamada', () => {
  const PRIVADAS = ['10.0.0.5', '10.255.1.1', '127.0.0.1', '169.254.169.254', '172.16.3.3', '192.168.1.9', '100.64.0.5', 'fd00::5', '::1', 'fe80::1', '::ffff:10.0.0.1'];

  for (const ip of PRIVADAS) {
    it(`un dominio PERMITIDO que resuelve a ${ip}: ni probar, ni asistente, ni sync, ni fetchProveedor hacen una sola petición`, async () => {
      const { clave } = await gatewayConClave();
      const e = await eslabonDeGateway();
      dnsFalso({ [DOMINIO_DASHBOARDIA]: [ip] });
      llamadas = [];
      const r = await llamar(base, 'POST', `/api/llavero/${clave.id}/probar`, T.super);
      assert.equal(r.body.estado, 'error');
      const s = await consultaMinima(e, 'qwen3-vl-flash');
      assert.equal(s.tipo, 'fallo');
      assert.equal((await sincronizarClave(clave.id))?.ok, false);
      await assert.rejects(fetchProveedor(e.proveedor, `${URL_DASHBOARDIA}/chat/completions`, { method: 'POST' }), (x: unknown) => x instanceof GatewayError && x.codigo === 'ip_privada');
      assert.equal(llamadas.length, 0, 'ninguna petición salió');
      assert.ok(logs.some((l) => /bloqueada \(ip_privada\)/.test(l)));
      assert.ok(!logs.some((l) => l.includes(ip) && l.includes('ip_privada')), 'el log no escribe la IP interna');
    });
  }

  it('basta una dirección interna entre varias públicas', async () => {
    await gatewayConClave();
    const e = await eslabonDeGateway();
    dnsFalso({ [DOMINIO_DASHBOARDIA]: [IP_PUBLICA, '8.8.8.8', '10.0.0.9'] });
    assert.equal((await consultaMinima(e, 'm')).tipo, 'fallo');
    assert.equal(llamadas.length, 0);
  });

  it('DNS-rebinding: la primera llamada va a una IP pública y la siguiente, que ya apunta adentro, se bloquea', async () => {
    await gatewayConClave();
    const e = await eslabonDeGateway();
    dnsFalso();
    assert.equal((await consultaMinima(e, 'm')).tipo, 'completa');
    assert.equal(llamadas.length, 1);
    dnsFalso({ [DOMINIO_DASHBOARDIA]: ['169.254.169.254'] });
    assert.equal((await consultaMinima(e, 'm')).tipo, 'fallo');
    assert.equal(llamadas.length, 1, 'la segunda no salió');
  });

  it('una respuesta 3xx del gateway no se sigue (redirect manual) y cuenta como fallo del proveedor', async () => {
    const { clave } = await gatewayConClave();
    respuesta = () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
    const r = await llamar(base, 'POST', `/api/llavero/${clave.id}/probar`, T.super);
    assert.equal(r.body.estado, 'error');
    assert.equal(llamadas.length, 1, 'sólo /models; el redirect no se siguió');
    assert.equal(llamadas[0]!.init.redirect, 'manual');
  });

  it('un gateway sólo llama a SU host y a SU ruta base, aunque otro dominio de la lista esté permitido', async () => {
    await gatewayConClave();
    await dominio('omniroute.gargurevich.dev');
    const e = await eslabonDeGateway();
    for (const url of ['https://omniroute.gargurevich.dev/v1/chat/completions', `https://${DOMINIO_DASHBOARDIA}/otra-ruta/x`, `https://${DOMINIO_DASHBOARDIA}:8443/v1/x`, `http://${DOMINIO_DASHBOARDIA}/v1/x`, 'https://169.254.169.254/v1/x']) {
      await assert.rejects(fetchProveedor(e.proveedor, url, { method: 'POST' }), (x: unknown) => x instanceof GatewayError, url);
    }
    assert.equal(llamadas.length, 0);
    await fetchProveedor(e.proveedor, `${URL_DASHBOARDIA}/chat/completions?x=1`, { method: 'POST' });
    assert.equal(llamadas.length, 1, 'su propia URL sí sale');
  });

  it('la IP que sale de resolverDestino es la que se pasa al transporte (no se re-resuelve)', async () => {
    await gatewayConClave();
    const e = await eslabonDeGateway();
    const dns = dnsFalso({ [DOMINIO_DASHBOARDIA]: ['8.8.4.4'] });
    await consultaMinima(e, 'm');
    assert.equal(llamadas[0]!.init.destino!.ip, '8.8.4.4');
    assert.equal(dns.consultas.length, 1, 'se resolvió UNA vez por llamada');
  });

  it('un gateway cuya URL guardada ya no cumple (alterada en la base) falla cerrado', async () => {
    const { gateway } = await gatewayConClave();
    const e = await eslabonDeGateway();
    for (const url of ['http://api.dashboardia.gargurevich.dev/v1', 'https://127.0.0.1/v1', 'https://api.dashboardia.gargurevich.dev:8443/v1', 'https://evil.example/v1']) {
      await prisma.gatewayIA.update({ where: { id: gateway.id }, data: { base_url: url } });
      llamadas = [];
      assert.equal((await consultaMinima(e, 'm')).tipo, 'fallo', url);
      assert.equal(llamadas.length, 0, url);
      assert.equal((await construirCadena()).some((x) => x.proveedor.gatewayId !== undefined), false, `${url} fuera de la cadena`);
    }
  });

  it('un proveedor del catálogo sigue sin pasar por DNS ni barreras (URL constante)', async () => {
    await guardarClave({ proveedor: 'groq', clave: 'groq-clave-0000-1', usuarioId: superId });
    const dns = dnsFalso();
    const e = (await construirCadena())[0]!;
    assert.equal((await consultaMinima(e, 'm')).tipo, 'completa');
    assert.equal(dns.consultas.length, 0);
    assert.equal(llamadas[0]!.init.destino, undefined);
  });
});

describe('si el dominio sale de la lista (o el gateway se pausa), sus claves dejan de usarse', () => {
  it('quitar el dominio: sale de la cadena, ninguna llamada pendiente sale, y la pantalla lo dice; volver a agregarlo lo reactiva', async () => {
    const { clave } = await gatewayConClave();
    const e = await eslabonDeGateway(); // un eslabón armado ANTES de quitar el dominio
    const dom = await prisma.dominioGatewayPermitido.findFirstOrThrow();
    assert.equal((await llamar(base, 'DELETE', `/api/llavero/dominios/${dom.id}`, T.super)).status, 204);

    assert.equal((await construirCadena()).some((x) => x.proveedor.gatewayId !== undefined), false, 'fuera de la rotación');
    llamadas = [];
    assert.equal((await consultaMinima(e, 'm')).tipo, 'fallo', 'incluso con un eslabón viejo en mano');
    assert.equal((await llamar(base, 'POST', `/api/llavero/${clave.id}/probar`, T.super)).body.estado, 'error');
    assert.equal((await sincronizarClave(clave.id))?.ok, false);
    assert.equal(llamadas.length, 0);

    const lista = await llamar(base, 'GET', '/api/llavero', T.super);
    assert.equal(lista.body.gateways[0].estado, 'dominio_no_permitido');
    assert.equal(lista.body.gateways[0].claves, 1, 'la clave se conserva');

    assert.equal((await dominio(DOMINIO_DASHBOARDIA)).status, 201);
    assert.equal((await construirCadena()).some((x) => x.proveedor.gatewayId !== undefined), true);
    assert.equal((await llamar(base, 'GET', '/api/llavero', T.super)).body.gateways[0].estado, 'ok');
  });

  it('pausar el gateway: fuera de la cadena y de las llamadas; reanudar lo devuelve', async () => {
    const { gateway } = await gatewayConClave();
    const e = await eslabonDeGateway();
    const p = await llamar(base, 'PATCH', `/api/llavero/gateways/${gateway.id}`, T.super, { habilitado: false });
    assert.equal(p.body.estado, 'pausado');
    assert.equal((await construirCadena()).some((x) => x.proveedor.gatewayId !== undefined), false);
    assert.equal((await consultaMinima(e, 'm')).tipo, 'fallo');
    assert.equal(llamadas.length, 0);
    assert.equal((await llamar(base, 'PATCH', `/api/llavero/gateways/${gateway.id}`, T.super, { habilitado: true })).body.estado, 'ok');
    assert.equal((await construirCadena()).some((x) => x.proveedor.gatewayId !== undefined), true);
  });

  it('cambiar la URL a otro servidor: se revalida, las claves vuelven a «sin probar» y su catálogo de modelos se descarta', async () => {
    const { gateway, clave } = await gatewayConClave();
    await dominio('omniroute.gargurevich.dev');
    await llamar(base, 'POST', `/api/llavero/${clave.id}/probar`, T.super);
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: clave.id } })).estado, 'ok');
    assert.ok((await prisma.modeloIA.count({ where: { clave_id: clave.id } })) > 0);
    const mala = await llamar(base, 'PATCH', `/api/llavero/gateways/${gateway.id}`, T.super, { base_url: 'https://no-permitido.ejemplo.dev/v1' });
    assert.equal(mala.status, 422);
    assert.equal((await prisma.gatewayIA.findUniqueOrThrow({ where: { id: gateway.id } })).base_url, URL_DASHBOARDIA, 'no cambió');
    const ok = await llamar(base, 'PATCH', `/api/llavero/gateways/${gateway.id}`, T.super, { base_url: 'https://omniroute.gargurevich.dev/v1', nombre: 'OmniRoute' });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.nombre, ok.body.dominio], ['OmniRoute', 'omniroute.gargurevich.dev']);
    const c = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: clave.id } });
    assert.equal(c.estado, 'sin_probar');
    assert.equal(await prisma.modeloIA.count({ where: { clave_id: clave.id } }), 0);
    const aud = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'gateway-ia', accion: 'editar' } }); return f.length ? f : null; });
    assert.equal((aud[0]!.detalle as { url_cambia: boolean }).url_cambia, true);
  });

  it('borrar el gateway borra sus claves y modelos (cascada) y lo audita con cuántas', async () => {
    const { gateway, clave } = await gatewayConClave();
    await llamar(base, 'POST', `/api/llavero/${clave.id}/probar`, T.super);
    assert.equal((await llamar(base, 'DELETE', `/api/llavero/gateways/${gateway.id}`, T.super)).status, 204);
    assert.equal(await prisma.claveIntegracion.count(), 0);
    assert.equal(await prisma.modeloIA.count(), 0);
    assert.equal(await prisma.dominioGatewayPermitido.count(), 1, 'el dominio permitido se queda (es otra decisión)');
    const aud = await auditoriaDe('gateway-ia');
    assert.equal((aud.find((f) => f.accion === 'eliminar')!.detalle as { claves_borradas: number }).claves_borradas, 1);
  });
});

describe('OCR de comprobantes: en la base, nunca en variables de entorno', () => {
  const OCR_URL = 'http://house-ocr:5050/api/extract';
  const BCP_TEXTO = 'Constancia de operación\nMonto transferido S/ 100.00';
  const usar = (texto = BCP_TEXTO) => { ocrDeps.fetch = async (url, init) => { visto = { url, init }; return new Response(JSON.stringify({ text: texto })); }; };
  let visto: { url: string; init: Llamada['init'] } | null = null;
  beforeEach(() => { visto = null; delete process.env.OCR_BASE_URL; delete process.env.OCR_API_KEY; });
  afterEach(() => { delete process.env.OCR_BASE_URL; delete process.env.OCR_API_KEY; });

  it('sin configuración no se llama a nada, aunque OCR_BASE_URL / OCR_API_KEY estén en el entorno (ya no se leen)', async () => {
    process.env.OCR_BASE_URL = 'http://house-ocr:5050';
    process.env.OCR_API_KEY = 'clave-ocr-env';
    usar();
    assert.equal(await ocrParaUso(), null);
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), null);
    assert.equal(visto, null);
  });

  it('configurado en la base (destino interno + clave cifrada): se usa esa URL y esa clave, y la del entorno se ignora', async () => {
    process.env.OCR_BASE_URL = 'https://otro-ocr.ejemplo.dev';
    process.env.OCR_API_KEY = 'clave-ocr-env';
    const r = await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo: 'interno', clave: KEY_OCR });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.configurado, r.body.modo, r.body.destino_interno, r.body.url, r.body.ultimos4, r.body.tiene_clave, r.body.estado], [true, 'interno', 'house-ocr', 'http://house-ocr:5050', KEY_OCR.slice(-4), true, 'ok']);
    sinClaves(JSON.stringify(r.body));
    const fila = await prisma.configuracionOcr.findUniqueOrThrow({ where: { id: 1 } });
    assert.ok(fila.api_key_enc!.startsWith('v2:') && !fila.api_key_enc!.includes(KEY_OCR), 'la clave del OCR va cifrada');
    assert.equal(descifrar(fila.api_key_enc!, aadClave('ocr', 'comprobantes')), KEY_OCR);
    usar();
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), BCP_TEXTO);
    assert.equal(visto!.url, OCR_URL);
    assert.equal((visto!.init.headers as Record<string, string>)['X-API-Key'], KEY_OCR);
    assert.equal(visto!.init.destino, undefined, 'un destino interno de la lista fija no se resuelve por DNS');
    const aud = await auditoriaDe('ocr-config');
    sinClaves(JSON.stringify(aud) + logs.join('\n'));
  });

  it('http://otro-servicio:5432 y http://postgres:5432 se RECHAZAN (modo interno y modo público), y no queda nada guardado', async () => {
    for (const modo of ['interno', 'publico']) {
      for (const url of ['http://otro-servicio:5432', 'http://postgres:5432']) {
        const r = await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo, base_url: url, clave: KEY_OCR });
        assert.equal(r.status, 422, `${modo} ${url}`);
        assert.ok(r.body.campos.base_url, `${modo} ${url}`);
      }
    }
    assert.equal(await prisma.configuracionOcr.count(), 0);
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), null);
  });

  it('una fila alterada en la base (destino interno ajeno) tampoco se usa: la lista fija vive en el código', async () => {
    await prisma.configuracionOcr.create({ data: { id: 1, modo: 'interno', destino_interno: 'postgres', habilitado: true } });
    usar();
    assert.equal(await ocrParaUso(), null);
    await prisma.configuracionOcr.update({ where: { id: 1 }, data: { destino_interno: null, base_url: 'http://postgres:5432' } });
    assert.equal(await ocrParaUso(), null);
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), null);
    assert.equal(visto, null);
  });

  it('público: mismas barreras que un gateway (dominio de la lista, https/443, IP pública) y se conecta a la IP validada', async () => {
    const mal = await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo: 'publico', base_url: 'https://ocr.ejemplo.dev' });
    assert.equal(mal.status, 422);
    assert.match(mal.body.campos.base_url, /lista de dominios permitidos/);
    await dominio('ocr.ejemplo.dev');
    for (const [url, re] of [['https://ocr.ejemplo.dev:8443', /443/], ['https://10.0.0.5', /dirección IP/], ['http://ocr.ejemplo.dev', /https/]] as const) {
      const r = await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo: 'publico', base_url: url });
      assert.equal(r.status, 422, url);
      assert.match(r.body.campos.base_url, re);
    }
    const ok = await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo: 'publico', base_url: 'https://ocr.ejemplo.dev/', clave: KEY_OCR });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.url, 'https://ocr.ejemplo.dev');
    usar();
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), BCP_TEXTO);
    assert.equal(visto!.url, 'https://ocr.ejemplo.dev/api/extract');
    assert.deepEqual(visto!.init.destino, { host: 'ocr.ejemplo.dev', ip: IP_PUBLICA, family: 4 });
  });

  it('público que resuelve a una IP interna, o cuyo dominio sale de la lista: no se llama y la pantalla lo marca', async () => {
    await dominio('ocr.ejemplo.dev');
    await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo: 'publico', base_url: 'https://ocr.ejemplo.dev' });
    usar();
    dnsFalso({ 'ocr.ejemplo.dev': ['10.1.1.1'] });
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), null);
    assert.equal(visto, null);
    dnsFalso();
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), BCP_TEXTO);
    visto = null;
    const dom = await prisma.dominioGatewayPermitido.findFirstOrThrow({ where: { dominio: 'ocr.ejemplo.dev' } });
    await llamar(base, 'DELETE', `/api/llavero/dominios/${dom.id}`, T.super);
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), null);
    assert.equal(visto, null);
    assert.equal((await llamar(base, 'GET', '/api/llavero', T.super)).body.ocr.estado, 'invalido');
  });

  it('pausar y quitar: deja de usarse; «quitar» borra la clave pero conserva la fila para que el entorno no la resucite', async () => {
    await guardarOcr({ modo: 'interno', clave: KEY_OCR }, superId);
    usar();
    assert.equal((await llamar(base, 'PATCH', '/api/llavero/ocr', T.super, { habilitado: false })).body.estado, 'pausado');
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), null);
    await llamar(base, 'PATCH', '/api/llavero/ocr', T.super, { habilitado: true });
    assert.equal(await extraerTexto({ mime: 'image/png', bytes: new Uint8Array([1]) }), BCP_TEXTO);
    assert.equal((await llamar(base, 'DELETE', '/api/llavero/ocr', T.super)).status, 204);
    const fila = await prisma.configuracionOcr.findUniqueOrThrow({ where: { id: 1 } });
    assert.deepEqual([fila.api_key_enc, fila.ultimos4, fila.habilitado, fila.destino_interno, fila.base_url], [null, null, false, null, null]);
    assert.equal((await llamar(base, 'GET', '/api/llavero', T.super)).body.ocr.configurado, false);
    assert.equal(await migrarOcrDesdeEnv({ LLAVERO_ENC_KEY: ENC, OCR_BASE_URL: 'http://house-ocr:5050' } as NodeJS.ProcessEnv), 'ya_configurado');
    assert.equal((await ocrParaUso()), null);
    assert.equal((await llamar(base, 'DELETE', '/api/llavero/ocr', T.super)).status, 404, 'ya estaba quitado');
  });

  it('cambiar el destino sin mandar clave conserva la anterior; mandar otra la reemplaza', async () => {
    await guardarOcr({ modo: 'interno', clave: KEY_OCR }, superId);
    await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo: 'interno', base_url: 'http://house-ocr:5050/' });
    assert.equal(descifrar((await prisma.configuracionOcr.findUniqueOrThrow({ where: { id: 1 } })).api_key_enc!, aadClave('ocr', 'comprobantes')), KEY_OCR);
    const r = await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo: 'interno', clave: 'ocr-clave-1111-YYYY' });
    assert.equal(r.body.ultimos4, 'YYYY');
    assert.equal((await llamar(base, 'PUT', '/api/llavero/ocr', T.super, { modo: 'interno', clave: 'corta' })).status, 422);
  });
});

describe('migración única del OCR desde OCR_BASE_URL / OCR_API_KEY', () => {
  const env = (extra: Record<string, string>) => ({ LLAVERO_ENC_KEY: ENC, ...extra }) as NodeJS.ProcessEnv;

  it('interno: pasa a la base (clave cifrada) una sola vez, y el entorno ya no se lee', async () => {
    assert.equal(await migrarOcrDesdeEnv(env({ OCR_BASE_URL: 'http://house-ocr:5050/', OCR_API_KEY: 'clave-ocr-env' })), 'migrado');
    const fila = await prisma.configuracionOcr.findUniqueOrThrow({ where: { id: 1 } });
    assert.deepEqual([fila.modo, fila.destino_interno, fila.base_url, fila.ultimos4], ['interno', 'house-ocr', null, '-env']);
    assert.equal(descifrar(fila.api_key_enc!, aadClave('ocr', 'comprobantes')), 'clave-ocr-env');
    assert.equal(await migrarOcrDesdeEnv(env({ OCR_BASE_URL: 'http://house-ocr:5050', OCR_API_KEY: 'otra-clave-distinta' })), 'ya_configurado');
    assert.equal(descifrar((await prisma.configuracionOcr.findUniqueOrThrow({ where: { id: 1 } })).api_key_enc!, aadClave('ocr', 'comprobantes')), 'clave-ocr-env', 'no se pisa');
  });

  it('público: pasa a la base y agrega su dominio a la lista (lo puso el operador); la barrera de red sigue aplicando', async () => {
    assert.equal(await migrarOcrDesdeEnv(env({ OCR_BASE_URL: 'https://ocr.ejemplo.dev/' })), 'migrado');
    assert.equal((await prisma.configuracionOcr.findUniqueOrThrow({ where: { id: 1 } })).base_url, 'https://ocr.ejemplo.dev');
    assert.ok(await prisma.dominioGatewayPermitido.findUnique({ where: { dominio: 'ocr.ejemplo.dev' } }));
    ocrDeps.fetch = async () => new Response(JSON.stringify({ text: 'x' }));
    dnsFalso({ 'ocr.ejemplo.dev': ['127.0.0.1'] });
    assert.equal((await ocrParaUso()), null);
  });

  it('nada que migrar, URL no válida (http://postgres:5432, IP, puerto) o clave sin llavero: no escribe nada', async () => {
    assert.equal(await migrarOcrDesdeEnv(env({})), 'sin_variable');
    for (const u of ['http://postgres:5432', 'http://otro-servicio:5432', 'https://10.0.0.5', 'https://ocr.ejemplo.dev:8443', 'basura']) {
      assert.equal(await migrarOcrDesdeEnv(env({ OCR_BASE_URL: u })), 'url_no_valida', u);
    }
    assert.equal(await migrarOcrDesdeEnv({ OCR_BASE_URL: 'http://house-ocr:5050', OCR_API_KEY: 'clave-ocr-env' } as NodeJS.ProcessEnv), 'sin_llavero');
    assert.equal(await prisma.configuracionOcr.count(), 0);
    assert.equal(await prisma.dominioGatewayPermitido.count(), 0);
  });
});

describe('migración del dashboardia fijo → gateway «Dashboard IA»', () => {
  const ULTIMO_USO = new Date('2026-10-20T15:00:00Z');
  async function claveLegada() {
    return prisma.claveIntegracion.create({
      data: { proveedor: 'dashboardia', etiqueta: 'principal', api_key_enc: cifrar(KEY, aadClave('dashboardia', 'principal')), ultimos4: KEY.slice(-4), modelo: 'qwen3-vl-flash', habilitada: false, reserva: true, estado: 'ok', ultimo_uso_at: ULTIMO_USO, probada_at: ULTIMO_USO },
    });
  }
  const foto = async () => JSON.stringify([await prisma.claveIntegracion.findMany({ orderBy: { id: 'asc' } }), await prisma.gatewayIA.count(), await prisma.dominioGatewayPermitido.count()]);

  it('--seco informa y NO escribe nada', async () => {
    await claveLegada();
    const antes = await foto();
    const r = await migrarDashboardia({ seco: true });
    assert.deepEqual(r, { seco: true, dominio: 'creado', gateway: 'creado', claves_migradas: 1, claves_ya_en_gateway: 0 });
    assert.equal(await foto(), antes);
  });

  it('en real crea dominio y gateway, y pasa la clave sin perder valor ni estado; repetirlo es idempotente', async () => {
    const legada = await claveLegada();
    const r = await migrarDashboardia({ seco: false });
    assert.deepEqual(r, { seco: false, dominio: 'creado', gateway: 'creado', claves_migradas: 1, claves_ya_en_gateway: 0 });
    const g = await prisma.gatewayIA.findFirstOrThrow();
    assert.deepEqual([g.nombre, g.base_url, g.modelo_por_defecto, g.modelo_vision, g.vision, g.prioridad, g.habilitado], ['Dashboard IA', URL_DASHBOARDIA, 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3.5-super-vl-120b-a12b', true, 2, true]);
    assert.ok(await prisma.dominioGatewayPermitido.findUnique({ where: { dominio: DOMINIO_DASHBOARDIA } }));
    const c = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: legada.id } });
    assert.deepEqual([c.proveedor, c.gateway_id, c.etiqueta, c.habilitada, c.reserva, c.estado, c.modelo, c.ultimos4, c.ultimo_uso_at?.toISOString()], ['gateway', g.id, `g${g.id}:principal`, false, true, 'ok', 'qwen3-vl-flash', KEY.slice(-4), ULTIMO_USO.toISOString()]);
    assert.equal(descifrar(c.api_key_enc, aadClave('gateway', c.etiqueta)), KEY, 'la key sobrevive, re-cifrada');
    assert.notEqual(c.api_key_enc, legada.api_key_enc);

    const despues = await foto();
    const otra = await migrarDashboardia({ seco: false });
    assert.deepEqual(otra, { seco: false, dominio: 'ya_estaba', gateway: 'ya_estaba', claves_migradas: 0, claves_ya_en_gateway: 1 });
    assert.equal(await foto(), despues, 'la segunda corrida no cambia nada');
    assert.equal(await prisma.gatewayIA.count(), 1);
  });

  it('la clave migrada funciona: entra a la cadena y llama al gateway con su key; con la lista vigente y DNS público', async () => {
    await claveLegada();
    await migrarDashboardia({ seco: false });
    await prisma.claveIntegracion.updateMany({ data: { habilitada: true } }); // el ejemplo estaba pausada a propósito
    const e = await eslabonDeGateway();
    assert.equal(e.clave, KEY);
    assert.equal(e.reserva, true);
    assert.equal((await consultaMinima(e, 'qwen3-vl-flash')).tipo, 'completa');
    assert.equal((llamadas[0]!.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  });

  it('sin claves legadas sólo registra el gateway; una clave que no se puede descifrar aborta TODO sin dejar nada a medias', async () => {
    assert.equal((await migrarDashboardia({ seco: false })).claves_migradas, 0);
    await limpiarGateways();
    await prisma.claveIntegracion.create({ data: { proveedor: 'dashboardia', etiqueta: 'principal', api_key_enc: 'v2:basura-no-cifrada', ultimos4: 'xxxx' } });
    await assert.rejects(migrarDashboardia({ seco: false }), /No se pudo descifrar la clave #\d+ de dashboardia/);
    assert.equal(await prisma.gatewayIA.count(), 0);
    assert.equal(await prisma.dominioGatewayPermitido.count(), 0);
    assert.equal((await prisma.claveIntegracion.findFirstOrThrow()).proveedor, 'dashboardia');
  });
});
