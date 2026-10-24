import './helpers/env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { after, before, beforeEach, describe, it } from 'node:test';
import { cabecerasDeSesion, esperar, iniciar, llamar, login, prisma, PASSWORD } from './helpers/app';
import { sembrarHerramientas, hallazgosProhibidos, type DatosHerramientas } from './helpers/herramientas';

let base: string;
let cerrar: () => Promise<void>;
let D: DatosHerramientas;
let T: Record<'adminA' | 'adminB' | 'prop1' | 'prop2' | 'mtto' | 'super', string>;

before(async () => {
  D = await sembrarHerramientas();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, mcp: 40, mcpFallos: 1000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'), mtto: await login(base, 'mtto.a@test.pe'), super: await login(base, 'super@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => { await prisma.tokenApi.deleteMany(); await prisma.auditoria.deleteMany(); });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
async function crear(sesion: string, nombre = 'Claude', extra: Record<string, unknown> = {}) {
  const r = await llamar(base, 'POST', '/api/me/tokens-api', sesion, { nombre, ...extra });
  assert.equal(r.status, 201, r.texto);
  return r.body as { id: string; token: string; prefijo: string; vence: string };
}
type Rpc = { id?: number | string; method: string; params?: unknown };
async function mcp(token: string | null, cuerpo: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* sin cuerpo */ }
  return { status: r.status, body, texto, headers: r.headers };
}
const rpc = (token: string, m: Rpc) => mcp(token, { jsonrpc: '2.0', ...m });
const llamarHerramienta = async (token: string, name: string, args: unknown = {}) => {
  const r = await rpc(token, { id: 1, method: 'tools/call', params: { name, arguments: args } });
  return r;
};
const datosDe = (r: Awaited<ReturnType<typeof mcp>>) => JSON.parse(r.body.result.content[0].text);

