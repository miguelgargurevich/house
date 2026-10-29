// Invitación al crear un usuario sin contraseña: correo HTML con el enlace, token de un solo uso (sólo su hash en la base, vence a los 7 días),
// aceptar fija la contraseña y deja entrar, reenviar invalida el enlace anterior y respeta el alcance por empresa.
import './helpers/env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cookieDe, credenciales, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { comercialDeps } from '../src/server/services/comercial/modulos';
import { DIAS_INVITACION, ESPERA_REENVIO_MS, MENSAJE_INVITACION_INVALIDA } from '../src/server/services/invitaciones';

interface Correo { para: string; asunto: string; texto: string; html: string | undefined }
let enviados: Correo[] = [];
let respuestaCorreo = 200;
const depsFalsas = (): DepsAvisos => ({
  ahora: () => comercialDeps.ahora(),
  env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <house@ejemplo.test>' },
  fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    if (respuestaCorreo === 200) enviados.push({ para: b.to[0], asunto: b.subject, texto: b.text, html: b.html });
    return new Response('{}', { status: respuestaCorreo });
  }) as typeof fetch,
});
const depsOriginal = comercialCorreo.deps;
const relojOriginal = comercialDeps.ahora;
let reloj = 0;

const tokenDe = (c: Correo) => /token=([\w-]+)/.exec(c.texto)?.[1] ?? '';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const CLAVE = 'Cl4ve-nueva-2026';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let adminA: string;
let adminB: string;
let superT: string;
let seq = 0;

const alta = (token: string, extra: Record<string, unknown> = {}) =>
  llamar(base, 'POST', '/api/usuarios', token, { nombre: 'Nuevo Limpieza', email: `nuevo${++seq}@invitacion.pe`, rol: 'limpieza', complejo_id: d.complejoA.id, ...extra });
const ver = (token: string) => llamar(base, 'GET', `/api/auth/invitacion?token=${encodeURIComponent(token)}`);
const aceptar = (token: string, password = CLAVE) => llamar(base, 'POST', '/api/auth/invitacion', null, { token, password });
/** Crea un usuario sin contraseña como `adminA` y devuelve su fila, el token del correo y el correo. */
async function invitado(extra: Record<string, unknown> = {}) {
  const r = await alta(adminA, extra);
  assert.equal(r.status, 201, r.texto);
  const correo = enviados.find((c) => c.para === r.body.email)!;
  return { r, id: r.body.id as number, email: r.body.email as string, correo, token: correo ? tokenDe(correo) : '' };
}

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, invitacion: 100_000 } }));
  adminA = await login(base, 'admin.a@test.pe');
  adminB = await login(base, 'admin.b@test.pe');
  superT = await login(base, 'super@test.pe');
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  enviados = [];
  respuestaCorreo = 200;
  await prisma.tokenInvitacion.deleteMany();
  reloj = Date.now();
  comercialDeps.ahora = () => new Date(reloj);
  comercialCorreo.deps = depsFalsas;
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { url_publica: 'https://house.ejemplo.test' } });
});
afterEach(() => { comercialCorreo.deps = depsOriginal; comercialDeps.ahora = relojOriginal; });

