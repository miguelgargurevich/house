import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { cookieDe, esperar, iniciar, llamar, login, prisma, sembrar, PASSWORD, type Datos } from './helpers/app';
import { suscripcionFalsa, tokenFcmFalso, VAPID_FALSO } from './helpers/push';
import { MAX_DISPOSITIVOS } from '../src/server/services/push/dispositivos';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'propB', string>;
const claves = ['FCM_PROJECT_ID', 'FCM_SERVICE_ACCOUNT_JSON', 'FCM_SERVICE_ACCOUNT_BASE64', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
const respaldo = new Map<string, string | undefined>();

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), propB: await login(base, 'propb@test.pe'),
  };
  for (const k of claves) respaldo.set(k, process.env[k]);
});
after(async () => {
  for (const [k, v] of respaldo) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.dispositivoPush.deleteMany();
  await prisma.auditoria.deleteMany();
  for (const k of claves) delete process.env[k];
});

const alta = (t: string | null, cuerpo: unknown) => llamar(base, 'POST', '/api/me/push/dispositivos', t, cuerpo);
const baja = (t: string | null, token: string) => llamar(base, 'POST', '/api/me/push/dispositivos/baja', t, { token });
const fcm = (token = tokenFcmFalso(), plataforma = 'android') => ({ tipo: 'fcm', token, plataforma });
const web = () => ({ tipo: 'web', ...suscripcionFalsa() });

