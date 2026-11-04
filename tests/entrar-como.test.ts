import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { limpiarSesiones, sesionDeps } from '../src/server/services/sesiones';
import { cookieDe, esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos, type Respuesta } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;

before(async () => {
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, apiUsuario: 100_000, login: 100_000, password: 100_000 } }));
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  d = await sembrar();
});

const relojReal = sesionDeps.ahora;
afterEach(() => { sesionDeps.ahora = relojReal; });
/** Adelanta el reloj de las sesiones `ms` respecto del real. */
const adelantar = (ms: number) => { sesionDeps.ahora = () => new Date(Date.now() + ms); };

const MIN = 60_000;
const HORA = 60 * MIN;
const MOTIVO = 'Soporte: la vecina no ve su recibo';
const MENSAJE = 'No disponible mientras ves Torre como otra persona';

/** «Cookie.csrf» de la sesión que devolvió una respuesta (la prestada, o la restaurada). */
const sesionDe = (r: Respuesta) => `${cookieDe(r)}.${r.body.csrf}`;
const cookieRealDe = (r: Respuesta) => /house_sesion_real=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
const entrar = (superToken: string, usuario_id: number, motivo: string = MOTIVO) => llamar(base, 'POST', '/api/impersonacion', superToken, { usuario_id, motivo });
/** Sale con la cookie real (lo que haría el navegador en `/api/impersonacion/salir`). */
const salir = (prestada: string, cookieReal: string | null) =>
  llamar(base, 'POST', '/api/impersonacion/salir', prestada, {}, cookieReal === null ? {} : { cookie: `house_sesion=${prestada.split('.')[0]}; house_sesion_real=${cookieReal}` });

/** El superadmin entra como `usuario_id`; devuelve todo lo necesario para las pruebas. */
async function entrarComo(usuario_id: number) {
  const real = await login(base, 'super@test.pe');
  const r = await entrar(real, usuario_id);
  assert.equal(r.status, 200, r.texto);
  return { real, r, prestada: sesionDe(r), cookieReal: cookieRealDe(r) };
}