describe('crear usuario: invitación', () => {
  it('sin contraseña: se crea sin acceso y se manda el correo HTML con el enlace y el texto de respaldo', async () => {
    const { r, id, email, correo, token } = await invitado();
    assert.deepEqual(r.body.invitacion, { estado: 'enviada' });
    assert.equal(r.body.invitacion_pendiente, true);
    assert.equal(await prisma.usuario.count({ where: { id, password_hash: null } }), 1);
    assert.equal(enviados.length, 1);
    assert.equal(correo.para, email);
    assert.equal(correo.asunto, 'Te invitaron a House');
    assert.match(correo.texto, /Hola Nuevo Limpieza:/);
    assert.match(correo.texto, /Admin A te dio acceso a House como personal de limpieza de Complejo A\. Crea tu contraseña para entrar\./);
    assert.match(correo.texto, /Crear mi contraseña: https:\/\/house\.ejemplo\.test\/invitacion\?token=/);
    assert.match(correo.texto, /vence en 7 días/);
    assert.match(correo.texto, /Si no esperabas este correo, ignóralo/);
    assert.ok(correo.html && /^<!doctype html>/i.test(correo.html), 'trae html');
    assert.match(correo.html!, new RegExp(`href="https://house\\.ejemplo\\.test/invitacion\\?token=${token}"`));
    assert.match(correo.html!, /#007565/);
    assert.ok(token.length >= 40);
  });

  it('guarda sólo el hash del token (nunca el token), vence a los 7 días y registra quién invitó', async () => {
    const { id, token } = await invitado();
    const fila = await prisma.tokenInvitacion.findFirstOrThrow({ where: { usuario_id: id } });
    assert.notEqual(fila.token_hash, token);
    assert.equal(fila.token_hash, sha(token));
    assert.equal(fila.creado_por_id, d.adminA.id);
    assert.equal(fila.usado_at, null);
    const dias = (fila.expira_at.getTime() - fila.created_at.getTime()) / 86_400_000;
    assert.ok(Math.abs(dias - DIAS_INVITACION) < 0.01, `vence en ${dias} días`);
  });

  it('con contraseña: como siempre, sin invitación ni token, y entra de una vez', async () => {
    const r = await alta(adminA, { email: 'conclave@invitacion.pe', password: CLAVE });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.invitacion, undefined);
    assert.equal(r.body.invitacion_pendiente, false);
    assert.equal(enviados.length, 0);
    assert.equal(await prisma.tokenInvitacion.count(), 0);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email: 'conclave@invitacion.pe', password: CLAVE })).status, 200);
  });

  it('contraseña vacía = ausente (invita); una contraseña inválida sigue siendo 422 y no crea nada', async () => {
    const vacia = await alta(adminA, { password: '' });
    assert.equal(vacia.status, 201, vacia.texto);
    assert.equal(vacia.body.invitacion.estado, 'enviada');
    const antes = await prisma.usuario.count();
    const debil = await alta(adminA, { password: 'corta' });
    assert.equal(debil.status, 422);
    const igualCorreo = await alta(adminA, { email: 'igual@invitacion.pe', password: 'igual@invitacion.pe' });
    assert.equal(igualCorreo.status, 422);
    assert.equal(await prisma.usuario.count(), antes);
  });

  it('correo que ya existe: el mismo 409 de siempre y NO se manda nada', async () => {
    const r = await alta(adminA, { email: 'admin.b@test.pe' });
    assert.equal(r.status, 409);
    assert.equal(enviados.length, 0);
    assert.equal(await prisma.tokenInvitacion.count(), 0);
  });

  it('un correo sin buzón (…@sin-correo.invalid) NO recibe nada y no deja enlace', async () => {
    const r = await alta(adminA, { email: 'b1-804@sin-correo.invalid', rol: 'propietario' });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.invitacion, { estado: 'sin_correo' });
    assert.equal(r.body.invitacion_pendiente, false, 'no hay nada pendiente: no se le puede invitar');
    assert.equal(enviados.length, 0);
    assert.equal(await prisma.tokenInvitacion.count(), 0);
  });

  it('si el correo no sale (canal caído) la cuenta queda creada, se avisa y no queda un enlace colgado', async () => {
    respuestaCorreo = 500;
    const r = await alta(adminA);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.invitacion.estado, 'no_enviada');
    assert.equal(r.body.invitacion_pendiente, true);
    assert.equal(await prisma.tokenInvitacion.count(), 0);
  });

  it('el superadmin invita como administrador de una empresa; el correo dice la empresa', async () => {
    const r = await alta(superT, { rol: 'admin', empresa_id: d.empresaB.id, complejo_id: undefined });
    assert.equal(r.status, 201, r.texto);
    const c = enviados.find((x) => x.para === r.body.email)!;
    assert.match(c.texto, /Super te dio acceso a House como administrador de Empresa B\./);
  });

  it('el nombre y la empresa se escapan en el html (nada de HTML inyectado)', async () => {
    const r = await alta(adminA, { nombre: `<img src=x onerror=alert(1)> "Rosa"` });
    assert.equal(r.status, 201, r.texto);
    const c = enviados.find((x) => x.para === r.body.email)!;
    assert.doesNotMatch(c.html!, /<img/);
    assert.match(c.html!, /&lt;img src=x onerror=alert\(1\)&gt; &quot;Rosa&quot;/);
  });
});

