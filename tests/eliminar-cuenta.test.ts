// Eliminar la propia cuenta (App Store 5.1.1(v), Google Play): `POST /api/me/eliminar`, `POST /api/me/solicitar-cierre`, `GET /api/me/eliminacion` y la página pública
// `/eliminar-cuenta`. Vecino, personal y administradora con OTRA administradora: se elimina al momento (acceso fuera, datos anonimizados, lo contable intacto).
// Única administradora de su empresa: no se elimina, queda una solicitud de cierre para el superadmin. Superadmin, sesión prestada y demo: 403.
import './helpers/env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import { after, before, beforeEach, describe, it } from 'node:test';
import { cookieDe, esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { sincronizarUnidad } from '../src/server/services/personas/sincronizar';
import { fijarModoDemo } from '../src/server/services/demo/estado';
import { htmlAviso, textoAviso } from '../src/server/services/contacto/solicitud';

let D: Datos;
let base: string;
let cerrar: () => Promise<void>;
const SIN_LIMITES = { api: 100_000, login: 100_000, password: 100_000 };

before(async () => { ({ base, cerrar } = await iniciar({ rateLimits: SIN_LIMITES })); });
after(async () => {
  await fijarModoDemo(false);
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  D = await sembrar();
  await prisma.solicitudContacto.deleteMany(); // la bandeja no se vacía con el resto de la base
});

const OK = { password: PASSWORD, confirmacion: 'ELIMINAR' };
const eliminar = (token: string, cuerpo: unknown = OK) => llamar(base, 'POST', '/api/me/eliminar', token, cuerpo);
const solicitar = (token: string, cuerpo: unknown = { password: PASSWORD }) => llamar(base, 'POST', '/api/me/solicitar-cierre', token, cuerpo);
const usuario = (id: number) => prisma.usuario.findUniqueOrThrow({ where: { id }, omit: { password_hash: false } });
const hash = () => bcrypt.hash(PASSWORD, 4);

/** La cuenta sigue exactamente como estaba: con su contraseña, su nombre, su correo y sin marca de eliminada. */
async function intacta(id: number, nombre: string, email: string) {
  const u = await usuario(id);
  assert.equal(u.eliminada_at, null);
  assert.equal(u.nombre, nombre);
  assert.equal(u.email, email);
  assert.ok(u.password_hash);
}

/** Una administradora más en la empresa A (con contraseña y correo confirmado: «activa»). */
const otraAdmin = async (extra: Record<string, unknown> = {}) =>
  prisma.usuario.create({ data: { nombre: 'Admin A2', email: 'admin.a2@test.pe', rol: 'admin', password_hash: await hash(), empresa_id: D.empresaA.id, ...extra } });

/** Un pago validado de `quien` sobre el cargo vencido de A-101 (lo que debe sobrevivir a la eliminación). */
async function pagoDe(quien: number) {
  const pago = await prisma.pago.create({ data: { recibo_concepto_unidad_id: D.cargoVencidoA1.id, monto: 150, usuario_id: quien, metodo_pago: 'yape', estado_validacion: 'validado', validado_por_id: D.adminA.id, validado_at: new Date() } });
  await prisma.reciboConceptoUnidad.update({ where: { id: D.cargoVencidoA1.id }, data: { estado_pago: 'pagado' } });
  return pago;
}

describe('vecino: la cuenta se elimina al momento', () => {
  it('sale con 200, la cookie se borra y el acceso queda cerrado (login, sesiones, tokens de API, vínculos, avisos)', async () => {
    const t1 = await login(base, 'prop1@test.pe');
    const t2 = await login(base, 'prop1@test.pe'); // otra sesión (otro dispositivo)
    await llamar(base, 'POST', '/api/me/tokens-api', t1, { nombre: 'Claude' });
    await prisma.canalVinculado.create({ data: { usuario_id: D.propietario1.id, canal: 'whatsapp', identificador: '51900000001', empresa_id: D.empresaA.id, verificado_at: new Date() } });
    await prisma.notificacion.create({ data: { usuario_id: D.propietario1.id, canal: 'email', tipo: 'recordatorio', asunto: 'Hola Propietario 1', cuerpo: 'Tu recibo vence' } });
    await prisma.conversacionIA.create({ data: { usuario_id: D.propietario1.id, titulo: 'Mi deuda' } });
    assert.equal(await prisma.tokenApi.count({ where: { usuario_id: D.propietario1.id } }), 1);

    const r = await eliminar(t1);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body, { ok: true, resultado: 'eliminada' });
    assert.match(r.headers.get('set-cookie') ?? '', /house_sesion=;/); // la cookie se borra

    // No vuelve a entrar con su correo y su clave.
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email: 'prop1@test.pe', password: PASSWORD })).status, 401);
    // Ninguna de sus dos sesiones vale (ni la que eliminó ni la otra).
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t1)).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t2)).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/me/unidades', t2)).status, 401);
    // Y en la base no queda ninguna fila de sesión, token, vínculo, aviso ni conversación suyos.
    const id = D.propietario1.id;
    assert.equal(await prisma.sesion.count({ where: { usuario_id: id } }), 0);
    assert.equal(await prisma.tokenApi.count({ where: { usuario_id: id } }), 0);
    assert.equal(await prisma.canalVinculado.count({ where: { usuario_id: id } }), 0);
    assert.equal(await prisma.notificacion.count({ where: { usuario_id: id } }), 0);
    assert.equal(await prisma.conversacionIA.count({ where: { usuario_id: id } }), 0);
  });

  it('sus datos personales quedan anonimizados en la misma fila (la fila no se borra)', async () => {
    await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { telefono: '+51 987 654 321', aviso_whatsapp: true } });
    const t = await login(base, 'prop1@test.pe');
    assert.equal((await eliminar(t)).status, 200);
    const u = await usuario(D.propietario1.id);
    assert.equal(u.nombre, 'Cuenta eliminada');
    assert.equal(u.email, `eliminada-${D.propietario1.id}@cuenta-eliminada.invalid`);
    assert.equal(u.telefono, null);
    assert.equal(u.password_hash, null);
    assert.equal(u.aviso_email, false);
    assert.equal(u.aviso_whatsapp, false);
    assert.ok(u.eliminada_at instanceof Date);
    assert.ok(!JSON.stringify(u).includes('prop1@test.pe'));
  });

  it('lo contable se conserva: el pago, el recibo y el cargo siguen con su departamento y los totales no cambian', async () => {
    const pago = await pagoDe(D.propietario1.id);
    const adminT = await login(base, 'admin.a@test.pe');
    const suma = async () => (await prisma.pago.aggregate({ _sum: { monto: true }, where: { estado_validacion: 'validado' } }))._sum.monto?.toString();
    const antes = { suma: await suma(), pagos: await prisma.pago.count(), cargos: await prisma.reciboConceptoUnidad.count(), recibos: await prisma.recibo.count(), api: (await llamar(base, 'GET', '/api/pagos', adminT)).body.total };
    assert.equal(antes.suma, '150');

    assert.equal((await eliminar(await login(base, 'prop1@test.pe'))).status, 200);

    assert.deepEqual({ suma: await suma(), pagos: await prisma.pago.count(), cargos: await prisma.reciboConceptoUnidad.count(), recibos: await prisma.recibo.count(), api: (await llamar(base, 'GET', '/api/pagos', adminT)).body.total }, antes);
    const cargo = await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: D.cargoVencidoA1.id } });
    assert.equal(cargo.unidad_id, D.unidadA1.id);
    assert.equal(cargo.estado_pago, 'pagado');
    const p = await prisma.pago.findUniqueOrThrow({ where: { id: pago.id } });
    assert.equal(p.usuario_id, D.propietario1.id);
    // La administración ve en el historial «Cuenta eliminada» donde estaba su nombre.
    const lista = await llamar(base, 'GET', '/api/pagos', adminT);
    assert.equal(lista.body.items.find((x: { id: number }) => x.id === pago.id).usuario.nombre, 'Cuenta eliminada');
  });

  it('su departamento deja de apuntar a la cuenta: sin titular, con el inquilino intacto y UN responsable de pago', async () => {
    await prisma.$transaction((tx) => sincronizarUnidad(tx, D.unidadA1.id)); // fichas de propietario e inquilino
    assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: D.unidadA1.id } }), 2);
    assert.equal((await eliminar(await login(base, 'prop1@test.pe'))).status, 200);

    const unidad = await prisma.unidad.findUniqueOrThrow({ where: { id: D.unidadA1.id } });
    assert.equal(unidad.propietario_id, null);
    assert.equal(unidad.inquilino_id, D.inquilino1.id); // el inquilino no se toca
    const fichas = await prisma.personaUnidad.findMany({ where: { unidad_id: D.unidadA1.id } });
    assert.equal(fichas.length, 1);
    assert.equal(fichas[0]!.usuario_id, D.inquilino1.id);
    assert.equal(fichas.filter((f) => f.responsable_pago).length, 1);
    assert.equal(await prisma.personaUnidad.count({ where: { usuario_id: D.propietario1.id } }), 0);
    // El inquilino sigue entrando y viendo su departamento.
    const inq = await login(base, 'inq1@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/me/unidades', inq)).body.total, 1);
  });

  it('una cuenta marcada como eliminada nunca autentica, aunque le quedara una sesión viva (defensa si el cierre de sesiones se cayera a medias)', async () => {
    const t = await login(base, 'prop2@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 200);
    await prisma.usuario.update({ where: { id: D.propietario2.id }, data: { eliminada_at: new Date() } });
    assert.equal(await prisma.sesion.count({ where: { usuario_id: D.propietario2.id, revocada_at: null } }), 1); // la sesión sigue «viva» en la base
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 401);
  });

  it('su correo queda libre: la administradora puede invitar de nuevo a esa persona al mismo departamento', async () => {
    assert.equal((await eliminar(await login(base, 'prop1@test.pe'))).status, 200);
    const adminT = await login(base, 'admin.a@test.pe');
    const r = await llamar(base, 'POST', '/api/usuarios', adminT, { nombre: 'Propietario 1', email: 'prop1@test.pe', rol: 'propietario', password: PASSWORD, complejo_id: D.complejoA.id, unidad_id: D.unidadA1.id });
    assert.equal(r.status, 201, r.texto);
    assert.notEqual(r.body.id, D.propietario1.id);
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: D.unidadA1.id } })).propietario_id, r.body.id);
    // La cuenta nueva entra; la vieja sigue eliminada.
    await login(base, 'prop1@test.pe');
    assert.equal((await usuario(D.propietario1.id)).eliminada_at !== null, true);
  });

  it('deja la junta vigente (las gestiones pasadas conservan su fila) y pierde el cargo', async () => {
    const vigente = await prisma.juntaDirectiva.create({ data: { complejo_id: D.complejoA.id, desde: new Date('2026-01-01') } });
    const pasada = await prisma.juntaDirectiva.create({ data: { complejo_id: D.complejoA.id, desde: new Date('2024-01-01'), hasta: new Date('2025-12-31') } });
    await prisma.miembroJunta.createMany({ data: [{ junta_id: vigente.id, usuario_id: D.propietario1.id, cargo: 'tesorero' }, { junta_id: pasada.id, usuario_id: D.propietario1.id, cargo: 'vocal' }] });
    await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { cargo_junta: 'tesorero' } });
    assert.equal((await eliminar(await login(base, 'prop1@test.pe'))).status, 200);
    assert.equal(await prisma.miembroJunta.count({ where: { junta_id: vigente.id } }), 0);
    assert.equal(await prisma.miembroJunta.count({ where: { junta_id: pasada.id } }), 1);
    assert.equal((await usuario(D.propietario1.id)).cargo_junta, null);
  });

  it('queda en la auditoría como «eliminar_cuenta», sin la contraseña', async () => {
    assert.equal((await eliminar(await login(base, 'prop1@test.pe'))).status, 200);
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'eliminar_cuenta' } }));
    assert.equal(fila.usuario_id, D.propietario1.id);
    assert.equal(fila.entidad, 'usuario');
    assert.equal(fila.entidad_id, D.propietario1.id);
    const todo = JSON.stringify(await prisma.auditoria.findMany());
    assert.ok(!todo.includes(PASSWORD), 'la contraseña nunca llega a la auditoría');
  });

  it('la cuenta eliminada no sale en el listado de usuarios de la administración ni del superadmin', async () => {
    assert.equal((await eliminar(await login(base, 'mtto.a@test.pe'))).status, 200);
    for (const quien of ['admin.a@test.pe', 'super@test.pe']) {
      const lista = await llamar(base, 'GET', '/api/usuarios?pageSize=100', await login(base, quien));
      assert.equal(lista.status, 200);
      assert.ok(!lista.body.items.some((u: { id: number }) => u.id === D.mantenimientoA.id), quien);
      assert.ok(lista.body.items.some((u: { id: number }) => u.id === D.mantenimientoA2.id), `${quien} sigue viendo al resto`);
    }
  });
});