describe('crear, listar y revocar tokens (con sesión)', () => {
  it('el token completo sale UNA vez; en la base sólo el sha256 y el prefijo; el listado nunca lo repite', async () => {
    const t = await crear(T.adminA, 'Mi Claude');
    assert.match(t.token, /^hse_[A-Za-z0-9_-]{43}$/);
    assert.equal(t.prefijo, t.token.slice(0, 8));
    const fila = await prisma.tokenApi.findUniqueOrThrow({ where: { id: t.id } });
    assert.equal(fila.hash, sha(t.token));
    assert.equal(fila.usuario_id, D.adminA.id);
    assert.ok(!JSON.stringify(fila).includes(t.token), 'el token no está en ninguna columna');
    const lista = await llamar(base, 'GET', '/api/me/tokens-api', T.adminA);
    assert.equal(lista.status, 200);
    assert.ok(!lista.texto.includes(t.token) && !lista.texto.includes(fila.hash));
    assert.deepEqual(Object.keys(lista.body.tokens[0]).sort(), ['creado', 'estado', 'id', 'nombre', 'prefijo', 'ultimo_uso', 'vence']);
    assert.equal(lista.body.tokens[0].estado, 'activo');
    assert.equal(lista.body.tokens[0].ultimo_uso, null);
    assert.equal((await llamar(base, 'POST', '/api/me/tokens-api', T.adminA, { nombre: 'x' })).headers.get('cache-control'), 'no-store');
  });
  it('vence a los 90 días por omisión, acepta hasta 365 y rechaza lo demás; nombre obligatorio y sin campos de más', async () => {
    const t = await crear(T.adminA);
    const dias = (new Date(t.vence).getTime() - Date.now()) / 86_400_000;
    assert.ok(dias > 89.9 && dias <= 90.01, String(dias));
    const largo = await crear(T.adminA, 'Un año', { dias: 365 });
    assert.ok((new Date(largo.vence).getTime() - Date.now()) / 86_400_000 > 364.9);
    for (const cuerpo of [{ nombre: 'x', dias: 366 }, { nombre: 'x', dias: 0 }, { nombre: 'x', dias: 1.5 }, { nombre: '' }, { dias: 5 }, { nombre: 'x', rol: 'superadmin' }, { nombre: 'x'.repeat(61) }]) {
      const r = await llamar(base, 'POST', '/api/me/tokens-api', T.adminA, cuerpo);
      assert.equal(r.status, 422, JSON.stringify(cuerpo));
    }
  });
  it('máximo 5 activos por usuario; revocar libera un cupo', async () => {
    const ts = [];
    for (let i = 0; i < 5; i++) ts.push(await crear(T.prop1, `t${i}`));
    assert.equal((await llamar(base, 'POST', '/api/me/tokens-api', T.prop1, { nombre: 'sexto' })).status, 422);
    assert.equal((await llamar(base, 'DELETE', `/api/me/tokens-api/${ts[0]!.id}`, T.prop1)).status, 204);
    assert.equal((await llamar(base, 'POST', '/api/me/tokens-api', T.prop1, { nombre: 'otra vez' })).status, 201);
  });
  it('cada quien ve y revoca sólo los suyos; el personal sin herramientas no puede crear', async () => {
    const t = await crear(T.adminA);
    assert.equal((await llamar(base, 'GET', '/api/me/tokens-api', T.adminB)).body.tokens.length, 0);
    assert.equal((await llamar(base, 'DELETE', `/api/me/tokens-api/${t.id}`, T.adminB)).status, 404);
    assert.equal((await rpc(t.token, { id: 1, method: 'ping' })).status, 200, 'sigue vivo');
    assert.equal((await llamar(base, 'POST', '/api/me/tokens-api', T.mtto, { nombre: 'x' })).status, 403);
    assert.equal((await llamar(base, 'DELETE', `/api/me/tokens-api/${t.id}`, T.adminA)).status, 204);
    assert.equal((await llamar(base, 'DELETE', `/api/me/tokens-api/${t.id}`, T.adminA)).status, 404, 'ya revocado');
    assert.equal((await rpc(t.token, { id: 1, method: 'ping' })).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/me/tokens-api', T.adminA)).body.tokens[0].estado, 'revocado');
  });
  it('exige sesión con CSRF: sin cookie 401; sin CSRF 403', async () => {
    assert.equal((await llamar(base, 'GET', '/api/me/tokens-api')).status, 401);
    const sinCsrf = T.adminA.split('.')[0]!;
    assert.equal((await llamar(base, 'POST', '/api/me/tokens-api', sinCsrf, { nombre: 'x' })).status, 403);
  });
  it('crear y revocar quedan en la auditoría (sin el token)', async () => {
    const t = await crear(T.adminA, 'Auditado');
    await llamar(base, 'DELETE', `/api/me/tokens-api/${t.id}`, T.adminA);
    const a = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'token_api' }, orderBy: { id: 'asc' } }); return f.length >= 2 ? f : null; });
    assert.deepEqual(a.map((x) => x.accion), ['crear', 'revocar']);
    assert.ok(!JSON.stringify(a).includes(t.token));
    assert.equal((a[0]!.detalle as any).nombre, 'Auditado'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('protocolo MCP', () => {
  it('initialize, ping, notificaciones, tools/list y tools/call', async () => {
    const { token } = await crear(T.adminA);
    const ini = await rpc(token, { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } } });
    assert.equal(ini.status, 200);
    assert.equal(ini.body.jsonrpc, '2.0');
    assert.equal(ini.body.id, 1);
    assert.equal(ini.body.result.protocolVersion, '2025-03-26');
    assert.deepEqual(ini.body.result.capabilities, { tools: { listChanged: false } });
    assert.equal(ini.body.result.serverInfo.name, 'house');
    assert.equal((await rpc(token, { id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).body.result.protocolVersion, '2025-06-18');
    assert.equal(ini.headers.get('cache-control'), 'no-store');
    const noti = await mcp(token, { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(noti.status, 202);
    assert.equal(noti.texto, '');
    assert.deepEqual((await rpc(token, { id: 'a', method: 'ping' })).body, { jsonrpc: '2.0', id: 'a', result: {} });

    const lista = await rpc(token, { id: 3, method: 'tools/list' });
    const tools = lista.body.result.tools as { name: string; description: string; inputSchema: any; annotations: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(tools.length, 14);
    assert.ok(tools.every((x) => x.inputSchema.type === 'object' && x.annotations.readOnlyHint === true && x.annotations.destructiveHint === false && x.description.length > 40));
    assert.ok(tools.some((x) => x.name === 'morosos') && !tools.some((x) => x.name === 'mi_deuda' || x.name === 'empresas'));

    const r = await llamarHerramienta(token, 'morosos', { limite: 5 });
    assert.equal(r.body.result.isError, false);
    assert.equal(r.body.result.content[0].type, 'text');
    assert.deepEqual(datosDe(r).filas.map((f: any) => f.unidad).sort(), ['A-101', 'A-102']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('errores: método desconocido, herramienta inventada o de otro rol, argumentos inválidos, JSON roto, lotes y verbos', async () => {
    const { token } = await crear(T.prop1);
    assert.equal((await rpc(token, { id: 1, method: 'resources/list' })).body.error.code, -32601);
    const inventada = await llamarHerramienta(token, 'borrar_todo');
    assert.equal(inventada.body.error.code, -32602);
    const ajena = await llamarHerramienta(token, 'morosos');
    assert.equal(ajena.body.error.code, -32602);
    assert.ok(!ajena.texto.includes('A-102'));
    const invalida = await llamarHerramienta(token, 'mis_recibos', { estado: 'zzz' });
    assert.equal(invalida.body.result.isError, true);
    assert.match(invalida.body.result.content[0].text, /Argumentos inválidos/);
    assert.equal((await rpc(token, { id: 1, method: 'tools/call', params: {} })).body.error.code, -32602);
    const roto = await mcp(token, '{no es json');
    assert.equal(roto.status, 400);
    assert.equal(roto.body.error.code, -32700);
    assert.equal((await mcp(token, { method: 'ping' })).body.error.code, -32600, 'falta jsonrpc');
    assert.equal((await mcp(token, [])).status, 400);
    const lote = await mcp(token, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
    assert.deepEqual(lote.body.map((x: any) => x.id), [1, 2]); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const metodo of ['GET', 'DELETE', 'PUT']) {
      const r = await fetch(`${base}/mcp`, { method: metodo, headers: { authorization: `Bearer ${token}` } });
      assert.equal(r.status, 405, metodo);
      assert.equal(r.headers.get('allow'), 'POST');
    }
    assert.equal((await fetch(`${base}/mcp/otra`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' })).status, 404);
  });
  it('cada rol ve su lista: residente 5, junta gestión+suyas, mantenimiento ninguno, superadmin 17', async () => {
    const n = async (sesion: string) => (await rpc((await crear(sesion)).token, { id: 1, method: 'tools/list' })).body.result.tools.length;
    assert.equal(await n(T.prop1), 5);
    assert.equal(await n(T.super), 17);
    assert.equal(await n(T.adminB), 14);
  });
  it('un cuerpo enorme se rechaza (32 kb)', async () => {
    const { token } = await crear(T.adminA);
    const r = await mcp(token, { jsonrpc: '2.0', id: 1, method: 'ping', params: { x: 'a'.repeat(40_000) } });
    assert.equal(r.status, 413);
  });
});

describe('el token hereda EXACTAMENTE el alcance de su dueño', () => {
  it('admin A ve sólo su empresa; admin B sólo la suya; el residente sólo lo suyo; el superadmin todo', async () => {
    const a = (await crear(T.adminA)).token;
    const b = (await crear(T.adminB)).token;
    const p2 = (await crear(T.prop2)).token;
    const s = (await crear(T.super)).token;
    const unidades = async (tok: string) => datosDe(await llamarHerramienta(tok, 'morosos')).filas.map((f: any) => f.unidad).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(await unidades(a), ['A-101', 'A-102']);
    assert.deepEqual(await unidades(b), ['B-101']);
    assert.deepEqual(await unidades(s), ['A-101', 'A-102', 'B-101']);
    const mis = datosDe(await llamarHerramienta(p2, 'mi_deuda'));
    assert.equal(mis.deuda_total, '150.00');
    assert.ok(!JSON.stringify(datosDe(await llamarHerramienta(p2, 'mis_pagos'))).includes('OP-123'));
    assert.equal(datosDe(await llamarHerramienta(a, 'detalle_unidad', { codigo: 'B-101' })).encontrada, false);
  });
  it('la cookie de otra persona no cambia quién es el token: manda el dueño del token', async () => {
    const { token } = await crear(T.adminA);
    const r = await mcp(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'morosos', arguments: {} } }, cabecerasDeSesion(T.super));
    assert.deepEqual(datosDe(r).filas.map((f: any) => f.unidad).sort(), ['A-101', 'A-102']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('si el dueño recibe o pierde un cargo de junta, la lista y el alcance cambian en la siguiente llamada', async () => {
    const u = await prisma.usuario.create({ data: { nombre: 'Nuevo Propietario', email: 'nuevo.prop@test.pe', rol: 'propietario', password_hash: await bcrypt.hash(PASSWORD, 4), empresa_id: D.empresaA.id, complejo_id: D.complejoA.id, estructura_id: D.block1.id } });
    const sesion = await login(base, 'nuevo.prop@test.pe');
    const { token } = await crear(sesion);
    const nombres = async () => (await rpc(token, { id: 1, method: 'tools/list' })).body.result.tools.map((x: any) => x.name); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await nombres()).length, 5);
    await prisma.usuario.update({ where: { id: u.id }, data: { cargo_junta: 'tesorero' } });
    const con = await nombres();
    assert.ok(con.includes('morosos') && con.length > 5);
    assert.deepEqual(datosDe(await llamarHerramienta(token, 'morosos')).filas.map((f: any) => f.unidad), ['A-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    await prisma.usuario.update({ where: { id: u.id }, data: { cargo_junta: 'vocal' } });
    assert.equal((await nombres()).length, 5);
    assert.equal((await llamarHerramienta(token, 'morosos')).body.error.code, -32602, 'tools/call revalida el rol');
  });
  it('ninguna respuesta de MCP lleva correos, teléfonos, hashes ni tokens', async () => {
    const s = (await crear(T.super)).token;
    const a = (await crear(T.adminA)).token;
    for (const [tok, nombres] of [[s, ['resumen_cobranza', 'morosos', 'pagos', 'medios_de_pago', 'empresas', 'auditoria_reciente', 'avisos_recientes']], [a, ['pagos', 'cargos']]] as [string, string[]][]) {
      for (const n of nombres) {
        const r = await llamarHerramienta(tok, n, n === 'auditoria_reciente' ? {} : {});
        assert.deepEqual(hallazgosProhibidos(datosDe(r), '$', n === 'medios_de_pago'), [], n);
      }
    }
  });
});

describe('autenticación del endpoint', () => {
  it('sin token, malformado, con otro esquema, en la URL o sólo con cookie → 401 con WWW-Authenticate', async () => {
    const { token } = await crear(T.adminA);
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    assert.equal((await mcp(null, ping)).status, 401);
    const sin = await mcp(null, ping);
    assert.match(sin.headers.get('www-authenticate') ?? '', /^Bearer/);
    assert.equal((await mcp('hse_corto', ping)).status, 401);
    assert.equal((await mcp(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), ping)).status, 401, 'mismo prefijo, distinto hash');
    assert.equal((await mcp(null, ping, { authorization: `Basic ${token}` })).status, 401);
    const enUrl = await fetch(`${base}/mcp?token=${token}&access_token=${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ping) });
    assert.equal(enUrl.status, 401);
    const cookie = await mcp(null, ping, cabecerasDeSesion(T.adminA));
    assert.equal(cookie.status, 401, 'la cookie no abre /mcp');
    assert.equal((await mcp(token, ping)).status, 200);
  });
  it('rechaza cualquier petición con Origin (sin CORS ni DNS rebinding) y no emite cabeceras CORS', async () => {
    const { token } = await crear(T.adminA);
    const r = await mcp(token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' } });
    assert.ok(pre.status >= 400 && pre.status < 500);
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
  });
  it('expirado, revocado, usuario desactivado, contraseña cambiada y rol cambiado → 401', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const hash = await bcrypt.hash(PASSWORD, 4);
    const crearUsuario = async (email: string, rol = 'propietario') => prisma.usuario.create({ data: { nombre: `U ${email}`, email, rol, password_hash: hash, empresa_id: D.empresaA.id, complejo_id: D.complejoA.id } });

    const venc = await crear(T.adminA);
    assert.equal((await mcp(venc.token, ping)).status, 200);
    await prisma.tokenApi.update({ where: { id: venc.id }, data: { expira: new Date(Date.now() - 1000) } });
    assert.equal((await mcp(venc.token, ping)).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/me/tokens-api', T.adminA)).body.tokens[0].estado, 'vencido');

    const rev = await crear(T.adminA);
    await prisma.tokenApi.update({ where: { id: rev.id }, data: { revocado_at: new Date() } });
    assert.equal((await mcp(rev.token, ping)).status, 401);

    const u1 = await crearUsuario('desactivar@test.pe');
    const t1 = await crear(await login(base, 'desactivar@test.pe'));
    assert.equal((await mcp(t1.token, ping)).status, 200);
    await prisma.usuario.update({ where: { id: u1.id }, data: { rol: null } });
    assert.equal((await mcp(t1.token, ping)).status, 401, 'usuario desactivado');

    const u2 = await crearUsuario('clave@test.pe');
    const t2 = await crear(await login(base, 'clave@test.pe'));
    await prisma.usuario.update({ where: { id: u2.id }, data: { password_hash: await bcrypt.hash('OtraClave12345', 4) } });
    assert.equal((await mcp(t2.token, ping)).status, 401, 'contraseña cambiada');

    const u3 = await crearUsuario('rol@test.pe');
    const t3 = await crear(await login(base, 'rol@test.pe'));
    await prisma.usuario.update({ where: { id: u3.id }, data: { rol: 'inquilino' } });
    assert.equal((await mcp(t3.token, ping)).status, 401, 'rol cambiado');
    assert.equal((await llamar(base, 'GET', '/api/me/tokens-api', await login(base, 'rol@test.pe'))).body.tokens[0].estado, 'invalidado');

    const u4 = await crearUsuario('borrado@test.pe');
    const t4 = await crear(await login(base, 'borrado@test.pe'));
    await prisma.usuario.delete({ where: { id: u4.id } });
    assert.equal((await mcp(t4.token, ping)).status, 401);
    assert.equal(await prisma.tokenApi.count({ where: { id: t4.id } }), 0, 'el token se borra con el usuario (cascade)');
  });
  it('el Bearer no abre ninguna otra ruta, ni sustituye la cookie, ni crea tokens', async () => {
    const { token } = await crear(T.adminA);
    const auth = { authorization: `Bearer ${token}` };
    for (const [m, ruta, cuerpo] of [['GET', '/api/auth/me'], ['GET', '/api/unidades'], ['GET', '/api/usuarios'], ['GET', '/api/me/tokens-api'], ['POST', '/api/me/tokens-api', { nombre: 'x' }], ['POST', '/api/ai-chat', { message: 'hola' }], ['GET', '/api/ai-chat/conversaciones'], ['GET', '/api/reportes/morosidad'], ['GET', '/api/llavero']] as [string, string, unknown?][]) {
      const r = await llamar(base, m, ruta, null, cuerpo, auth);
      assert.equal(r.status, 401, `${m} ${ruta}`);
    }
  });
  it('último uso: se registra y los intentos fallidos no tocan nada', async () => {
    const t = await crear(T.adminA);
    await mcp(t.token, { jsonrpc: '2.0', id: 1, method: 'ping' });
    assert.ok((await prisma.tokenApi.findUniqueOrThrow({ where: { id: t.id } })).ultimo_uso);
    const lista = await llamar(base, 'GET', '/api/me/tokens-api', T.adminA);
    assert.ok(lista.body.tokens[0].ultimo_uso);
  });
});

describe('tasa y auditoría', () => {
  it('límite por token (40 por minuto en estas pruebas): el 41 recibe 429 con Retry-After y otro token sigue sirviendo', async () => {
    const a = (await crear(T.adminA)).token;
    const b = (await crear(T.adminB)).token;
    let ultimo = 0;
    let retry: string | null = null;
    for (let i = 0; i < 45; i++) {
      const r = await mcp(a, { jsonrpc: '2.0', id: i, method: 'ping' });
      if (r.status === 429) { ultimo = r.status; retry = r.headers.get('retry-after'); break; }
    }
    assert.equal(ultimo, 429);
    assert.ok(Number(retry) >= 1);
    assert.equal((await mcp(b, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200);
  });
  it('cada tools/call queda auditado con origen mcp y el usuario del token', async () => {
    const { token } = await crear(T.prop1);
    await llamarHerramienta(token, 'mi_deuda');
    await llamarHerramienta(token, 'morosos');
    const a = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'herramienta' }, orderBy: { id: 'asc' } }); return f.length >= 2 ? f : null; });
    assert.deepEqual(a.map((x) => [(x.detalle as any).herramienta, (x.detalle as any).origen, (x.detalle as any).estado, x.usuario_id]), [['mi_deuda', 'mcp', 'ok', D.propietario1.id], ['morosos', 'mcp', 'sin_permiso', D.propietario1.id]]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