describe('enlace de invitación (público)', () => {
  it('GET muestra nombre, correo enmascarado y rol; nada de la contraseña ni del id', async () => {
    const { token, email } = await invitado();
    const r = await ver(token);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.nombre, 'Nuevo Limpieza');
    assert.equal(r.body.email, `n***@${email.split('@')[1]}`);
    assert.equal(r.body.rol, 'limpieza');
    assert.equal(r.body.organizacion, 'Complejo A');
    assert.deepEqual(Object.keys(r.body).sort(), ['email', 'nombre', 'organizacion', 'rol', 'rol_texto']);
  });

  it('un enlace inexistente, vencido o usado da el MISMO 410 genérico (no revela si la cuenta existe)', async () => {
    const { token } = await invitado();
    const inexistente = await ver('x'.repeat(43));
    assert.equal(inexistente.status, 410);
    assert.equal(inexistente.body.error, MENSAJE_INVITACION_INVALIDA);
    reloj += DIAS_INVITACION * 86_400_000 + 1000;
    const vencido = await ver(token);
    assert.equal(vencido.status, 410);
    assert.deepEqual(vencido.body, inexistente.body);
  });

  it('vence a los 7 días: un segundo antes sirve; pasado el plazo, ni GET ni POST', async () => {
    const { token, id } = await invitado();
    reloj += DIAS_INVITACION * 86_400_000 - 1000;
    assert.equal((await ver(token)).status, 200);
    reloj += 2000;
    assert.equal((await ver(token)).status, 410);
    const r = await aceptar(token);
    assert.equal(r.status, 410);
    assert.equal(await prisma.usuario.count({ where: { id, password_hash: null } }), 1, 'no se fijó ninguna contraseña');
  });

  it('un solo uso: aceptar gasta el enlace, aunque la cuenta vuelva a quedar sin contraseña', async () => {
    const { token, id } = await invitado();
    assert.equal((await aceptar(token)).status, 200);
    assert.equal((await aceptar(token, 'Otra-clave-2026')).status, 410);
    assert.equal((await ver(token)).status, 410);
    // Sólo el token gastado lo frena aquí: se simula que la administración le borró la contraseña.
    await prisma.usuario.update({ where: { id }, data: { password_hash: null } });
    assert.equal((await ver(token)).status, 410, 'GET');
    assert.equal((await aceptar(token, 'Otra-clave-2026')).status, 410, 'POST');
    assert.equal(await prisma.usuario.count({ where: { id, password_hash: null } }), 1);
  });

  it('dos clics a la vez con el mismo enlace: sólo uno entra', async () => {
    const { token } = await invitado();
    const rs = await Promise.all([aceptar(token), aceptar(token, 'Otra-clave-2026'), aceptar(token, 'Una-mas-2026')]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 410, 410]);
  });

  it('aceptar: guarda el hash, verifica el correo, inicia sesión y después entra con su contraseña', async () => {
    const { token, id, email } = await invitado();
    await prisma.usuario.update({ where: { id }, data: { correo_verificado: false } }); // el valor por defecto ya es true: así sí se distingue
    const r = await aceptar(token);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.user.email, email);
    assert.equal(r.body.user.rol, 'limpieza');
    assert.ok(r.body.csrf);
    assert.equal(r.body.user.password_hash, undefined);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id }, omit: { password_hash: false } });
    assert.ok(u.password_hash && u.password_hash !== CLAVE && (await bcrypt.compare(CLAVE, u.password_hash)));
    assert.equal(u.correo_verificado, true);
    const yo = await llamar(base, 'GET', '/api/auth/me', credenciales(cookieDe(r), r.body.csrf));
    assert.equal(yo.status, 200, 'la cookie de la respuesta es una sesión válida');
    assert.equal(yo.body.id, id);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email, password: CLAVE })).status, 200);
    const lista = await llamar(base, 'GET', `/api/usuarios/${id}`, adminA);
    assert.equal(lista.body.invitacion_pendiente, false);
  });

  it('la contraseña pasa por las mismas reglas: débil o igual al correo → 422 y el enlace sigue valiendo', async () => {
    const { token, email } = await invitado();
    for (const password of ['corta1', 'sololetrasaquiii', 'Password123']) assert.equal((await aceptar(token, password)).status, 422, password);
    const igual = await aceptar(token, email);
    assert.equal(igual.status, 422);
    assert.match(igual.body.error, /igual a tu correo/);
    assert.equal((await aceptar(token, email.split('@')[0]!)).status, 422);
    assert.equal((await ver(token)).status, 200);
    assert.equal((await aceptar(token)).status, 200);
  });

  it('un enlace viejo no pisa una contraseña que la administración ya le puso', async () => {
    const { token, id, email } = await invitado();
    const put = await llamar(base, 'PUT', `/api/usuarios/${id}`, adminA, { password: 'Puesta-por-admin-1' });
    assert.equal(put.status, 200, put.texto);
    assert.equal((await ver(token)).status, 410, 'GET');
    assert.equal((await aceptar(token)).status, 410, 'POST');
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email, password: 'Puesta-por-admin-1' })).status, 200);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email, password: CLAVE })).status, 401);
  });

  it('el invitado que no aceptó no puede entrar (ni con una contraseña inventada ni vacía), igual que un correo que no existe', async () => {
    const { email } = await invitado();
    const a = await llamar(base, 'POST', '/api/auth/login', null, { email, password: 'Cualquiera-123' });
    const b = await llamar(base, 'POST', '/api/auth/login', null, { email: 'noexiste@invitacion.pe', password: 'Cualquiera-123' });
    assert.equal(a.status, 401);
    assert.deepEqual(a.body, b.body);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email, password: '' })).status, 422);
    assert.equal(await prisma.sesion.count({ where: { usuario: { email } } }), 0);
  });

  it('la auditoría registra la aceptación sin la contraseña ni el token', async () => {
    const { token, id } = await invitado();
    await aceptar(token);
    await new Promise((r) => setTimeout(r, 100));
    const filas = await prisma.auditoria.findMany();
    assert.ok(filas.some((f) => f.accion === 'aceptar_invitacion' && f.entidad_id === id));
    assert.ok(filas.some((f) => f.accion === 'invitar' && f.entidad_id === id));
    const todo = JSON.stringify(filas);
    assert.ok(!todo.includes(token), 'el token no está en la auditoría');
    assert.ok(!todo.includes(CLAVE), 'la contraseña no está en la auditoría');
  });
});