describe('confirmación: sin contraseña correcta y sin «ELIMINAR» no cambia nada', () => {
  it('contraseña incorrecta → 422 y la cuenta sigue intacta (y puede entrar)', async () => {
    const t = await login(base, 'prop1@test.pe');
    const r = await eliminar(t, { password: 'Otra-clave-123!', confirmacion: 'ELIMINAR' });
    assert.equal(r.status, 422);
    assert.ok(r.body.campos.password);
    await intacta(D.propietario1.id, 'Propietario 1', 'prop1@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 200);
    await login(base, 'prop1@test.pe');
  });

  it('sin la frase «ELIMINAR» (vacía, otra palabra) → 422 y nada cambia; sin contraseña → 422', async () => {
    const t = await login(base, 'prop1@test.pe');
    for (const cuerpo of [{ password: PASSWORD }, { password: PASSWORD, confirmacion: '' }, { password: PASSWORD, confirmacion: 'BORRAR' }, { password: PASSWORD, confirmacion: 'ELIMINARLA' }, { confirmacion: 'ELIMINAR' }, {}]) {
      const r = await eliminar(t, cuerpo);
      assert.equal(r.status, 422, JSON.stringify(cuerpo));
    }
    await intacta(D.propietario1.id, 'Propietario 1', 'prop1@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 200);
  });

  it('la frase se acepta en minúsculas y con espacios, y los campos de más se rechazan (422)', async () => {
    const t = await login(base, 'prop1@test.pe');
    assert.equal((await eliminar(t, { password: PASSWORD, confirmacion: 'ELIMINAR', usuario_id: D.propietario2.id })).status, 422);
    await intacta(D.propietario2.id, 'Propietario 2', 'prop2@test.pe');
    assert.equal((await eliminar(t, { password: PASSWORD, confirmacion: '  eliminar ' })).status, 200);
  });

  it('exige sesión (401 sin cookie) y el token CSRF', async () => {
    assert.equal((await llamar(base, 'POST', '/api/me/eliminar', null, OK)).status, 401);
    const t = await login(base, 'prop1@test.pe');
    const sinCsrf = await llamar(base, 'POST', '/api/me/eliminar', t, OK, { 'x-csrf-token': 'falso' });
    assert.equal(sinCsrf.status, 403);
    await intacta(D.propietario1.id, 'Propietario 1', 'prop1@test.pe');
  });

  it('limita los intentos como el cambio de contraseña: a la tercera equivocada, 429', async () => {
    const limitada = await iniciar({ rateLimits: { ...SIN_LIMITES, password: 2 } });
    try {
      const t = await login(limitada.base, 'prop1@test.pe');
      const intento = () => llamar(limitada.base, 'POST', '/api/me/eliminar', t, { password: 'mala-clave-1!', confirmacion: 'ELIMINAR' });
      assert.equal((await intento()).status, 422);
      assert.equal((await intento()).status, 422);
      assert.equal((await intento()).status, 429);
      // Ni siquiera con la clave correcta pasa mientras dure el bloqueo: la cuenta sigue intacta.
      assert.equal((await llamar(limitada.base, 'POST', '/api/me/eliminar', t, OK)).status, 429);
      await intacta(D.propietario1.id, 'Propietario 1', 'prop1@test.pe');
    } finally { await limitada.cerrar(); }
  });
});

describe('personal: seguridad y mantenimiento', () => {
  it('el personal se elimina igual: acceso cerrado, datos anonimizados y su tarea sigue ahí', async () => {
    const t = await login(base, 'mtto.a@test.pe');
    const t2 = await login(base, 'mtto.a@test.pe');
    assert.equal((await eliminar(t)).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t2)).status, 401);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email: 'mtto.a@test.pe', password: PASSWORD })).status, 401);
    const u = await usuario(D.mantenimientoA.id);
    assert.equal(u.nombre, 'Cuenta eliminada');
    assert.equal(u.password_hash, null);
    assert.equal(await prisma.sesion.count({ where: { usuario_id: u.id } }), 0);
    const tarea = await prisma.tareaMantenimiento.findUniqueOrThrow({ where: { id: D.tareaA.id } });
    assert.equal(tarea.asignado_id, D.mantenimientoA.id); // el historial de la tarea se conserva
    assert.equal(tarea.unidad_id, D.unidadA1.id);
    // Seguridad: lo mismo.
    assert.equal((await eliminar(await login(base, 'seg.a@test.pe'))).status, 200);
    assert.equal((await usuario(D.seguridadA.id)).eliminada_at !== null, true);
  });

  it('una persona de la empresa B no se ve afectada por lo de la empresa A', async () => {
    assert.equal((await eliminar(await login(base, 'mtto.a@test.pe'))).status, 200);
    await intacta(D.adminB.id, 'Admin B', 'admin.b@test.pe');
    await intacta(D.propietarioB.id, 'Propietario B', 'propb@test.pe');
  });
});