describe('quién puede entrar y a quién', () => {
  it('el superadmin entra como un propietario: la respuesta trae al objetivo y la cookie pasa a la sesión prestada', async () => {
    const real = await login(base, 'super@test.pe');
    const r = await entrar(real, d.propietario1.id);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.user.id, d.propietario1.id);
    assert.equal(r.body.user.rol, 'propietario');
    assert.equal(r.body.impersonando.por.id, d.superadmin.id);
    assert.equal(r.body.impersonando.motivo, MOTIVO);
    assert.notEqual(cookieDe(r), real.split('.')[0]);
    const c = r.headers.get('set-cookie') ?? '';
    assert.match(c, /house_sesion_real=[^;]+; Max-Age=\d+; Path=\/api\/impersonacion; Expires=[^;]+; HttpOnly/i);
    assert.doesNotMatch(JSON.stringify(r.body), new RegExp(cookieDe(r))); // el token nunca va en el cuerpo
  });

  it('admin y propietario no pueden iniciar (403)', async () => {
    for (const email of ['admin.a@test.pe', 'prop1@test.pe']) {
      const t = await login(base, email);
      const r = await entrar(t, d.propietario2.id);
      assert.equal(r.status, 403, `${email}: ${r.texto}`);
    }
    assert.equal(await prisma.impersonacion.count(), 0);
  });

  it('sin sesión: 401', async () => {
    assert.equal((await entrar('', d.propietario1.id)).status, 401);
  });

  it('no se puede entrar como otro superadmin (403)', async () => {
    const otro = await prisma.usuario.create({ data: { nombre: 'Otro Super', email: 'otro.super@test.pe', rol: 'superadmin', password_hash: bcrypt.hashSync(PASSWORD, 4) } });
    const real = await login(base, 'super@test.pe');
    assert.equal((await entrar(real, otro.id)).status, 403);
    assert.equal((await entrar(real, d.superadmin.id)).status, 403); // ni como uno mismo
    assert.equal(await prisma.impersonacion.count(), 0);
  });

  it('usuario inexistente: 404; cuenta sin confirmar el correo: 422', async () => {
    const real = await login(base, 'super@test.pe');
    assert.equal((await entrar(real, 99999)).status, 404);
    const sinConfirmar = await prisma.usuario.create({ data: { nombre: 'Sin confirmar', email: 'sc@test.pe', rol: 'admin', empresa_id: d.empresaA.id, correo_verificado: false } });
    assert.equal((await entrar(real, sinConfirmar.id)).status, 422);
  });

  it('el motivo es obligatorio: ausente, vacío, de 4 caracteres o de más de 200 → 422', async () => {
    const real = await login(base, 'super@test.pe');
    assert.equal((await llamar(base, 'POST', '/api/impersonacion', real, { usuario_id: d.propietario1.id })).status, 422);
    for (const motivo of ['', '   ', 'abcd', 'x'.repeat(201)]) assert.equal((await entrar(real, d.propietario1.id, motivo)).status, 422, `motivo «${motivo.slice(0, 10)}»`);
    assert.equal((await entrar(real, d.propietario1.id, 'abcde')).status, 200); // 5 es el mínimo
    assert.equal(await prisma.impersonacion.count(), 1);
  });

  it('desde una sesión prestada no se puede iniciar otra (403, sin encadenar)', async () => {
    const { prestada } = await entrarComo(d.adminA.id);
    const r = await entrar(prestada, d.propietario1.id);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, MENSAJE);
    assert.equal(await prisma.impersonacion.count(), 1);
  });

  it('exige el token CSRF para iniciar y para salir', async () => {
    const real = await login(base, 'super@test.pe');
    const sinCsrf = await llamar(base, 'POST', '/api/impersonacion', real.split('.')[0], { usuario_id: d.propietario1.id, motivo: MOTIVO });
    assert.equal(sinCsrf.status, 403);
    assert.match(sinCsrf.body.error, /CSRF/);
    assert.equal(await prisma.impersonacion.count(), 0);
    const { prestada, cookieReal } = await entrarComo(d.propietario1.id);
    const r = await llamar(base, 'POST', '/api/impersonacion/salir', prestada.split('.')[0], {}, { cookie: `house_sesion=${prestada.split('.')[0]}; house_sesion_real=${cookieReal}` });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /CSRF/);
    const abierta = await prisma.impersonacion.findFirstOrThrow();
    assert.equal(abierta.fin_at, null); // no se cerró
  });

  it('entrar como una cuenta SIN contraseña (importada por Excel, correo .invalid) funciona igual', async () => {
    const importada = await prisma.usuario.create({ data: { nombre: 'Vecina Importada', email: 'b1-804@sin-correo.invalid', rol: 'propietario', complejo_id: d.complejoA.id } });
    const real = await login(base, 'super@test.pe');
    const r = await entrar(real, importada.id);
    assert.equal(r.status, 200, r.texto);
    const me = await llamar(base, 'GET', '/api/auth/me', sesionDe(r));
    assert.equal(me.status, 200);
    assert.equal(me.body.id, importada.id);
    assert.equal(me.body.impersonando.por.nombre, 'Super');
  });
});