describe('reenviar invitación', () => {
  const reenviar = (t: string, id: number) => llamar(base, 'POST', `/api/usuarios/${id}/invitacion`, t);

  it('manda un enlace nuevo e invalida el anterior (el nuevo sí sirve)', async () => {
    const { id, email, token: viejo } = await invitado();
    reloj += ESPERA_REENVIO_MS + 1000;
    const r = await reenviar(adminA, id);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body, { invitacion: { estado: 'enviada' } });
    const nuevo = tokenDe(enviados.filter((c) => c.para === email).at(-1)!);
    assert.notEqual(nuevo, viejo);
    assert.equal((await ver(viejo)).status, 410, 'el anterior ya no sirve');
    assert.equal((await aceptar(viejo)).status, 410);
    assert.equal((await ver(nuevo)).status, 200);
    assert.equal(await prisma.tokenInvitacion.count({ where: { usuario_id: id, token_hash: sha(nuevo) } }), 1);
    assert.equal((await aceptar(nuevo)).status, 200);
  });

  it('aceptar con un enlace invalida los otros que quedaran vigentes', async () => {
    const { id, token } = await invitado();
    const otro = 'otro-enlace-vigente-' + 'a'.repeat(30);
    await prisma.tokenInvitacion.create({ data: { usuario_id: id, token_hash: sha(otro), expira_at: new Date(reloj + 86_400_000) } });
    assert.equal((await ver(otro)).status, 200);
    assert.equal((await aceptar(token)).status, 200);
    assert.equal((await ver(otro)).status, 410);
  });

  it('dos reenvíos seguidos: el segundo espera (429) y no manda otro correo', async () => {
    const { id } = await invitado();
    const antes = enviados.length;
    const r = await reenviar(adminA, id);
    assert.equal(r.status, 429);
    assert.equal(enviados.length, antes);
  });

  it('si el correo no sale, 502 y el enlace anterior NO se pierde', async () => {
    const { id, token } = await invitado();
    reloj += ESPERA_REENVIO_MS + 1000;
    respuestaCorreo = 500;
    const r = await reenviar(adminA, id);
    assert.equal(r.status, 502);
    assert.equal((await ver(token)).status, 200);
    assert.equal(await prisma.tokenInvitacion.count({ where: { usuario_id: id } }), 1, 'el intento fallido no deja un enlace huérfano');
  });

  it('otra empresa no puede reenviar: 404 (igual que un id que no existe) y no se manda nada', async () => {
    const { id } = await invitado();
    reloj += ESPERA_REENVIO_MS + 1000;
    const antes = enviados.length;
    const ajena = await reenviar(adminB, id);
    const nada = await reenviar(adminB, 999_999);
    assert.equal(ajena.status, 404);
    assert.equal(nada.status, 404);
    assert.deepEqual(ajena.body, nada.body);
    assert.equal(enviados.length, antes);
  });

  it('superadmin sí puede; personal que no administra, no (403)', async () => {
    const { id } = await invitado();
    reloj += ESPERA_REENVIO_MS + 1000;
    assert.equal((await reenviar(superT, id)).status, 200);
    const mtto = await login(base, 'mtto.a@test.pe');
    assert.equal((await reenviar(mtto, id)).status, 403);
    assert.equal((await llamar(base, 'POST', `/api/usuarios/${id}/invitacion`)).status, 401);
  });

  it('a quien ya tiene contraseña → 409; a un correo sin buzón → 422; ninguno manda correo', async () => {
    const antes = enviados.length;
    assert.equal((await reenviar(adminA, d.mantenimientoA.id)).status, 409);
    const r = await alta(adminA, { email: 'b2-101@sin-correo.invalid', rol: 'propietario' });
    assert.equal((await reenviar(adminA, r.body.id)).status, 422);
    assert.equal(enviados.length, antes);
  });

  it('la lista marca «invitación pendiente» sólo a quien no tiene contraseña ni un correo sin buzón', async () => {
    const { id } = await invitado();
    const sinBuzon = await alta(adminA, { email: 'b3-102@sin-correo.invalid', rol: 'propietario' });
    const lista = await llamar(base, 'GET', '/api/usuarios?pageSize=100', adminA);
    const por = (i: number) => lista.body.items.find((u: { id: number }) => u.id === i);
    assert.equal(por(id).invitacion_pendiente, true);
    assert.equal(por(sinBuzon.body.id).invitacion_pendiente, false);
    assert.equal(por(d.mantenimientoA.id).invitacion_pendiente, false);
    assert.ok(!JSON.stringify(lista.body).includes('password_hash'));
  });
});

describe('límite de intentos del enlace', () => {
  it('los intentos FALLIDOS por IP se frenan (429) como en el login; los buenos no gastan el cupo', async () => {
    const otro = await iniciar({ rateLimits: { api: 100_000, invitacion: 3 } });
    try {
      const { token } = await invitado();
      for (let i = 0; i < 5; i++) assert.equal((await llamar(otro.base, 'GET', `/api/auth/invitacion?token=${'z'.repeat(30)}${i}`)).status, i < 3 ? 410 : 429, `intento ${i}`);
      assert.equal((await llamar(otro.base, 'GET', `/api/auth/invitacion?token=${token}`)).status, 429, 'bloqueada también con un enlace bueno');
    } finally { await otro.cerrar(); }
    const limpio = await iniciar({ rateLimits: { api: 100_000, invitacion: 3 } });
    try {
      const { token } = await invitado();
      for (let i = 0; i < 6; i++) assert.equal((await llamar(limpio.base, 'GET', `/api/auth/invitacion?token=${token}`)).status, 200);
    } finally { await limpio.cerrar(); }
  });
});
