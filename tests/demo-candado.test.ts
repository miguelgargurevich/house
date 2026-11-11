// El candado de la demo: con `ConfiguracionDemo.activo` NO sale ningún correo ni WhatsApp (queda «simulado»), el WhatsApp de ejemplo está conectado, no se
// cambian claves, correos ni celulares, no hay tokens de API, registros nuevos, «Entrar como», llavero ni chat de IA, y `/api/demo/entrar` abre sesión por
// rol. SIN el modo, `/api/demo/*` responde 404 y NADA de lo anterior cambia (producción).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, cookieDe, credenciales, PASSWORD, type Datos } from './helpers/app';
import { procesarCola, type DepsAvisos } from '../src/server/services/avisos';
import { enviarCorreo, enviarWhatsapp, MOTIVO_SIMULADO } from '../src/server/services/avisos/canales';
import { canalesDeps } from '../src/server/services/canales/deps';
import { enviarAGrupo } from '../src/server/services/canales/evolution';
import { CUENTAS_DEMO } from '../src/server/services/demo/cuentas';
import { fijarModoDemo } from '../src/server/services/demo/estado';
import { reinicioDeHoy, tocaReiniciar } from '../src/server/services/demo/reinicio';

let D: Datos;
let base: string;
let cerrar: () => Promise<void>;
let T: { adminA: string; superadmin: string; prop1: string };

before(async () => {
  D = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, password: 100_000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), superadmin: await login(base, 'super@test.pe'), prop1: await login(base, 'prop1@test.pe') };
});
after(async () => {
  await fijarModoDemo(false);
  await cerrar();
  await prisma.$disconnect();
});

const ENV_OK: NodeJS.ProcessEnv = { RESEND_API_KEY: 're_CLAVE-FALSA', MAIL_FROM: 'Casa <avisos@ejemplo.test>', EVOLUTION_URL: 'https://evo.ejemplo.test', EVOLUTION_APIKEY: 'evo-CLAVE-FALSA' };

/** Dependencias de envío que CUENTAN las llamadas a la red (nunca salen). */
function depsContando() {
  const llamadas: string[] = [];
  const deps: DepsAvisos = {
    ahora: () => new Date(),
    env: ENV_OK,
    esperar: async () => undefined,
    azar: () => 0,
    fetch: (async (url: string | URL | Request) => { llamadas.push(String(url)); return new Response('{}', { status: 200 }); }) as typeof fetch,
  };
  return { deps, llamadas };
}

describe('Demo: SIN el modo demostración nada cambia (producción)', () => {
  beforeEach(async () => { await fijarModoDemo(false); });

  it('/api/demo/* responde 404 (estado, entrar y reiniciar)', async () => {
    assert.equal((await llamar(base, 'GET', '/api/demo/estado', null)).status, 404);
    assert.equal((await llamar(base, 'POST', '/api/demo/entrar', null, { rol: 'administradora' })).status, 404);
    assert.equal((await llamar(base, 'POST', '/api/demo/reiniciar', T.superadmin, {})).status, 404);
  });

  it('el correo y el WhatsApp salen como siempre (con las llamadas de la prueba)', async () => {
    const c = depsContando();
    assert.equal((await enviarCorreo(c.deps, 'a@ejemplo.test', 'Asunto', 'Cuerpo')).resultado, 'ok');
    assert.equal((await enviarWhatsapp(c.deps, 'inst', '987654321', 'Hola')).resultado, 'ok');
    assert.equal(c.llamadas.length, 2);
  });

  it('cambiar la contraseña, el nombre y el celular propios funciona; los tokens de API y el registro no están cerrados por la demo', async () => {
    assert.equal((await llamar(base, 'PUT', '/api/me', T.prop1, { nombre: 'Propietario Uno', telefono: '900000123' })).status, 200);
    const nueva = 'Otra-clave-segura-123!';
    assert.equal((await llamar(base, 'PUT', '/api/me/password', T.prop1, { actual: PASSWORD, nueva })).status, 200);
    await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { password_hash: (await prisma.usuario.findUniqueOrThrow({ where: { id: D.adminA.id }, omit: { password_hash: false } })).password_hash } }); // la devuelve a PASSWORD
    const tokens = await llamar(base, 'POST', '/api/me/tokens-api', T.adminA, { nombre: 'prueba' });
    assert.notEqual(tokens.body?.code, 'DEMO');
    const registro = await llamar(base, 'POST', '/api/publico/registro', null, {});
    assert.notEqual(registro.body?.code, 'DEMO');
  });
});