describe('la sesión prestada', () => {
  it('ve Torre como el objetivo y `/auth/me` dice quién entró, el motivo y cuándo termina', async () => {
    const { prestada, r } = await entrarComo(d.propietario1.id);
    const unidades = await llamar(base, 'GET', '/api/me/unidades', prestada);
    assert.equal(unidades.status, 200);
    assert.deepEqual(unidades.body.items.map((u: { codigo: string }) => u.codigo), ['A-101']);
    const me = await llamar(base, 'GET', '/api/auth/me', prestada);
    assert.equal(me.body.id, d.propietario1.id);
    assert.equal(me.body.rol, 'propietario');
    assert.deepEqual(me.body.impersonando.por, { id: d.superadmin.id, nombre: 'Super' });
    assert.equal(me.body.impersonando.motivo, MOTIVO);
    assert.equal(me.body.impersonando.expira_at, r.body.impersonando.expira_at);
  });

  it('una sesión normal NO trae `impersonando`', async () => {
    const t = await login(base, 'prop1@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).body.impersonando, null);
  });

  it('no puede cambiar contraseña, nombre/celular, tokens de API ni tocar sesiones (403 con mensaje claro)', async () => {
    const { prestada } = await entrarComo(d.adminA.id);
    const hash = (await prisma.usuario.findUniqueOrThrow({ where: { id: d.adminA.id }, omit: { password_hash: false } })).password_hash;
    const pruebas: [string, string, unknown?][] = [
      ['PUT', '/api/me/password', { actual: PASSWORD, nueva: 'OtraClave!456xyz' }],
      ['PUT', '/api/me', { nombre: 'Otro nombre', telefono: '987654321' }],
      ['PUT', '/api/me/avisos', { aviso_email: true, aviso_whatsapp: false, telefono: '987654321' }],
      ['POST', '/api/me/tokens-api', { nombre: 'mio' }],
      ['DELETE', '/api/me/tokens-api/abc'],
      ['GET', '/api/auth/sesiones'],
      ['POST', '/api/auth/sesiones/cerrar-otras', {}],
      ['DELETE', '/api/auth/sesiones/abc'],
      ['POST', '/api/auth/logout', {}],
      ['PUT', `/api/usuarios/${d.adminA.id}`, { password: 'OtraClave!456xyz' }],
      ['PUT', `/api/usuarios/${d.adminA.id}`, { email: 'nuevo@test.pe' }],
      ['PUT', `/api/usuarios/${d.adminA.id}`, { telefono: '987654321' }],
      ['GET', '/api/impersonacion'],
      ['GET', '/api/ai-chat/conversaciones'],
      ['GET', '/api/me/canales'],
      ['POST', '/api/me/canales/whatsapp/codigo', {}],
    ];
    for (const [m, ruta, cuerpo] of pruebas) {
      const r = await llamar(base, m, ruta, prestada, cuerpo);
      assert.equal(r.status, 403, `${m} ${ruta}: ${r.texto}`);
      assert.equal(r.body.error, MENSAJE, `${m} ${ruta}`);
    }
    const ahora = await prisma.usuario.findUniqueOrThrow({ where: { id: d.adminA.id }, omit: { password_hash: false } });
    assert.equal(ahora.password_hash, hash);
    assert.equal(ahora.email, 'admin.a@test.pe');
    assert.equal(ahora.telefono, null);
    assert.equal(await prisma.tokenApi.count(), 0);
  });

  it('los avisos se pueden ver y ajustar mientras no cambie el celular', async () => {
    const { prestada } = await entrarComo(d.propietario1.id);
    const r = await llamar(base, 'PUT', '/api/me/avisos', prestada, { aviso_email: false, aviso_whatsapp: false });
    assert.equal(r.status, 200, r.texto);
  });

  it('lo demás sí se permite: el admin crea una tarea como siempre', async () => {
    const { prestada } = await entrarComo(d.adminA.id);
    const r = await llamar(base, 'POST', '/api/tareas', prestada, { titulo: 'Revisar la bomba' });
    assert.equal(r.status, 201, r.texto);
  });

  it('lo de superadmin le está vedado (el objetivo no es superadmin): auditoría, empresas', async () => {
    const { prestada } = await entrarComo(d.adminA.id);
    assert.equal((await llamar(base, 'GET', '/api/auditoria', prestada)).status, 403);
    assert.equal((await llamar(base, 'POST', '/api/empresas', prestada, { nombre: 'Nueva' })).status, 403);
  });

  it('si el objetivo pasa a ser superadmin mientras tanto, la sesión prestada cae (401) y la entrada se cierra como revocada', async () => {
    const { prestada } = await entrarComo(d.adminA.id);
    await prisma.usuario.update({ where: { id: d.adminA.id }, data: { rol: 'superadmin' } });
    assert.equal((await llamar(base, 'GET', '/api/auth/me', prestada)).status, 401);
    const imp = await prisma.impersonacion.findFirstOrThrow();
    assert.equal(imp.fin_motivo, 'revocada');
    assert.ok(imp.fin_at);
  });

  it('si el superadmin deja de serlo, la sesión prestada cae (401)', async () => {
    const { prestada } = await entrarComo(d.adminA.id);
    await prisma.usuario.update({ where: { id: d.superadmin.id }, data: { rol: 'admin', empresa_id: d.empresaA.id } });
    assert.equal((await llamar(base, 'GET', '/api/auth/me', prestada)).status, 401);
    assert.equal((await prisma.impersonacion.findFirstOrThrow()).fin_motivo, 'revocada');
  });

  it('si la sesión real del superadmin se revoca (cierra sesión en otra pestaña), la prestada cae', async () => {
    const { real, prestada } = await entrarComo(d.adminA.id);
    await prisma.sesion.updateMany({ where: { usuario_id: d.superadmin.id }, data: { revocada_at: new Date() } });
    assert.equal((await llamar(base, 'GET', '/api/auth/me', prestada)).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', real)).status, 401);
    assert.equal((await prisma.impersonacion.findFirstOrThrow()).fin_motivo, 'revocada');
  });

  it('la sesión real sigue viva (no se revoca) mientras la prestada trabaja', async () => {
    const { real } = await entrarComo(d.adminA.id);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', real)).status, 200);
  });
});

describe('auditoría con los dos actores', () => {
  it('una acción hecha en sesión prestada queda con el objetivo (usuario_id) y el impersonador', async () => {
    const { prestada } = await entrarComo(d.adminA.id);
    const r = await llamar(base, 'POST', '/api/tareas', prestada, { titulo: 'Revisar la bomba' });
    assert.equal(r.status, 201);
    const imp = await prisma.impersonacion.findFirstOrThrow();
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'tarea', accion: 'crear' } }));
    assert.equal(fila.usuario_id, d.adminA.id);
    assert.equal(fila.impersonador_id, d.superadmin.id);
    assert.equal(fila.impersonacion_id, imp.id);
  });

  it('una acción hecha en sesión NORMAL no lleva impersonador', async () => {
    const t = await login(base, 'admin.a@test.pe');
    assert.equal((await llamar(base, 'POST', '/api/tareas', t, { titulo: 'Normal' })).status, 201);
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'tarea', accion: 'crear' } }));
    assert.equal(fila.usuario_id, d.adminA.id);
    assert.equal(fila.impersonador_id, null);
    assert.equal(fila.impersonacion_id, null);
  });

  it('también las filas que un handler escribe por su cuenta (no por el middleware) llevan al impersonador', async () => {
    const { prestada } = await entrarComo(d.adminA.id);
    const r = await llamar(base, 'GET', `/api/contactos/plantilla.xlsx?complejo_id=${d.complejoA.id}`, prestada);
    assert.equal(r.status, 200, r.texto);
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'descargar_plantilla_contactos' } }));
    assert.equal(fila.usuario_id, d.adminA.id);
    assert.equal(fila.impersonador_id, d.superadmin.id);
  });

  it('el inicio y el fin quedan en la auditoría con el superadmin como actor y el motivo; sin filas duplicadas', async () => {
    const { prestada, cookieReal } = await entrarComo(d.propietario1.id);
    const fin = await salir(prestada, cookieReal);
    assert.equal(fin.status, 200, fin.texto);
    const imp = await prisma.impersonacion.findFirstOrThrow();
    const filas = await prisma.auditoria.findMany({ where: { entidad: 'impersonacion' }, orderBy: { id: 'asc' } });
    assert.deepEqual(filas.map((f) => f.accion), ['impersonar_inicio', 'impersonar_fin']);
    for (const f of filas) {
      assert.equal(f.usuario_id, d.superadmin.id);
      assert.equal(f.impersonador_id, null);
      const det = f.detalle as Record<string, unknown>;
      assert.equal(det.motivo, MOTIVO);
      assert.equal(det.usuario_id, d.propietario1.id);
      assert.equal(det.impersonacion_id, imp.id);
    }
    assert.equal((filas[1]!.detalle as Record<string, unknown>).fin_motivo, 'salir');
  });
});

