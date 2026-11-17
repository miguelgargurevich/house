import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import webpush from 'web-push';
import { prisma, sembrar, type Datos } from './helpers/app';
import { cuentaDeServicioFalsa, depsFalsas, suscripcionFalsa, tokenFcmFalso, type Llamada } from './helpers/push';
import { encolarAviso, encolarReciboEmitido, MAX_INTENTOS, procesarCola } from '../src/server/services/avisos';
import { fijarModoDemo } from '../src/server/services/demo/estado';
import { olvidarAccesosFcm } from '../src/server/services/push/fcm';
import { registrarDispositivo } from '../src/server/services/push/dispositivos';
import { MOTIVO_NO_CONFIGURADO, MOTIVO_SIN_DISPOSITIVOS } from '../src/server/services/push/enviar';

const AHORA = new Date('2026-11-17T15:00:00Z');
const MIN = 60_000;
const ANTES = new Date(AHORA.getTime() - MIN); // los avisos se programan un minuto antes del reloj de la prueba
const cuenta = cuentaDeServicioFalsa();
const vapid = webpush.generateVAPIDKeys();
const ENV_FCM: NodeJS.ProcessEnv = { FCM_PROJECT_ID: 'torre-prueba', FCM_SERVICE_ACCOUNT_JSON: cuenta.json };
const ENV_WEB: NodeJS.ProcessEnv = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:soporte@ejemplo.test' };
const ENV_TODO = { ...ENV_FCM, ...ENV_WEB };

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const esToken = (l: Llamada) => l.url.includes('oauth2.googleapis.com');
const esFcm = (l: Llamada) => l.url.startsWith('https://fcm.googleapis.com/v1/');
/** FCM contesta bien, salvo que `fallos` diga otra cosa para ese token. */
const responder = (fallos: Record<string, Response> = {}) => (l: Llamada) => {
  if (esToken(l)) return json({ access_token: 'ACCESO-FALSO', expires_in: 3600 });
  if (esFcm(l)) {
    const t = (JSON.parse(String(l.init.body)) as { message: { token: string } }).message.token;
    return fallos[t]?.clone() ?? json({ name: 'ok' });
  }
  return fallos[l.url]?.clone() ?? new Response(null, { status: 201 }); // Web Push
};
const unregistered = () => json({ error: { code: 404, status: 'NOT_FOUND', message: 'x', details: [{ errorCode: 'UNREGISTERED' }] } }, 404);

let d: Datos;
before(async () => { d = await sembrar(); });
after(async () => { await fijarModoDemo(false); await prisma.$disconnect(); });
beforeEach(async () => {
  olvidarAccesosFcm();
  await prisma.notificacion.deleteMany();
  await prisma.dispositivoPush.deleteMany();
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: false, telefono: null } });
  await prisma.usuario.updateMany({ data: { eliminada_at: null } });
  await prisma.reciboConceptoUnidad.updateMany({ data: { estado_pago: 'pendiente' } });
  await fijarModoDemo(false);
});
afterEach(() => olvidarAccesosFcm());

const filas = (where: object = {}) => prisma.notificacion.findMany({ where, orderBy: { id: 'asc' } });
const conFcm = (usuarioId: number, plataforma: 'android' | 'ios' = 'android') => { const token = tokenFcmFalso(); return registrarDispositivo(usuarioId, { tipo: 'fcm', token, plataforma }).then(() => token); };
const conWeb = async (usuarioId: number) => { const s = suscripcionFalsa(); await registrarDispositivo(usuarioId, { tipo: 'web', endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }); return s; };