describe('administradora', () => {
  it('con OTRA administradora activa en su empresa se elimina al momento; la otra sigue entrando', async () => {
    const a2 = await otraAdmin();
    const t = await login(base, 'admin.a@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/me/eliminacion', t)).body.modo, 'inmediata');
    assert.equal((await eliminar(t)).status, 200);
    assert.equal((await usuario(D.adminA.id)).eliminada_at !== null, true);
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 401);
    await intacta(a2.id, 'Admin A2', 'admin.a2@test.pe');
    await login(base, 'admin.a2@test.pe');
  });

  it('única administradora de su empresa: NO se elimina (409 UNICA_ADMIN), la cuenta y su sesión siguen como estaban', async () => {
    const t = await login(base, 'admin.a@test.pe');
    const modo = await llamar(base, 'GET', '/api/me/eliminacion', t);
    assert.deepEqual(modo.body, { modo: 'solicitud', frase: 'ELIMINAR', solicitud_pendiente: false });
    const r = await eliminar(t);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'UNICA_ADMIN');
    await intacta(D.adminA.id, 'Admin A', 'admin.a@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 200);
    assert.equal(await prisma.sesion.count({ where: { usuario_id: D.adminA.id } }), 1);
    assert.equal(await prisma.solicitudContacto.count(), 0, 'eliminar no crea solicitudes a escondidas');
  });

  it('una invitación sin aceptar (sin contraseña) o de otra empresa no cuenta como «otra administradora activa»', async () => {
    await otraAdmin({ email: 'pendiente@test.pe', password_hash: null }); // invitada, no aceptó
    await prisma.usuario.create({ data: { nombre: 'Sin confirmar', email: 'sinconfirmar@test.pe', rol: 'admin', password_hash: await hash(), empresa_id: D.empresaA.id, correo_verificado: false } });
    const t = await login(base, 'admin.a@test.pe'); // la admin de B no es de su empresa
    assert.equal((await eliminar(t)).status, 409);
    await intacta(D.adminA.id, 'Admin A', 'admin.a@test.pe');
  });

  it('una administradora eliminada tampoco cuenta: la que queda ya es la única', async () => {
    const a2 = await otraAdmin();
    assert.equal((await eliminar(await login(base, 'admin.a@test.pe'))).status, 200);
    const t2 = await login(base, 'admin.a2@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/me/eliminacion', t2)).body.modo, 'solicitud');
    assert.equal((await eliminar(t2)).status, 409);
    await intacta(a2.id, 'Admin A2', 'admin.a2@test.pe');
  });

  it('dos administradoras que se eliminan a la vez: una se va y la otra se queda (la empresa nunca queda sin ninguna)', async () => {
    await otraAdmin();
    const [t1, t2] = [await login(base, 'admin.a@test.pe'), await login(base, 'admin.a2@test.pe')];
    const [r1, r2] = await Promise.all([eliminar(t1), eliminar(t2)]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    const activas = await prisma.usuario.count({ where: { empresa_id: D.empresaA.id, rol: 'admin', eliminada_at: null } });
    assert.equal(activas, 1);
  });

  it('sin empresa asignada no hay empresa que dejar vacía: se elimina', async () => {
    assert.equal((await eliminar(await login(base, 'admin.huerfano@test.pe'))).status, 200);
  });

  it('pedir el cierre de su empresa crea la solicitud: la ve el superadmin y NO otra administradora', async () => {
    const t = await login(base, 'admin.a@test.pe');
    const r = await solicitar(t);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.resultado, 'solicitud_cierre');
    assert.equal(r.body.ya_existia, false);
    await intacta(D.adminA.id, 'Admin A', 'admin.a@test.pe'); // pedir el cierre NO elimina nada
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 200);

    const fila = await prisma.solicitudContacto.findUniqueOrThrow({ where: { id: r.body.solicitud_id } });
    assert.equal(fila.tema, 'cierre_cuenta');
    assert.equal(fila.estado, 'nueva');
    assert.equal(fila.correo, 'admin.a@test.pe');
    assert.equal(fila.condominio, 'Empresa A');
    assert.match(fila.mensaje, /Empresa A/);
    assert.match(fila.mensaje, /90 días/);

    const superT = await login(base, 'super@test.pe');
    const bandeja = await llamar(base, 'GET', '/api/comercial/contactos', superT);
    assert.equal(bandeja.status, 200);
    assert.ok(bandeja.body.items.some((x: { id: number; tema: string }) => x.id === fila.id && x.tema === 'cierre_cuenta'));
    // La administradora de otra empresa (y la propia) no entran a la bandeja.
    assert.equal((await llamar(base, 'GET', '/api/comercial/contactos', await login(base, 'admin.b@test.pe'))).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/comercial/contactos', t)).status, 403);
    // La pantalla ahora sabe que ya lo pidió.
    assert.equal((await llamar(base, 'GET', '/api/me/eliminacion', t)).body.solicitud_pendiente, true);
    // La administradora de B no ve que A lo pidió.
    assert.equal((await llamar(base, 'GET', '/api/me/eliminacion', await login(base, 'admin.b@test.pe'))).body.solicitud_pendiente, false);
  });

  it('pedirlo dos veces no duplica la solicitud (200 ya_existia)', async () => {
    const t = await login(base, 'admin.a@test.pe');
    const primera = await solicitar(t);
    const segunda = await solicitar(t);
    assert.equal(segunda.status, 200);
    assert.equal(segunda.body.ya_existia, true);
    assert.equal(segunda.body.solicitud_id, primera.body.solicitud_id);
    assert.equal(await prisma.solicitudContacto.count({ where: { tema: 'cierre_cuenta' } }), 1);
  });

  it('pedir el cierre exige la contraseña correcta (422) y que sea la única administradora (409 HAY_OTRA_ADMIN)', async () => {
    const t = await login(base, 'admin.a@test.pe');
    assert.equal((await solicitar(t, { password: 'mala-clave-1!' })).status, 422);
    assert.equal((await solicitar(t, {})).status, 422);
    assert.equal(await prisma.solicitudContacto.count(), 0);
    await otraAdmin();
    const r = await solicitar(t);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'HAY_OTRA_ADMIN');
    assert.equal(await prisma.solicitudContacto.count(), 0);
  });

  it('queda guardada aunque el correo a Torre falle, y el aviso lleva el texto propio del cierre (no el de «Escribió desde /contacto»)', async () => {
    const r = await solicitar(await login(base, 'admin.a@test.pe'));
    assert.equal(r.status, 201);
    const fila = await prisma.solicitudContacto.findUniqueOrThrow({ where: { id: r.body.solicitud_id } });
    assert.equal(fila.aviso_enviado, false); // sin llave de correo en las pruebas: queda guardada y sin aviso, como el formulario público
    const texto = textoAviso(fila);
    assert.match(texto, /pide el cierre de su empresa/);
    assert.doesNotMatch(texto, /Escribió desde \/contacto/);
    assert.match(htmlAviso(fila), /pide el cierre de su empresa/);
  });
});