describe('vigencia y salida', () => {
  it('la sesión prestada dura 30 minutos: a los 31 ya no sirve y la entrada se cierra como «vencio»', async () => {
    const { prestada } = await entrarComo(d.propietario1.id);
    const imp = await prisma.impersonacion.findFirstOrThrow();
    const dura = imp.expira_at.getTime() - imp.inicio_at.getTime();
    assert.equal(dura, 30 * MIN);
    adelantar(29 * MIN);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', prestada)).status, 200);
    adelantar(31 * MIN);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', prestada)).status, 401);
    // Nadie la usó más: el fin se registra igual al consultar el historial, con la hora en que venció.
    const real = await login(base, 'super@test.pe');
    const lista = await llamar(base, 'GET', '/api/impersonacion', real);
    assert.equal(lista.status, 200, lista.texto);
    const fila = lista.body.items.find((i: { id: string }) => i.id === imp.id);
    assert.equal(fila.fin_motivo, 'vencio');
    assert.equal(new Date(fila.fin_at).getTime(), imp.expira_at.getTime());
  });

  it('el fin por vencimiento también se registra con la limpieza de sesiones, aunque borre la fila de la sesión', async () => {
    await entrarComo(d.propietario1.id);
    const imp = await prisma.impersonacion.findFirstOrThrow();
    adelantar(2 * HORA);
    await limpiarSesiones();
    assert.equal(await prisma.sesion.count({ where: { id: imp.sesion_prestada_id! } }), 0);
    const cerrada = await prisma.impersonacion.findFirstOrThrow();
    assert.equal(cerrada.fin_motivo, 'vencio');
    assert.equal(cerrada.fin_at?.getTime(), imp.expira_at.getTime());
    const fila = await prisma.auditoria.findFirst({ where: { accion: 'impersonar_fin' } });
    assert.equal(fila?.usuario_id, d.superadmin.id);
    assert.equal((fila?.detalle as Record<string, unknown>).fin_motivo, 'vencio');
  });

  it('si la sesión real vence antes de 30 min, la prestada vence con ella', async () => {
    const real = await login(base, 'super@test.pe');
    const ahora = Date.now();
    await prisma.sesion.updateMany({ where: { usuario_id: d.superadmin.id }, data: { expira_at: new Date(ahora + 10 * MIN) } });
    const r = await entrar(real, d.propietario1.id);
    assert.equal(r.status, 200, r.texto);
    const imp = await prisma.impersonacion.findFirstOrThrow();
    assert.ok(Math.abs(imp.expira_at.getTime() - (ahora + 10 * MIN)) < 2000, 'tope = lo que le queda a la real');
    const maxAge = Number(/house_sesion=[^;]+; Max-Age=(\d+)/.exec(r.headers.get('set-cookie') ?? '')?.[1]);
    assert.ok(maxAge <= 600, `la cookie no dura más que la sesión real (Max-Age ${maxAge})`);
    adelantar(11 * MIN);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', sesionDe(r))).status, 401);
  });

  it('con la sesión real ya vencida no se puede ni empezar', async () => {
    const real = await login(base, 'super@test.pe');
    await prisma.sesion.updateMany({ where: { usuario_id: d.superadmin.id }, data: { expira_at: new Date(Date.now() - 1000) } });
    assert.equal((await entrar(real, d.propietario1.id)).status, 401);
  });

  it('«salir» devuelve la sesión real, cierra la entrada y revoca la prestada', async () => {
    const { real, prestada, cookieReal } = await entrarComo(d.propietario1.id);
    const r = await salir(prestada, cookieReal);
    assert.equal(r.status, 200, r.texto);
    // Antes de cualquier otra petición con la prestada (que la revocaría por su cuenta): `salir` ya la dejó revocada.
    const prestadaFila = await prisma.impersonacion.findFirstOrThrow();
    assert.ok((await prisma.sesion.findUniqueOrThrow({ where: { id: prestadaFila.sesion_prestada_id! } })).revocada_at, 'la sesión prestada queda revocada en la base');
    assert.equal(r.body.user.id, d.superadmin.id);
    assert.equal(cookieDe(r), real.split('.')[0]); // la cookie vuelve a la sesión real
    assert.equal(r.body.csrf, real.split('.')[1]);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', prestada)).status, 401); // la prestada murió
    const yo = await llamar(base, 'GET', '/api/auth/me', sesionDe(r));
    assert.equal(yo.body.id, d.superadmin.id);
    assert.equal(yo.body.impersonando, null);
    const imp = await prisma.impersonacion.findFirstOrThrow();
    assert.equal(imp.fin_motivo, 'salir');
    assert.ok(imp.fin_at);
    assert.match(r.headers.get('set-cookie') ?? '', /house_sesion_real=;/); // la cookie auxiliar se borra
  });

  it('«salir» NO alarga la sesión real: conserva su vencimiento (en la base y en la cookie)', async () => {
    const real = await login(base, 'super@test.pe');
    const antes = (await prisma.sesion.findFirstOrThrow({ where: { usuario_id: d.superadmin.id } })).expira_at;
    const e = await entrar(real, d.propietario1.id);
    adelantar(20 * MIN);
    const r = await salir(sesionDe(e), cookieRealDe(e));
    assert.equal(r.status, 200, r.texto);
    const despues = (await prisma.sesion.findFirstOrThrow({ where: { usuario_id: d.superadmin.id } })).expira_at;
    assert.equal(despues.getTime(), antes.getTime());
    const maxAge = Number(/house_sesion=[^;]+; Max-Age=(\d+)/.exec(r.headers.get('set-cookie') ?? '')?.[1]);
    const quedan = Math.floor((antes.getTime() - sesionDeps.ahora().getTime()) / 1000);
    assert.ok(maxAge <= quedan && maxAge > quedan - 5, `Max-Age ${maxAge} ≈ lo que queda (${quedan} s), no 12 h`);
  });

  it('«salir» con la sesión real revocada → 401 y NO la restaura', async () => {
    const { prestada, cookieReal } = await entrarComo(d.propietario1.id);
    // Revocada en la base justo antes de salir (la prestada sigue viva sólo porque la validación se hizo antes).
    const imp = await prisma.impersonacion.findFirstOrThrow();
    // Para llegar hasta `salir` con la real revocada, se revoca después de autenticar: se simula con la ruta directa del servicio.
    const { salirDeImpersonacion } = await import('../src/server/services/impersonacion/servicio');
    await prisma.sesion.update({ where: { id: imp.sesion_real_id! }, data: { revocada_at: new Date() } });
    const r = await salirDeImpersonacion({ id: imp.sesion_prestada_id!, impersonacion_id: imp.id }, cookieReal, null);
    assert.equal(r.ok, false);
    assert.equal((await prisma.impersonacion.findFirstOrThrow()).fin_motivo, 'salir');
    assert.equal((await llamar(base, 'GET', '/api/auth/me', prestada)).status, 401);
  });

  it('«salir» por HTTP con la real revocada → 401 sin cookie de sesión', async () => {
    const { prestada, cookieReal } = await entrarComo(d.propietario1.id);
    // La real se revoca; la prestada también cae (401), así que `salir` ni llega: queda la entrada cerrada como revocada.
    await prisma.sesion.updateMany({ where: { usuario_id: d.superadmin.id }, data: { revocada_at: new Date() } });
    const r = await salir(prestada, cookieReal);
    assert.equal(r.status, 401);
    assert.doesNotMatch(r.headers.get('set-cookie') ?? '', /house_sesion=[\w-]{20,}/);
  });

  it('«salir» con el superadmin degradado → 401 y no restaura', async () => {
    const { prestada, cookieReal } = await entrarComo(d.propietario1.id);
    await prisma.usuario.update({ where: { id: d.superadmin.id }, data: { rol: 'admin', empresa_id: d.empresaA.id } });
    const r = await salir(prestada, cookieReal);
    assert.equal(r.status, 401);
    const imp = await prisma.impersonacion.findFirstOrThrow();
    assert.ok(imp.fin_at);
    assert.doesNotMatch(r.headers.get('set-cookie') ?? '', /house_sesion=[\w-]{20,}/);
  });

  it('«salir» sin la cookie real (o con una ajena) → 401: una sesión prestada robada no da acceso al superadmin', async () => {
    const { prestada } = await entrarComo(d.propietario1.id);
    const r = await salir(prestada, null);
    assert.equal(r.status, 401);
    assert.doesNotMatch(r.headers.get('set-cookie') ?? '', /house_sesion=[\w-]{20,}/);
    assert.equal((await prisma.impersonacion.findFirstOrThrow()).fin_motivo, 'salir');
    // Con la prestada de otra entrada y un token que no es el de la real tampoco restaura.
    const otra = await entrarComo(d.propietario2.id);
    const ajena = await login(base, 'prop1@test.pe');
    assert.equal((await salir(otra.prestada, ajena.split('.')[0]!)).status, 401);
  });

  it('«salir» desde una sesión normal → 409', async () => {
    const real = await login(base, 'super@test.pe');
    assert.equal((await llamar(base, 'POST', '/api/impersonacion/salir', real, {})).status, 409);
  });

  it('cambiar la contraseña del objetivo (revoca sus sesiones) cierra la entrada como «revocada»', async () => {
    const { prestada } = await entrarComo(d.propietario1.id);
    const admin = await login(base, 'admin.a@test.pe');
    const r = await llamar(base, 'PUT', `/api/usuarios/${d.propietario1.id}`, admin, { password: 'OtraClave!456xyz' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', prestada)).status, 401);
    const imp = await esperar(async () => (await prisma.impersonacion.findFirst({ where: { fin_at: { not: null } } })));
    assert.equal(imp.fin_motivo, 'revocada');
  });
});

describe('historial', () => {
  it('lo ve sólo el superadmin con sesión propia: quién, a quién, motivo, inicio, fin y cómo terminó', async () => {
    const { real, prestada, cookieReal } = await entrarComo(d.propietario1.id);
    await salir(prestada, cookieReal);
    const lista = await llamar(base, 'GET', '/api/impersonacion', real);
    assert.equal(lista.status, 200, lista.texto);
    assert.equal(lista.body.total, 1);
    const f = lista.body.items[0];
    assert.equal(f.superadmin.nombre, 'Super');
    assert.equal(f.usuario.nombre, 'Propietario 1');
    assert.equal(f.motivo, MOTIVO);
    assert.equal(f.fin_motivo, 'salir');
    assert.ok(f.inicio_at && f.fin_at);
    assert.equal(f.sesion_real_id, undefined); // ids internos de sesión no salen
    const admin = await login(base, 'admin.a@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/impersonacion', admin)).status, 403);
  });
});