describe('Demo: con el modo demostración, nada sale de la máquina', () => {
  beforeEach(async () => { await fijarModoDemo(true); });

  it('correo y WhatsApp: 0 llamadas a la red y quedan «simulados» (sin pausa anti-baneo)', async () => {
    const c = depsContando();
    let pausas = 0;
    assert.deepEqual(await enviarCorreo(c.deps, 'a@ejemplo.test', 'Asunto', 'Cuerpo'), { resultado: 'omitida', motivo: MOTIVO_SIMULADO });
    assert.deepEqual(await enviarWhatsapp(c.deps, 'inst', '987654321', 'Hola', async () => { pausas++; }), { resultado: 'omitida', motivo: MOTIVO_SIMULADO });
    assert.equal(c.llamadas.length, 0);
    assert.equal(pausas, 0);
  });

  it('la cola de avisos deja la fila omitida con el motivo «Simulado» y no toca la red', async () => {
    const c = depsContando();
    const n = await prisma.notificacion.create({ data: { usuario_id: D.propietario1.id, canal: 'email', tipo: 'comunicado', asunto: 'Hola', cuerpo: 'Un comunicado de prueba', estado: 'pendiente', programada_para: new Date(Date.now() - 60_000) } });
    const r = await procesarCola(c.deps);
    assert.equal(r.enviadas, 0);
    assert.equal(r.omitidas, 1);
    assert.equal(c.llamadas.length, 0);
    const fila = await prisma.notificacion.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(fila.estado, 'omitida');
    assert.equal(fila.error, MOTIVO_SIMULADO);
  });

  it('un mensaje a un grupo de WhatsApp «sale» sin llamar a Evolution', async () => {
    const antes = { fetch: canalesDeps.fetch, env: canalesDeps.env };
    const llamadas: string[] = [];
    canalesDeps.fetch = (async (url: string | URL | Request) => { llamadas.push(String(url)); return new Response('{}', { status: 200 }); }) as typeof fetch;
    canalesDeps.env = ENV_OK;
    try {
      assert.deepEqual(await enviarAGrupo('demo-torre', '120363000000000001@g.us', 'Hola vecinos'), { resultado: 'ok' });
      assert.equal(llamadas.length, 0);
    } finally {
      canalesDeps.fetch = antes.fetch;
      canalesDeps.env = antes.env;
    }
  });

  it('el WhatsApp de la pantalla está «conectado» con un número de ejemplo, sin Evolution', async () => {
    const st = await llamar(base, 'GET', '/api/whatsapp/status', T.adminA);
    assert.equal(st.status, 200);
    assert.equal(st.body.connected, true);
    assert.equal(st.body.status, 'open');
    assert.match(st.body.numero, /^51900/);
    const sync = await llamar(base, 'POST', '/api/whatsapp/sync', T.adminA, {});
    assert.equal(sync.status, 200);
    assert.equal(sync.body.status, 'open');
    assert.equal(sync.body.qr, null);
    const des = await llamar(base, 'DELETE', '/api/whatsapp/disconnect', T.adminA);
    assert.equal(des.status, 403);
    assert.equal(des.body.code, 'DEMO');
  });

  it('no se cambian claves, correos ni celulares, ni se crean tokens, empresas, registros, llavero, chat de IA ni «Entrar como»', async () => {
    const antes = await prisma.usuario.findMany({ where: { id: { in: [D.adminA.id, D.propietario1.id, D.mantenimientoA.id] } }, omit: { password_hash: false }, orderBy: { id: 'asc' } });
    const casos: [string, string, string, unknown?][] = [
      ['prop1', 'PUT', '/api/me/password', { actual: PASSWORD, nueva: 'Otra-clave-segura-123!' }],
      ['prop1', 'PUT', '/api/me', { nombre: 'Otro', telefono: '900000999' }],
      ['adminA', 'POST', '/api/me/tokens-api', { nombre: 'mcp' }],
      ['adminA', 'POST', '/api/ai-chat', { mensaje: 'hola' }],
      ['adminA', 'PUT', `/api/usuarios/${D.mantenimientoA.id}`, { email: 'real@gmail.com' }],
      ['adminA', 'PUT', `/api/usuarios/${D.mantenimientoA.id}`, { telefono: '987654321' }],
      ['adminA', 'PATCH', `/api/usuarios/${D.mantenimientoA.id}`, { password: 'Una-clave-nueva-1!' }],
      ['adminA', 'PUT', `/api/unidades/${D.unidadA1.id}/personas/1`, { celular: '987654321' }],
      ['superadmin', 'POST', '/api/empresas', { nombre: 'Empresa nueva' }],
      ['superadmin', 'POST', '/api/impersonacion', { usuario_id: D.propietario1.id, motivo: 'probar' }],
      ['superadmin', 'POST', '/api/llavero/gateways', {}],
      ['superadmin', 'PUT', '/api/llavero/gemini', { clave: 'x' }],
      ['adminA', 'POST', '/api/me/canales/whatsapp/codigo', {}],
      ['', 'POST', '/api/publico/registro', { email: 'nuevo@ejemplo.test' }],
      ['', 'POST', '/api/publico/contacto', { nombre: 'x' }],
      ['', 'POST', '/api/publico/reclamaciones', {}],
    ];
    for (const [quien, metodo, ruta, cuerpo] of casos) {
      const r = await llamar(base, metodo, ruta, quien ? T[quien as keyof typeof T] : null, cuerpo);
      assert.equal(r.status, 403, `${metodo} ${ruta} debía responder 403 (respondió ${r.status})`);
      assert.equal(r.body?.code, 'DEMO', `${metodo} ${ruta} debía traer code DEMO`);
    }
    const despues = await prisma.usuario.findMany({ where: { id: { in: [D.adminA.id, D.propietario1.id, D.mantenimientoA.id] } }, omit: { password_hash: false }, orderBy: { id: 'asc' } });
    assert.deepEqual(despues.map((u) => [u.email, u.telefono, u.password_hash]), antes.map((u) => [u.email, u.telefono, u.password_hash]));
    assert.equal(await prisma.empresaAdministradora.count({ where: { nombre: 'Empresa nueva' } }), 0);
  });

  it('lo demás sigue funcionando: editar el nombre de una persona no lo bloquea el candado', async () => {
    const r = await llamar(base, 'PUT', `/api/usuarios/${D.mantenimientoA.id}`, T.adminA, { nombre: 'Mantenimiento Renombrado' });
    assert.notEqual(r.body?.code, 'DEMO');
    assert.equal(r.status, 200);
  });
});