describe('superadmin, sesión prestada y demo', () => {
  it('el superadmin no elimina su cuenta desde aquí: 403 en las dos rutas y nada cambia', async () => {
    const t = await login(base, 'super@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/me/eliminacion', t)).body.modo, 'no_disponible');
    const r = await eliminar(t);
    assert.equal(r.status, 403);
    assert.match(r.body.error, /superadministrador/);
    assert.equal((await solicitar(t)).status, 403);
    assert.equal((await eliminar(t, {})).status, 403, 'ni siquiera se llega a validar el cuerpo');
    await intacta(D.superadmin.id, 'Super', 'super@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 200);
  });

  it('«Entrar como»: el superadmin no puede eliminar la cuenta de la persona a la que ve (403)', async () => {
    const real = await login(base, 'super@test.pe');
    const entrada = await llamar(base, 'POST', '/api/impersonacion', real, { usuario_id: D.propietario1.id, motivo: 'Soporte de prueba' });
    assert.equal(entrada.status, 200, entrada.texto);
    const prestada = `${cookieDe(entrada)}.${entrada.body.csrf}`;
    for (const r of [await eliminar(prestada), await solicitar(prestada)]) {
      assert.equal(r.status, 403);
      assert.match(r.body.error, /otra persona/);
    }
    await intacta(D.propietario1.id, 'Propietario 1', 'prop1@test.pe');
  });

  it('en modo demo las dos rutas responden 403 code DEMO y la cuenta no cambia', async () => {
    await fijarModoDemo(true);
    const t = await login(base, 'prop1@test.pe');
    const r = await eliminar(t);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'DEMO');
    const tAdmin = await login(base, 'admin.a@test.pe');
    const s = await solicitar(tAdmin);
    assert.equal(s.status, 403);
    assert.equal(s.body.code, 'DEMO');
    await intacta(D.propietario1.id, 'Propietario 1', 'prop1@test.pe');
    assert.equal(await prisma.solicitudContacto.count(), 0);
    // Y sin el modo demo, la misma petición sí funciona.
    await fijarModoDemo(false);
    assert.equal((await eliminar(t)).status, 200);
  });
});