describe('push: GET /api/me/push/config', () => {
  it('sin variables: nada listo y sin clave pública', async () => {
    const r = await llamar(base, 'GET', '/api/me/push/config', T.prop1);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { fcm: false, web: false, vapid_public: null });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  it('con las variables: fcm y web listos y SÓLO la clave pública (nunca la privada ni la cuenta)', async () => {
    Object.assign(process.env, VAPID_FALSO, { FCM_PROJECT_ID: 'torre-prueba', FCM_SERVICE_ACCOUNT_JSON: (await import('./helpers/push')).cuentaDeServicioFalsa().json });
    const r = await llamar(base, 'GET', '/api/me/push/config', T.prop1);
    assert.deepEqual(r.body, { fcm: true, web: true, vapid_public: VAPID_FALSO.VAPID_PUBLIC_KEY });
    assert.ok(!r.texto.includes(VAPID_FALSO.VAPID_PRIVATE_KEY) && !r.texto.includes('PRIVATE KEY'));
  });

  it('exige sesión', async () => {
    assert.equal((await llamar(base, 'GET', '/api/me/push/config', null)).status, 401);
  });
});

describe('push: registrar un dispositivo', () => {
  it('FCM (Android): 200 y queda a nombre de quien lo registró', async () => {
    const c = fcm();
    const r = await alta(T.prop1, c);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body, { registrado: true, reasignado: false });
    const fila = await prisma.dispositivoPush.findUniqueOrThrow({ where: { token: c.token } });
    assert.equal(fila.usuario_id, d.propietario1.id);
    assert.deepEqual([fila.tipo, fila.plataforma], ['fcm', 'android']);
  });

  it('navegador: guarda el endpoint y las llaves', async () => {
    const w = web();
    assert.equal((await alta(T.prop1, w)).status, 200);
    const fila = await prisma.dispositivoPush.findUniqueOrThrow({ where: { token: w.endpoint } });
    assert.deepEqual([fila.tipo, fila.plataforma, fila.p256dh, fila.auth], ['web', 'web', w.keys.p256dh, w.keys.auth]);
  });

  it('repetir el mismo token no duplica la fila', async () => {
    const c = fcm();
    await alta(T.prop1, c); await alta(T.prop1, c);
    assert.equal(await prisma.dispositivoPush.count(), 1);
  });

  it('un teléfono que cambia de dueño (otra sesión entró) pasa al nuevo y se avisa «reasignado»', async () => {
    const c = fcm();
    await alta(T.prop1, c);
    const r = await alta(T.propB, c);
    assert.deepEqual(r.body, { registrado: true, reasignado: true });
    assert.equal((await prisma.dispositivoPush.findUniqueOrThrow({ where: { token: c.token } })).usuario_id, d.propietarioB.id);
  });

  it('exige sesión (401) y CSRF (403)', async () => {
    assert.equal((await alta(null, fcm())).status, 401);
    const sinCsrf = await llamar(base, 'POST', '/api/me/push/dispositivos', T.prop1, fcm(), { 'x-csrf-token': 'otro' });
    assert.equal(sinCsrf.status, 403);
    assert.equal(await prisma.dispositivoPush.count(), 0);
  });

  it('valida todo con zod (422): plataforma, token, campos de más, llaves y tipo', async () => {
    const malos: unknown[] = [
      {}, { tipo: 'sms', token: 'x' }, fcm(tokenFcmFalso(), 'windows'), fcm('corto'), fcm(`${'a'.repeat(30)} con espacios`), fcm('a'.repeat(401)),
      { ...fcm(), extra: 1 },
      { tipo: 'web', endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },                                        // sin llaves
      { ...web(), keys: { p256dh: 'corta', auth: 'corta' } },
      { ...web(), keys: { p256dh: suscripcionFalsa().keys.p256dh, auth: 'con espacios y ñ' } },
      { ...web(), extra: true },
    ];
    for (const m of malos) {
      const r = await alta(T.prop1, m);
      assert.equal(r.status, 422, JSON.stringify(m).slice(0, 80));
      assert.ok(typeof r.body.error === 'string');
    }
    assert.equal(await prisma.dispositivoPush.count(), 0);
  });

  it('SSRF: un endpoint que no es un servicio de push de un navegador se rechaza (422) y no se guarda', async () => {
    for (const endpoint of ['http://fcm.googleapis.com/fcm/send/x', 'https://evil.example/push', 'https://fcm.googleapis.com.evil.com/x', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://user:p@fcm.googleapis.com/x']) {
      const r = await alta(T.prop1, { ...web(), endpoint });
      assert.equal(r.status, 422, endpoint);
      assert.match(r.body.error, /Dirección de push no permitida/);
    }
    assert.equal(await prisma.dispositivoPush.count(), 0);
  });

  it('tope por persona: sobre el máximo se borran los menos usados', async () => {
    const tokens: string[] = [];
    for (let i = 0; i < MAX_DISPOSITIVOS + 2; i++) { const c = fcm(); tokens.push(c.token); assert.equal((await alta(T.prop1, c)).status, 200); }
    const quedan = (await prisma.dispositivoPush.findMany({ where: { usuario_id: d.propietario1.id } })).map((x) => x.token).sort();
    assert.equal(quedan.length, MAX_DISPOSITIVOS);
    assert.deepEqual(quedan, tokens.slice(2).sort(), 'se fueron los dos más viejos');
  });

  it('una sesión prestada («Entrar como») no registra nada: 403', async () => {
    const r = await llamar(base, 'POST', '/api/impersonacion', T.super, { usuario_id: d.propietario1.id, motivo: 'Soporte: la vecina no ve su recibo' });
    assert.equal(r.status, 200, r.texto);
    const prestada = `${cookieDe(r)}.${r.body.csrf}`;
    const intento = await alta(prestada, fcm());
    assert.equal(intento.status, 403);
    assert.match(intento.body.error, /otra persona/);
    assert.equal(await prisma.dispositivoPush.count(), 0);
    // leer la config sí se puede, y dar de baja nada
    assert.equal((await llamar(base, 'GET', '/api/me/push/config', prestada)).status, 200);
  });
});

describe('push: dar de baja', () => {
  it('borra el dispositivo propio y contesta 204; repetir también 204', async () => {
    const c = fcm();
    await alta(T.prop1, c);
    assert.equal((await baja(T.prop1, c.token)).status, 204);
    assert.equal(await prisma.dispositivoPush.count(), 0);
    assert.equal((await baja(T.prop1, c.token)).status, 204);
  });

  it('con el endpoint de un navegador (URL larga) también', async () => {
    const w = web();
    await alta(T.prop1, w);
    assert.equal((await baja(T.prop1, w.endpoint)).status, 204);
    assert.equal(await prisma.dispositivoPush.count(), 0);
  });

  it('el dispositivo de OTRA persona (o de otro tenant) no se toca y la respuesta es la misma', async () => {
    const mio = fcm(); const ajeno = fcm();
    await alta(T.propB, ajeno);
    await alta(T.prop1, mio);
    for (const quien of [T.prop1, T.adminA, T.adminB]) assert.equal((await baja(quien, ajeno.token)).status, 204);
    assert.equal(await prisma.dispositivoPush.count({ where: { token: ajeno.token } }), 1, 'sigue a nombre de su dueño');
    assert.equal(await prisma.dispositivoPush.count({ where: { token: mio.token } }), 1);
  });

  it('valida el cuerpo (422) y exige sesión (401)', async () => {
    assert.equal((await llamar(base, 'POST', '/api/me/push/dispositivos/baja', T.prop1, {})).status, 422);
    assert.equal((await llamar(base, 'POST', '/api/me/push/dispositivos/baja', T.prop1, { token: 'x'.repeat(1001) })).status, 422);
    assert.equal((await baja(null, 'x')).status, 401);
  });
});

describe('push: auditoría y cuentas eliminadas', () => {
  it('la auditoría deja quién y qué, pero NUNCA el token ni el endpoint', async () => {
    const c = fcm(); const w = web();
    await alta(T.prop1, c); await alta(T.prop1, w); await baja(T.prop1, c.token);
    const filas = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'dispositivo_push' } }); return f.length >= 3 ? f : null; });
    const todo = JSON.stringify(filas);
    assert.ok(!todo.includes(c.token) && !todo.includes(w.endpoint) && !todo.includes(w.keys.auth), 'ni token, ni endpoint ni llaves en la auditoría');
    assert.deepEqual(filas.map((f) => f.accion).sort(), ['baja', 'registrar', 'registrar']);
    assert.ok(filas.every((f) => f.usuario_id === d.propietario1.id));
  });

  it('al eliminar su cuenta se borran sus dispositivos (la fila se anonimiza, no se borra: no hay cascada)', async () => {
    const t = await login(base, 'prop2@test.pe');
    const c = fcm();
    await alta(t, c);
    assert.equal(await prisma.dispositivoPush.count({ where: { usuario_id: d.propietario2.id } }), 1);
    const r = await llamar(base, 'POST', '/api/me/eliminar', t, { password: PASSWORD, confirmacion: 'ELIMINAR' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(await prisma.dispositivoPush.count({ where: { usuario_id: d.propietario2.id } }), 0);
  });
});
