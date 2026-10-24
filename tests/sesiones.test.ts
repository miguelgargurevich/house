import './helpers/env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, afterEach, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { limpiarSesiones, iniciarLimpieza, sesionDeps, INACTIVIDAD_MS, VIGENCIA_MS } from '../src/server/services/sesiones';
import { cookieDe, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos, type Respuesta } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, password: 100_000 } }));
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const relojReal = sesionDeps.ahora;
/** Adelanta el reloj de las sesiones `ms` milisegundos respecto del real. */
const adelantar = (ms: number) => { sesionDeps.ahora = () => new Date(Date.now() + ms); };
afterEach(() => { sesionDeps.ahora = relojReal; });

const MIN = 60_000;
const HORA = 60 * MIN;
const cookieHeader = (t: string) => ({ cookie: `house_sesion=${t.split('.')[0]}` });
const loginCrudo = (email: string): Promise<Respuesta> => llamar(base, 'POST', '/api/auth/login', null, { email, password: PASSWORD });
const nuevoUsuario = (email: string, rol = 'inquilino') =>
  prisma.usuario.create({ data: { nombre: email, email, rol, password_hash: bcrypt.hashSync(PASSWORD, 4), empresa_id: d.empresaA.id } });

describe('cookie de sesión', () => {
  it('el login entrega house_sesion con HttpOnly, SameSite=Lax y Path=/ (sin Secure fuera de producción)', async () => {
    const r = await loginCrudo('prop1@test.pe');
    const c = r.headers.get('set-cookie') ?? '';
    assert.match(c, /^house_sesion=[\w-]{43};/);
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=Lax/i);
    assert.match(c, /Path=\//);
    assert.doesNotMatch(c, /Secure/i);
    assert.doesNotMatch(c, /csrf/i); // el token CSRF no va en cookie legible
    assert.equal(r.body.token, undefined);
  });

  it('en producción la cookie lleva Secure', async () => {
    process.env.NODE_ENV = 'production';
    try {
      const c = (await loginCrudo('prop1@test.pe')).headers.get('set-cookie') ?? '';
      assert.match(c, /; Secure/i);
      assert.match(c, /HttpOnly/i);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('en la base sólo queda el sha256 del token, no el token', async () => {
    const r = await loginCrudo('prop2@test.pe');
    const token = cookieDe(r);
    const fila = await prisma.sesion.findFirstOrThrow({ where: { token_hash: createHash('sha256').update(token).digest('hex') } });
    assert.equal(fila.usuario_id, d.propietario2.id);
    assert.equal(fila.csrf_token, r.body.csrf);
    assert.notEqual(fila.token_hash, token);
    assert.equal(fila.expira_at.getTime() - fila.created_at.getTime(), VIGENCIA_MS);
  });

  it('sin cookie → 401 y el Authorization: Bearer ya no sirve (ni con un JWT de verdad)', async () => {
    assert.equal((await llamar(base, 'GET', '/api/auth/me')).status, 401);
    const s = await login(base, 'prop1@test.pe');
    const token = s.split('.')[0];
    assert.equal((await llamar(base, 'GET', '/api/auth/me', null, undefined, { authorization: `Bearer ${token}` })).status, 401);
  });
});

describe('CSRF y origen', () => {
  it('una mutación sin X-CSRF-Token → 403 con mensaje claro; con el token correcto pasa', async () => {
    const s = await login(base, 'prop1@test.pe');
    const sinCsrf = await llamar(base, 'PUT', '/api/me', null, { nombre: 'Nuevo', telefono: '' }, cookieHeader(s));
    assert.equal(sinCsrf.status, 403);
    assert.match(sinCsrf.body.error, /CSRF/);
    assert.equal((await llamar(base, 'PUT', '/api/me', s, { nombre: 'Propietario 1', telefono: '' })).status, 200);
  });

  it('el token CSRF de otra sesión (u otro texto) → 403', async () => {
    const a = await login(base, 'prop1@test.pe');
    const b = await login(base, 'prop2@test.pe');
    const csrfAjeno = b.split('.')[1]!;
    for (const csrf of [csrfAjeno, 'x', '']) {
      const r = await llamar(base, 'PUT', '/api/me', null, { nombre: 'X', telefono: '' }, { ...cookieHeader(a), 'x-csrf-token': csrf });
      assert.equal(r.status, 403, `csrf "${csrf.slice(0, 5)}"`);
    }
  });

  it('las lecturas (GET) no exigen CSRF', async () => {
    const s = await login(base, 'prop1@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/me/unidades', null, undefined, cookieHeader(s))).status, 200);
  });

  it('Origin distinto del Host → 403 aunque el CSRF sea válido; el propio origen pasa', async () => {
    const s = await login(base, 'prop1@test.pe');
    const cuerpo = { nombre: 'Propietario 1', telefono: '' };
    assert.equal((await llamar(base, 'PUT', '/api/me', s, cuerpo, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/me', s, cuerpo, { origin: 'null' })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/me', s, cuerpo, { referer: 'https://evil.example/pagina' })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/me', s, cuerpo, { origin: base })).status, 200);
    assert.equal((await llamar(base, 'PUT', '/api/me', s, cuerpo, { referer: `${base}/perfil` })).status, 200);
  });

  it('un origen listado en CORS_ORIGIN también se acepta', async () => {
    process.env.CORS_ORIGIN = 'https://app.example';
    try {
      const s = await login(base, 'prop1@test.pe');
      assert.equal((await llamar(base, 'PUT', '/api/me', s, { nombre: 'Propietario 1', telefono: '' }, { origin: 'https://app.example' })).status, 200);
      assert.equal((await llamar(base, 'PUT', '/api/me', s, { nombre: 'Propietario 1', telefono: '' }, { origin: 'https://evil.example' })).status, 403);
    } finally {
      delete process.env.CORS_ORIGIN;
    }
  });

  it('el login no exige CSRF (no hay sesión todavía)', async () => {
    assert.equal((await loginCrudo('prop1@test.pe')).status, 200);
  });
});

describe('vida de la sesión', () => {
  it('logout revoca la sesión en la base, borra la cookie y deja de servir', async () => {
    const s = await login(base, 'inq1@test.pe');
    const r = await llamar(base, 'POST', '/api/auth/logout', s, {});
    assert.equal(r.status, 204);
    assert.match(r.headers.get('set-cookie') ?? '', /house_sesion=;.*(Expires=Thu, 01 Jan 1970|Max-Age=0)/i);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', s)).status, 401);
    const hash = createHash('sha256').update(s.split('.')[0]!).digest('hex');
    assert.ok((await prisma.sesion.findUniqueOrThrow({ where: { token_hash: hash } })).revocada_at);
  });

  it('una sesión revocada en la base → 401', async () => {
    const s = await login(base, 'inq1@test.pe');
    await prisma.sesion.updateMany({ where: { usuario_id: d.inquilino1.id }, data: { revocada_at: new Date() } });
    assert.equal((await llamar(base, 'GET', '/api/auth/me', s)).status, 401);
  });

  it('caduca a las 12 h absolutas aunque se use todo el rato', async () => {
    const s = await login(base, 'inq1@test.pe');
    for (const h of [1.5, 3, 4.5, 6, 7.5, 9, 10.5, 11.5]) {
      adelantar(h * HORA);
      assert.equal((await llamar(base, 'GET', '/api/auth/me', s)).status, 200, `a las ${h} h`);
    }
    adelantar(12 * HORA + MIN);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', s)).status, 401);
  });

  it('caduca tras 2 h sin uso, y el uso desliza esa ventana', async () => {
    const inactiva = await login(base, 'inq1@test.pe');
    adelantar(INACTIVIDAD_MS + MIN);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', inactiva)).status, 401);

    sesionDeps.ahora = relojReal;
    const viva = await login(base, 'inq1@test.pe');
    adelantar(90 * MIN);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', viva)).status, 200); // desliza
    adelantar(3 * HORA - 5 * MIN); // 3 h tras el login pero 1 h 25 tras el último uso
    assert.equal((await llamar(base, 'GET', '/api/auth/me', viva)).status, 200);
  });

  it('ultimo_uso_at se actualiza como mucho cada 60 s', async () => {
    const s = await login(base, 'inq1@test.pe');
    const hash = createHash('sha256').update(s.split('.')[0]!).digest('hex');
    const uso = async () => (await prisma.sesion.findUniqueOrThrow({ where: { token_hash: hash } })).ultimo_uso_at.getTime();
    const t0 = await uso();
    adelantar(30_000);
    await llamar(base, 'GET', '/api/auth/me', s);
    assert.equal(await uso(), t0, 'a los 30 s no escribe');
    adelantar(61_000);
    await llamar(base, 'GET', '/api/auth/me', s);
    assert.ok((await uso()) > t0, 'a los 61 s sí escribe');
  });

  it('la limpieza borra revocadas, vencidas e inactivas y deja las activas', async () => {
    await prisma.sesion.deleteMany();
    const viva = await login(base, 'inq1@test.pe');
    const revocada = await login(base, 'inq1@test.pe');
    await llamar(base, 'POST', '/api/auth/logout', revocada, {});
    const antiguo = new Date(Date.now() - 20 * HORA);
    await prisma.sesion.create({ data: { usuario_id: d.inquilino1.id, token_hash: 'vencida', csrf_token: 'c', expira_at: antiguo } });
    await prisma.sesion.create({ data: { usuario_id: d.inquilino1.id, token_hash: 'inactiva', csrf_token: 'c', ultimo_uso_at: antiguo, expira_at: new Date(Date.now() + HORA) } });
    assert.equal(await limpiarSesiones(), 3);
    assert.equal(await prisma.sesion.count(), 1);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', viva)).status, 200);
  });

  it('SESIONES_LIMPIEZA=off desactiva la tarea periódica (y sin la variable arranca)', () => {
    assert.equal(iniciarLimpieza(process.env), null);
    const t = iniciarLimpieza({});
    assert.ok(t);
    clearInterval(t);
  });
});

describe('revocación por cambios de cuenta', () => {
  it('cambiar la contraseña revoca las demás sesiones y conserva la actual', async () => {
    const u = await nuevoUsuario('cambia.clave@test.pe');
    const a = await login(base, u.email);
    const b = await login(base, u.email);
    const r = await llamar(base, 'PUT', '/api/me/password', a, { actual: PASSWORD, nueva: 'OtraClave!456' });
    assert.equal(r.status, 200);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', a)).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', b)).status, 401);
  });

  it('eliminar al usuario borra sus sesiones y la cookie deja de servir', async () => {
    const u = await nuevoUsuario('se.va@test.pe');
    const s = await login(base, u.email);
    assert.equal(await prisma.sesion.count({ where: { usuario_id: u.id } }), 1);
    const admin = await login(base, 'admin.a@test.pe');
    assert.equal((await llamar(base, 'DELETE', `/api/usuarios/${u.id}`, admin)).status, 204);
    assert.equal(await prisma.sesion.count({ where: { usuario_id: u.id } }), 0);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', s)).status, 401);
  });

  it('cambiarle el rol (o la contraseña) a alguien cierra sus sesiones; editar otro dato no', async () => {
    const u = await nuevoUsuario('cambia.rol@test.pe');
    const admin = await login(base, 'admin.a@test.pe');
    const s1 = await login(base, u.email);
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${u.id}`, admin, { nombre: 'Otro nombre' })).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', s1)).status, 200);
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${u.id}`, admin, { rol: 'propietario' })).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', s1)).status, 401);

    const s2 = await login(base, u.email);
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${u.id}`, admin, { password: 'ClaveNueva!789' })).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', s2)).status, 401);
  });
});

describe('gestión de mis sesiones', () => {
  it('GET /api/auth/sesiones lista sólo las mías y activas, marca la actual y no filtra secretos', async () => {
    const u = await nuevoUsuario('lista@test.pe');
    const a = await login(base, u.email);
    const b = await login(base, u.email);
    await login(base, 'prop1@test.pe'); // de otro usuario: no debe aparecer
    const r = await llamar(base, 'GET', '/api/auth/sesiones', b);
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 2);
    assert.equal(r.body.filter((s: { actual: boolean }) => s.actual).length, 1);
    assert.deepEqual(Object.keys(r.body[0]).sort(), ['actual', 'creada', 'id', 'ip', 'ultimo_uso', 'user_agent']);
    assert.ok(!/token|csrf/i.test(r.texto));
    await llamar(base, 'POST', '/api/auth/logout', a, {});
    assert.equal((await llamar(base, 'GET', '/api/auth/sesiones', b)).body.length, 1);
  });

  it('DELETE /api/auth/sesiones/:id revoca una mía; una ajena o inexistente → 404 y sigue viva', async () => {
    const u = await nuevoUsuario('revoca@test.pe');
    const a = await login(base, u.email);
    const b = await login(base, u.email);
    const ajena = await login(base, 'prop1@test.pe');
    const idAjena = (await llamar(base, 'GET', '/api/auth/sesiones', ajena)).body[0].id;
    assert.equal((await llamar(base, 'DELETE', `/api/auth/sesiones/${idAjena}`, b)).status, 404);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', ajena)).status, 200);
    assert.equal((await llamar(base, 'DELETE', '/api/auth/sesiones/no-existe', b)).status, 404);

    const idA = (await llamar(base, 'GET', '/api/auth/sesiones', b)).body.find((s: { actual: boolean }) => !s.actual).id;
    assert.equal((await llamar(base, 'DELETE', `/api/auth/sesiones/${idA}`, b)).status, 204);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', a)).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', b)).status, 200);
  });

  it('POST /api/auth/sesiones/cerrar-otras cierra todas menos la actual y no toca a otros usuarios', async () => {
    const u = await nuevoUsuario('cierra.otras@test.pe');
    const a = await login(base, u.email);
    const b = await login(base, u.email);
    const c = await login(base, u.email);
    const otro = await login(base, 'prop1@test.pe');
    const r = await llamar(base, 'POST', '/api/auth/sesiones/cerrar-otras', b, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.cerradas, 2);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', a)).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', c)).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', b)).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', otro)).status, 200);
  });

  it('GET /api/auth/me devuelve el csrf de la sesión vigente', async () => {
    const s = await login(base, 'prop1@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/auth/me', s)).body.csrf, s.split('.')[1]);
  });
});