describe('formulario público: el tema «eliminar_cuenta» (quien ya no puede entrar)', () => {
  it('/contacto acepta el tema eliminar_cuenta y lo guarda; cierre_cuenta no se acepta desde fuera', async () => {
    const cuerpo = { nombre: 'Ana Pérez', correo: 'ana@ejemplo.pe', mensaje: 'No puedo entrar y quiero eliminar mi cuenta' };
    const ok = await llamar(base, 'POST', '/api/publico/contacto', null, { ...cuerpo, tema: 'eliminar_cuenta' });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await prisma.solicitudContacto.findFirstOrThrow({ where: { correo: 'ana@ejemplo.pe' } })).tema, 'eliminar_cuenta');
    const mal = await llamar(base, 'POST', '/api/publico/contacto', null, { ...cuerpo, tema: 'cierre_cuenta' });
    assert.equal(mal.status, 422);
    assert.equal(await prisma.solicitudContacto.count(), 1);
  });
});

describe('página pública /eliminar-cuenta (la URL que pide Google Play)', () => {
  let dist: string;
  let srv: { base: string; cerrar: () => Promise<void> };
  before(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'eliminar-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>\n<html lang="es-PE"><head><meta charset="UTF-8" /><title>Torre</title></head><body><div id="root"></div></body></html>\n');
    srv = await iniciar({ rateLimits: SIN_LIMITES, distDir: dist });
  });
  after(async () => { await srv.cerrar(); fs.rmSync(dist, { recursive: true, force: true }); });

  const pedir = async (ruta: string) => { const r = await fetch(srv.base + ruta, { redirect: 'manual' }); return { status: r.status, robots: r.headers.get('x-robots-tag'), texto: await r.text() }; };

  it('responde 200 (no 404), sin sesión, con noindex, follow en la cabecera y en la etiqueta', async () => {
    const r = await pedir('/eliminar-cuenta');
    assert.equal(r.status, 200);
    assert.equal(r.robots, 'noindex, follow');
    assert.match(r.texto, /<meta name="robots" content="noindex, follow" \/>/);
    assert.equal((await pedir('/eliminar-cuenta/')).status, 200);
  });

  it('no es indexable: no está en el sitemap público ni en la lista de rutas públicas', async () => {
    const { PUBLICAS } = await import('../src/server/seo/rutas');
    assert.ok(!(PUBLICAS as readonly string[]).includes('/eliminar-cuenta'));
  });
});