describe('push: se encola como un canal más de la cola de avisos', () => {
  it('sólo quien tiene un dispositivo recibe la fila `push`, con texto corto SIN monto ni nombre', async () => {
    await conFcm(d.inquilino1.id); // paga A-101; prop2 (paga A-102) no tiene dispositivo
    const creadas = await encolarReciboEmitido(d.reciboVencidoA.id);
    assert.equal(creadas, 3, 'correo de inq1 + push de inq1 + correo de prop2');
    const push = await filas({ canal: 'push' });
    assert.equal(push.length, 1);
    assert.equal(push[0]!.usuario_id, d.inquilino1.id);
    assert.equal(push[0]!.tipo, 'recibo_emitido');
    assert.equal(push[0]!.estado, 'pendiente');
    assert.equal(push[0]!.ref_entidad, 'recibo');
    assert.match(push[0]!.asunto, /Tu recibo de agosto de 2026 ya está/);
    const todo = `${push[0]!.asunto} ${push[0]!.cuerpo}`;
    assert.ok(!/S\/|150|Inquilino|Hola/.test(todo), `el push no lleva monto, nombre ni saludo: ${todo}`);
    // el correo sí lleva el detalle (no cambió)
    const correo = await filas({ canal: 'email', usuario_id: d.inquilino1.id });
    assert.match(correo[0]!.cuerpo, /S\/ 150\.00/);
  });

  it('sin dispositivos nada cambia: sólo correo (y 0 filas si no hay canal)', async () => {
    assert.equal(await encolarReciboEmitido(d.reciboVencidoA.id), 2);
    assert.equal((await filas({ canal: 'push' })).length, 0);
    await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { aviso_email: false } });
    await prisma.notificacion.deleteMany();
    assert.equal(await encolarAviso('recibo_emitido', d.inquilino1.id, { entidad: 'recibo', id: d.reciboVencidoA.id }), 0);
  });

  it('quien sólo tiene push (sin correo ni WhatsApp) igual recibe el aviso', async () => {
    await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { aviso_email: false } });
    await conFcm(d.inquilino1.id);
    assert.equal(await encolarAviso('recibo_emitido', d.inquilino1.id, { entidad: 'recibo', id: d.reciboVencidoA.id }), 1);
    assert.deepEqual((await filas()).map((n) => n.canal), ['push']);
  });

  it('es idempotente: repetir no duplica la fila push', async () => {
    await conFcm(d.inquilino1.id);
    await encolarReciboEmitido(d.reciboVencidoA.id);
    assert.equal(await encolarReciboEmitido(d.reciboVencidoA.id), 0);
    assert.equal((await filas({ canal: 'push' })).length, 1);
  });

  it('el motivo de un rechazo va en el correo y NO en el push; pago_validado no se empuja', async () => {
    await conFcm(d.inquilino1.id);
    const ref = { entidad: 'pago' as const, id: 0 };
    const { id } = await prisma.pago.create({ data: { recibo_concepto_unidad_id: d.cargoVencidoA1.id, monto: 150, usuario_id: d.inquilino1.id, estado_validacion: 'rechazado' } });
    await encolarAviso('pago_rechazado', d.inquilino1.id, { ...ref, id }, { motivo: 'El voucher es de otro banco y no se lee' });
    const push = (await filas({ canal: 'push' }))[0]!;
    const correo = (await filas({ canal: 'email' }))[0]!;
    assert.match(correo.cuerpo, /otro banco/);
    assert.ok(!/otro banco/.test(`${push.asunto} ${push.cuerpo}`));
    assert.equal(await encolarAviso('pago_validado', d.inquilino1.id, { ...ref, id }), 0);
  });

  it('un comunicado con un monto en el título sale con texto genérico', async () => {
    await conFcm(d.inquilino1.id);
    const c = await prisma.comunicado.create({ data: { complejo_id: d.complejoA.id, titulo: 'Cuota extraordinaria S/ 50 por persona', cuerpo: 'Detalle', autor_id: d.adminA.id } });
    await encolarAviso('comunicado', d.inquilino1.id, { entidad: 'comunicado', id: c.id }, { canales: ['email'] });
    const push = (await filas({ canal: 'push' }))[0]!;
    assert.equal(push.asunto, 'Nuevo comunicado');
    assert.ok(!/S\/|50/.test(push.cuerpo), push.cuerpo);
  });
});