describe('Demo: entrar por rol', () => {
  beforeEach(async () => { await fijarModoDemo(true); });

  it('GET /api/demo/estado dice que es una demo y lista los roles', async () => {
    const r = await llamar(base, 'GET', '/api/demo/estado', null);
    assert.equal(r.status, 200);
    assert.equal(r.body.demo, true);
    assert.deepEqual(r.body.roles, ['administradora', 'tesorero_block', 'presidente_central', 'propietario_al_dia', 'propietario_moroso', 'inquilino', 'seguridad', 'mantenimiento']);
    assert.match(r.body.reinicia_a_las, /^03:00/);
  });

  it('POST /api/demo/entrar abre sesión con la cuenta del rol, sin contraseña; sin esa cuenta responde 503; un rol inventado, 422', async () => {
    assert.equal((await llamar(base, 'POST', '/api/demo/entrar', null, { rol: 'administradora' })).status, 503); // la demo aún no está sembrada
    await prisma.usuario.create({ data: { nombre: CUENTAS_DEMO.administradora.nombre, email: CUENTAS_DEMO.administradora.email, rol: 'admin', empresa_id: D.empresaA.id } });
    const r = await llamar(base, 'POST', '/api/demo/entrar', null, { rol: 'administradora' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, CUENTAS_DEMO.administradora.email);
    assert.equal(r.body.user.rol, 'admin');
    assert.ok(r.body.csrf);
    const yo = await llamar(base, 'GET', '/api/auth/me', credenciales(cookieDe(r), r.body.csrf));
    assert.equal(yo.status, 200);
    assert.equal(yo.body.email, CUENTAS_DEMO.administradora.email);
    assert.equal((await llamar(base, 'POST', '/api/demo/entrar', null, { rol: 'superadmin' })).status, 422);
    assert.equal((await llamar(base, 'POST', '/api/demo/entrar', null, { rol: 'administradora', extra: 1 })).status, 422);
    assert.equal((await prisma.auditoria.count({ where: { accion: 'login_demo' } })) >= 1, true);
  });

  it('la entrada tiene límite por IP', async () => {
    const { base: b2, cerrar: c2 } = await iniciar({ rateLimits: { api: 100_000 }, demo: { limiteEntrar: 3 } });
    try {
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) estados.push((await llamar(b2, 'POST', '/api/demo/entrar', null, { rol: 'inquilino' })).status);
      assert.deepEqual(estados.slice(0, 3).every((s) => s !== 429), true);
      assert.equal(estados[4], 429);
    } finally {
      await c2();
    }
  });

  it('sólo el superadmin reinicia la demo', async () => {
    assert.equal((await llamar(base, 'POST', '/api/demo/reiniciar', null, {})).status, 401);
    assert.equal((await llamar(base, 'POST', '/api/demo/reiniciar', T.adminA, {})).status, 403);
  });
});

describe('Demo: cuándo toca el reinicio nocturno (3:00 de Lima)', () => {
  it('el límite de hoy son las 8:00 UTC (3:00 en Lima) y la demo se pone al día tras una caída', () => {
    assert.equal(reinicioDeHoy(new Date('2026-11-11T15:00:00Z')).toISOString(), '2026-11-11T08:00:00.000Z');
    assert.equal(tocaReiniciar(new Date('2026-11-11T09:00:00Z'), new Date('2026-11-10T20:00:00Z')), true); // 4:00 Lima, sembrada ayer
    assert.equal(tocaReiniciar(new Date('2026-11-11T09:00:00Z'), new Date('2026-11-11T08:30:00Z')), false); // ya se sembró después de las 3:00
    assert.equal(tocaReiniciar(new Date('2026-11-11T07:00:00Z'), new Date('2026-11-10T20:00:00Z')), false); // 2:00 Lima: todavía no
    assert.equal(tocaReiniciar(new Date('2026-11-11T18:00:00Z'), new Date('2026-11-09T20:00:00Z')), true); // el servidor estuvo caído: se pone al día
    assert.equal(tocaReiniciar(new Date('2026-11-11T09:00:00Z'), null), true); // nunca sembrada
  });
});