describe('push: el envío de la cola', () => {
  async function emitirAInquilino() {
    await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { aviso_email: false } });
    await encolarAviso('recibo_emitido', d.inquilino1.id, { entidad: 'recibo', id: d.reciboVencidoA.id }, { ahora: ANTES });
    return (await filas({ canal: 'push' }))[0]!;
  }

  it('manda a FCM con la ruta del rol y marca la fila enviada; el cuerpo de la petición no lleva montos', async () => {
    const token = await conFcm(d.inquilino1.id);
    await emitirAInquilino();
    const { deps, llamadas } = depsFalsas(AHORA, ENV_FCM, responder());
    const r = await procesarCola(deps);
    assert.equal(r.enviadas, 1);
    const envio = llamadas.find(esFcm)!;
    const cuerpo = JSON.parse(String(envio.init.body));
    assert.equal(cuerpo.message.token, token);
    assert.deepEqual(cuerpo.message.data, { ruta: '/inquilino/cargos' });
    assert.ok(!/S\/|150/.test(String(envio.init.body)));
    const fila = (await filas({ canal: 'push' }))[0]!;
    assert.equal(fila.estado, 'enviada');
    assert.ok(fila.enviada_at);
  });

  it('manda también al navegador (Web Push cifrado) y a todos los dispositivos de la persona', async () => {
    const t1 = await conFcm(d.inquilino1.id);
    const t2 = await conFcm(d.inquilino1.id, 'ios');
    const s = await conWeb(d.inquilino1.id);
    await emitirAInquilino();
    const { deps, llamadas } = depsFalsas(AHORA, ENV_TODO, responder());
    assert.equal((await procesarCola(deps)).enviadas, 1);
    const tokens = llamadas.filter(esFcm).map((l) => JSON.parse(String(l.init.body)).message.token).sort();
    assert.deepEqual(tokens, [t1, t2].sort());
    const web = llamadas.find((l) => l.url === s.endpoint)!;
    assert.ok(web, 'salió al endpoint del navegador');
    assert.equal((web.init.headers as Record<string, string>)['Content-Encoding'], 'aes128gcm');
  });

  it('sólo se usan los dispositivos del destinatario: otra persona (y otro tenant) con dispositivo no recibe nada', async () => {
    await conFcm(d.inquilino1.id);
    const ajeno = await conFcm(d.propietarioB.id);   // otra administradora
    const vecino = await conFcm(d.propietario1.id);  // mismo condominio, no es quien paga A-101
    await emitirAInquilino();
    const { deps, llamadas } = depsFalsas(AHORA, ENV_FCM, responder());
    await procesarCola(deps);
    const usados = llamadas.filter(esFcm).map((l) => JSON.parse(String(l.init.body)).message.token);
    assert.equal(usados.length, 1);
    assert.ok(!usados.includes(ajeno) && !usados.includes(vecino));
  });

  it('un token que FCM dice UNREGISTERED se borra; los demás dispositivos siguen', async () => {
    const malo = await conFcm(d.inquilino1.id);
    const bueno = await conFcm(d.inquilino1.id);
    await emitirAInquilino();
    const { deps } = depsFalsas(AHORA, ENV_FCM, responder({ [malo]: unregistered() }));
    assert.equal((await procesarCola(deps)).enviadas, 1);
    const quedan = (await prisma.dispositivoPush.findMany({ where: { usuario_id: d.inquilino1.id } })).map((x) => x.token);
    assert.deepEqual(quedan, [bueno]);
  });

  it('si TODOS los tokens son inválidos: se borran y el aviso queda omitido (no se reintenta)', async () => {
    const t = await conFcm(d.inquilino1.id);
    await emitirAInquilino();
    const { deps } = depsFalsas(AHORA, ENV_FCM, responder({ [t]: unregistered() }));
    const r = await procesarCola(deps);
    assert.equal(r.omitidas, 1);
    assert.equal(await prisma.dispositivoPush.count(), 0);
    const fila = (await filas({ canal: 'push' }))[0]!;
    assert.equal(fila.estado, 'omitida');
    assert.equal(fila.error, MOTIVO_SIN_DISPOSITIVOS);
  });

  it('un 404 de proyecto (sin UNREGISTERED), un 403 o un 500 NO borran el dispositivo y se reintenta con espera creciente hasta quedar en error', async () => {
    const t = await conFcm(d.inquilino1.id);
    await emitirAInquilino();
    for (const [intento, resp] of [[1, json({ error: { status: 'NOT_FOUND' } }, 404)], [2, json({ error: { status: 'PERMISSION_DENIED' } }, 403)], [3, new Response('boom', { status: 500 })]] as const) {
      const ahora = new Date(AHORA.getTime() + intento * 60 * MIN);
      const { deps } = depsFalsas(ahora, ENV_FCM, responder({ [t]: resp }));
      await procesarCola(deps);
      const fila = (await filas({ canal: 'push' }))[0]!;
      assert.equal(fila.intentos, intento);
      assert.equal(fila.estado, intento < MAX_INTENTOS ? 'pendiente' : 'error');
      assert.match(fila.error ?? '', /^FCM respondió (404|403|500)$/);
      assert.equal(await prisma.dispositivoPush.count({ where: { token: t } }), 1, 'el dispositivo sigue');
    }
  });

  it('sin variables de FCM ni VAPID: omitida «Canal no configurado», sin llamar a la red y sin borrar el dispositivo', async () => {
    await conFcm(d.inquilino1.id);
    await emitirAInquilino();
    const { deps, llamadas } = depsFalsas(AHORA, {}, responder());
    const r = await procesarCola(deps);
    assert.equal(r.omitidas, 1);
    assert.equal(llamadas.length, 0);
    assert.equal((await filas({ canal: 'push' }))[0]!.error, MOTIVO_NO_CONFIGURADO);
    assert.equal(await prisma.dispositivoPush.count(), 1);
  });

  it('con sólo FCM configurado, un dispositivo web se omite (su canal no está listo) sin fallar', async () => {
    await conWeb(d.inquilino1.id);
    await emitirAInquilino();
    const { deps, llamadas } = depsFalsas(AHORA, ENV_FCM, responder());
    assert.equal((await procesarCola(deps)).omitidas, 1);
    assert.equal(llamadas.length, 0);
    assert.equal(await prisma.dispositivoPush.count(), 1);
  });

  it('el modo demostración nunca llega a la red', async () => {
    await conFcm(d.inquilino1.id);
    await emitirAInquilino();
    await fijarModoDemo(true);
    const { deps, llamadas } = depsFalsas(AHORA, ENV_TODO, responder());
    const r = await procesarCola(deps);
    assert.equal(r.omitidas, 1);
    assert.equal(llamadas.length, 0);
    assert.match((await filas({ canal: 'push' }))[0]!.error ?? '', /Simulado en la demo/);
  });

  it('una cuenta eliminada no recibe push', async () => {
    await conFcm(d.inquilino1.id);
    await emitirAInquilino();
    await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { eliminada_at: new Date() } });
    const { deps, llamadas } = depsFalsas(AHORA, ENV_FCM, responder());
    assert.equal((await procesarCola(deps)).omitidas, 1);
    assert.equal(llamadas.length, 0);
  });

  it('la red de seguridad: si un texto con monto llegara a la cola, no sale', async () => {
    await conFcm(d.inquilino1.id);
    await prisma.notificacion.create({ data: { usuario_id: d.inquilino1.id, canal: 'push', tipo: 'recibo_emitido', asunto: 'Debes S/ 150.00', cuerpo: 'Paga ya', estado: 'pendiente', ref_entidad: 'recibo', ref_id: d.reciboVencidoA.id, programada_para: new Date(AHORA.getTime() - MIN) } });
    const { deps, llamadas } = depsFalsas(AHORA, ENV_FCM, responder());
    const consola = console.error; console.error = () => {};
    try { assert.equal((await procesarCola(deps)).omitidas, 1); } finally { console.error = consola; }
    assert.equal(llamadas.length, 0);
  });

  it('el correo de la misma cola sigue saliendo aunque el push falle', async () => {
    const t = await conFcm(d.inquilino1.id);
    await encolarAviso('recibo_emitido', d.inquilino1.id, { entidad: 'recibo', id: d.reciboVencidoA.id }, { ahora: ANTES });
    const env = { ...ENV_FCM, RESEND_API_KEY: 're_FALSA', MAIL_FROM: 'Casa <avisos@ejemplo.test>' };
    const { deps, llamadas } = depsFalsas(AHORA, env, (l) => (l.url.includes('resend') ? json({ id: 'x' }) : responder({ [t]: new Response('x', { status: 500 }) })(l)));
    const r = await procesarCola(deps);
    assert.equal(r.enviadas, 1);
    assert.equal(r.fallos, 1);
    assert.ok(llamadas.some((l) => l.url.includes('resend')));
  });
});
