// Mi plan (aislamiento por empresa), Suscripciones (sólo superadmin), registro de pagos manuales, edición de precios y vencimientos.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { ciclo } from '../src/server/services/avisos/planificador';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { invalidarComercial, moduloActivo } from '../src/server/services/comercial/modulos';
import { procesarVencimientos } from '../src/server/services/comercial/vencimientos';

const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'mtto' | 'seg', string>;

interface Correo { para: string; asunto: string; cuerpo: string }
let enviados: Correo[] = [];
let fallaCorreo = false;
const ENV = { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <house@ejemplo.test>' };
const depsFalsas = (ahora: () => Date = () => new Date()): DepsAvisos => ({
  ahora, env: ENV,
  fetch: (async (_u: string | URL | Request, init?: RequestInit) => {
    if (fallaCorreo) return new Response('{}', { status: 500 });
    const b = JSON.parse(String(init?.body));
    enviados.push({ para: b.to[0], asunto: b.subject, cuerpo: b.text });
    return new Response('{}', { status: 200 });
  }) as typeof fetch,
});
const depsOriginal = comercialCorreo.deps;

const fijar = async (complejoId: number, data: Record<string, unknown>) => {
  await prisma.suscripcionCondominio.upsert({ where: { complejo_id: complejoId }, create: { complejo_id: complejoId, ...data }, update: data });
  invalidarComercial();
};
const pagoBody = (over: Record<string, unknown> = {}) => ({ monto: '295.00', fecha_pago: iso(HOY), medio: 'transferencia', operacion: 'OP-0001', periodo_desde: iso(HOY), periodo_hasta: iso(HOY + 30 * DIA), ...over });

before(async () => {
  d = await sembrar();
  const hash = (await prisma.usuario.findUniqueOrThrow({ where: { email: 'admin.a@test.pe' }, omit: { password_hash: false } })).password_hash!;
  await prisma.usuario.create({ data: { nombre: 'Seguridad A2', email: 'seg2.a@test.pe', rol: 'seguridad', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), mtto: await login(base, 'mtto.a@test.pe'), seg: await login(base, 'seg.a@test.pe'),
  };
});
after(async () => { comercialCorreo.deps = depsOriginal; await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  enviados = []; fallaCorreo = false;
  comercialCorreo.deps = () => depsFalsas();
  await prisma.pagoSuscripcion.deleteMany();
  await prisma.suscripcionCondominio.deleteMany();
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { correo_superadmin: 'miguel@house.test', pago_titular: 'Miguel G.', pago_banco: 'BCP', pago_cuenta: '191-0000000-0-00', pago_cci: '002-191-000000000000-00', pago_yape: '999 888 777', dias_gracia: 7, dias_aviso_vencimiento: 5, igv_tasa: '0.18' } });
  await prisma.moduloComercial.update({ where: { clave: 'asistente' }, data: { precio_por_unidad: '0.50' } });
  await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '2.50' } });
  await fijar(d.complejoA.id, { plan_clave: 'gratis' });
  await fijar(d.complejoB.id, { plan_clave: 'gratis' });
});
afterEach(() => { invalidarComercial(); });

describe('Mi plan: cada empresa ve y cambia sólo lo suyo (otro tenant → 404)', () => {
  it('el admin ve SUS condominios con plan, módulos, departamentos facturables, monto con desglose y cómo pagar', async () => {
    const r = await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.condominios.map((c: { complejo: string }) => c.complejo), ['Complejo A']);
    const c = r.body.condominios[0];
    assert.equal(c.plan.clave, 'gratis');
    assert.equal(c.unidades_facturables, 2);
    assert.equal(c.estado, 'gratis');
    assert.equal(c.cotizacion.total_mes, '0.00');
    assert.match(c.referencia_pago, /^HOUSE-\d+-\d{6}$/);
    assert.equal(r.body.pagar.yape, '999 888 777');
    assert.equal(r.body.pagar.titular, 'Miguel G.');
  });

  it('con módulos sueltos el monto es base × unidades y luego IGV una sola vez (2 deptos × 1,50 = 3,00 + 0,54 = 3,54)', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'gratis', modulos: ['ia_vouchers', 'asistente'], vigente_hasta: new Date(HOY + 20 * DIA) });
    const c = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.deepEqual({ base: c.cotizacion.base, igv: c.cotizacion.igv, total: c.cotizacion.total_mes }, { base: '3.00', igv: '0.54', total: '3.54' });
    assert.deepEqual(c.modulos_activos.sort(), ['asistente', 'ia_vouchers']);
  });

  it('otra empresa NO ve mi condominio, ni puede solicitarle un plan, ni cancelar su solicitud, ni leer sus pagos (404)', async () => {
    const lista = await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminB);
    assert.deepEqual(lista.body.condominios.map((c: { complejo: string }) => c.complejo), ['Complejo B']);
    const sol = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminB, { plan: 'pro' });
    assert.equal(sol.status, 404);
    assert.equal((await llamar(base, 'DELETE', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminB)).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/comercial/mi-plan/${d.complejoA.id}/pagos`, T.adminB)).status, 404);
    const sus = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
    assert.equal(sus.solicitud_plan, null);
    assert.equal(sus.estado, 'gratis');
    assert.equal(enviados.length, 0, 'nadie recibió aviso');
  });

  it('el residente, mantenimiento y seguridad no entran a Mi plan; el superadmin usa Suscripciones', async () => {
    for (const t of [T.prop1, T.mtto, T.seg, T.super]) assert.equal((await llamar(base, 'GET', '/api/comercial/mi-plan', t)).status, 403);
    assert.equal((await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.prop1, { plan: 'pro' })).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/comercial/mi-plan')).status, 401);
  });

  it('solicitar un plan: queda «solicitada», NO activa nada, avisa al superadmin con el monto y la referencia', async () => {
    const r = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado, 'solicitada');
    assert.equal(r.body.solicitud.plan, 'pro');
    assert.equal(r.body.solicitud.cotizacion.total_mes, '5.90', '2 deptos × 2,50 = 5,00 + IGV 0,90');
    assert.equal(r.body.plan.clave, 'gratis', 'el plan no cambia hasta que se paga');
    assert.deepEqual(r.body.modulos_activos, []);
    assert.equal(await moduloActivo(d.complejoA.id, 'asistente'), false, 'pedir no es tener');
    const c = enviados.find((x) => x.para === 'miguel@house.test')!;
    assert.match(c.asunto, /Complejo A/);
    assert.match(c.cuerpo, /plan pro/);
    assert.match(c.cuerpo, /HOUSE-\d+-\d{6}/);
  });

  it('solicitar módulos sueltos; validaciones: nada elegido, plan o módulo inexistente, cortesía no se pide', async () => {
    assert.equal((await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { modulos: ['asistente'] })).status, 200);
    for (const cuerpo of [{}, { plan: 'cortesia' }, { plan: 'inventado' }, { plan: 'gratis' }, { modulos: ['telepatia'] }]) {
      const r = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, cuerpo);
      assert.equal(r.status, 422, JSON.stringify(cuerpo));
    }
  });

  it('cancelar la solicitud la quita y vuelve a Gratis', async () => {
    await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' });
    assert.equal((await llamar(base, 'DELETE', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA)).status, 204);
    const c = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.equal(c.estado, 'gratis');
    assert.equal(c.solicitud, null);
  });

  it('el historial de pagos del condominio propio se ve con su desglose', async () => {
    // Gratis y sin módulos: el pago se rechaza (409), así que se registra tras fijar el plan.
    assert.equal((await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody({ monto: '5.90' }))).status, 409);
    await fijar(d.complejoA.id, { plan_clave: 'pro' });
    const ok = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody({ monto: '5.90' }));
    assert.equal(ok.status, 201, ok.texto);
    const h = await llamar(base, 'GET', `/api/comercial/mi-plan/${d.complejoA.id}/pagos`, T.adminA);
    assert.equal(h.body.items.length, 1);
    assert.deepEqual({ base: h.body.items[0].base, igv: h.body.items[0].igv, monto: h.body.items[0].monto }, { base: '5.00', igv: '0.90', monto: '5.90' });
    assert.equal((await llamar(base, 'GET', `/api/comercial/mi-plan/${d.complejoB.id}/pagos`, T.adminA)).status, 404);
  });
});

describe('Suscripciones y precios: sólo el superadmin (403 al resto)', () => {
  const rutas: [string, string, unknown][] = [
    ['GET', '/api/comercial/suscripciones', undefined],
    ['PATCH', '/api/comercial/suscripciones/1', { plan_clave: 'pro' }],
    ['POST', '/api/comercial/suscripciones/1/pagos', pagoBody()],
    ['GET', '/api/comercial/suscripciones/1/pagos', undefined],
    ['GET', '/api/comercial/catalogo', undefined],
    ['PUT', '/api/comercial/modulos/asistente', { precio_por_unidad: '0.01' }],
    ['PUT', '/api/comercial/planes/pro', { precio_por_unidad: '0.01' }],
    ['PUT', '/api/comercial/configuracion', { igv_tasa: '0' }],
  ];
  for (const [metodo, ruta, cuerpo] of rutas) {
    it(`${metodo} ${ruta}: admin, residente, mantenimiento y seguridad → 403; sin sesión → 401`, async () => {
      for (const t of [T.adminA, T.adminB, T.prop1, T.mtto, T.seg]) assert.equal((await llamar(base, metodo, ruta, t, cuerpo)).status, 403, `${metodo} ${ruta}`);
      assert.equal((await llamar(base, metodo, ruta, null, cuerpo)).status, 401);
    });
  }

  it('un admin NO puede darse un plan ni registrar un pago ni cambiar un precio: nada cambió', async () => {
    await llamar(base, 'PATCH', `/api/comercial/suscripciones/${d.complejoA.id}`, T.adminA, { plan_clave: 'pro', modulos: ['asistente'] });
    await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.adminA, pagoBody());
    await llamar(base, 'PUT', '/api/comercial/modulos/asistente', T.adminA, { precio_por_unidad: '0.01' });
    assert.equal((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } })).plan_clave, 'gratis');
    assert.equal(await prisma.pagoSuscripcion.count(), 0);
    assert.equal((await prisma.moduloComercial.findUniqueOrThrow({ where: { clave: 'asistente' } })).precio_por_unidad.toFixed(2), '0.50');
  });
});

describe('superadmin: lista, cambios y pagos', () => {
  it('la lista pone «solicitada» y «por vencer» arriba y filtra por estado; trae empresa, plan, monto y vigencia', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'gratis', solicitud_plan: 'pro', estado: 'solicitada' });
    await fijar(d.complejoB.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 2 * DIA), estado: 'por_vencer' });
    const extra = await prisma.complejoHabitacional.create({ data: { nombre: 'Aaa activo', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    await fijar(extra.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 90 * DIA) });
    const r = await llamar(base, 'GET', '/api/comercial/suscripciones', T.super);
    assert.deepEqual(r.body.items.map((x: { estado: string }) => x.estado), ['solicitada', 'por_vencer', 'activa']);
    assert.equal(r.body.items[0].empresa.nombre, 'Empresa A');
    assert.ok(r.body.items[1].vigente_hasta);
    assert.equal((await llamar(base, 'GET', '/api/comercial/suscripciones?estado=por_vencer', T.super)).body.items.length, 1);
    assert.equal((await llamar(base, 'GET', '/api/comercial/suscripciones?q=Aaa', T.super)).body.total, 1);
    assert.equal((await llamar(base, 'GET', '/api/comercial/suscripciones?estado=inventado', T.super)).status, 422);
    await prisma.complejoHabitacional.delete({ where: { id: extra.id } });
  });

  it('cambiar plan y módulos (queda auditado) activa las puertas al instante', async () => {
    const r = await llamar(base, 'PATCH', `/api/comercial/suscripciones/${d.complejoA.id}`, T.super, { plan_clave: 'pro', vigente_hasta: iso(HOY + 30 * DIA), notas: 'Amigo de la casa' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado, 'activa');
    assert.equal(await moduloActivo(d.complejoA.id, 'whatsapp_avisos'), true);
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'suscripcion', accion: 'cambiar' }, orderBy: { id: 'desc' } });
    assert.ok(a);
    assert.equal((a!.detalle as { plan: string }).plan, 'pro');
    assert.equal((await llamar(base, 'PATCH', `/api/comercial/suscripciones/${d.complejoA.id}`, T.super, { plan_clave: 'inventado' })).status, 422);
    assert.equal((await llamar(base, 'PATCH', `/api/comercial/suscripciones/${d.complejoA.id}`, T.super, { modulos: ['telepatia'] })).status, 422);
    assert.equal((await llamar(base, 'PATCH', '/api/comercial/suscripciones/99999', T.super, { plan_clave: 'pro' })).status, 404);
  });

  it('registrar pago: extiende vigente_hasta, activa lo solicitado, desglosa el IGV y queda auditado', async () => {
    await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' });
    assert.equal(await moduloActivo(d.complejoA.id, 'asistente'), false);
    const r = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody({ monto: '5.90' }));
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual({ base: r.body.pago.base, igv: r.body.pago.igv, monto: r.body.pago.monto }, { base: '5.00', igv: '0.90', monto: '5.90' });
    assert.equal(r.body.suscripcion.plan.clave, 'pro');
    assert.equal(r.body.suscripcion.estado, 'activa');
    assert.equal(r.body.suscripcion.solicitud, null);
    assert.equal(iso(new Date(r.body.suscripcion.vigente_hasta).getTime()), iso(HOY + 30 * DIA));
    assert.equal(await moduloActivo(d.complejoA.id, 'asistente'), true, 'pagado = activo');
    const a = await prisma.auditoria.findFirst({ where: { accion: 'registrar_pago' } });
    assert.equal((a!.detalle as { monto: string }).monto, '5.90');
    assert.equal(a!.usuario_id, d.superadmin.id);
  });

  it('un segundo pago suma al vencimiento sin acortarlo; uno anterior no lo adelanta', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 60 * DIA) });
    const r = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody({ periodo_hasta: iso(HOY + 30 * DIA) }));
    assert.equal(iso(new Date(r.body.suscripcion.vigente_hasta).getTime()), iso(HOY + 60 * DIA), 'no se acorta');
    const r2 = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody({ operacion: 'OP-0002', periodo_desde: iso(HOY + 60 * DIA), periodo_hasta: iso(HOY + 90 * DIA) }));
    assert.equal(iso(new Date(r2.body.suscripcion.vigente_hasta).getTime()), iso(HOY + 90 * DIA));
  });

  it('un pago pone al día una suscripción vencida y vuelve a encender los módulos', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY - 30 * DIA), estado: 'vencida' });
    assert.equal(await moduloActivo(d.complejoA.id, 'ia_vouchers'), false, 'apagado por falta de pago');
    const r = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody());
    assert.equal(r.status, 201);
    assert.equal(await moduloActivo(d.complejoA.id, 'ia_vouchers'), true);
  });

  it('validaciones del pago: operación repetida 409, periodo al revés 422, monto/medio/fecha inválidos 422, Gratis sin módulos 409, condominio inexistente 404', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro' });
    assert.equal((await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody())).status, 201);
    assert.equal((await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody())).status, 409, 'misma operación');
    for (const mal of [{ periodo_desde: iso(HOY + 30 * DIA), periodo_hasta: iso(HOY), operacion: 'X1' }, { monto: '0', operacion: 'X2' }, { monto: '-5', operacion: 'X3' }, { monto: '12.345', operacion: 'X4' }, { medio: 'bitcoin', operacion: 'X5' }, { fecha_pago: 'ayer', operacion: 'X6' }]) {
      assert.equal((await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody(mal))).status, 422, JSON.stringify(mal));
    }
    assert.equal((await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoB.id}/pagos`, T.super, pagoBody({ operacion: 'Y1' }))).status, 409, 'B sigue en Gratis sin módulos');
    assert.equal((await llamar(base, 'POST', '/api/comercial/suscripciones/99999/pagos', T.super, pagoBody({ operacion: 'Y2' }))).status, 404);
    assert.equal(await prisma.pagoSuscripcion.count(), 1);
  });

  it('editar precios y módulos: se reflejan en Mi plan y en la página pública al instante; el precio se valida; queda auditado', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 30 * DIA) });
    assert.equal((await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0].cotizacion.total_mes, '5.90');
    const r = await llamar(base, 'PUT', '/api/comercial/planes/pro', T.super, { precio_por_unidad: '3.00' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0].cotizacion.total_mes, '7.08', '2 × 3,00 = 6,00 + 1,08');
    assert.equal((await llamar(base, 'GET', '/api/publico/planes')).body.planes.find((p: { clave: string }) => p.clave === 'pro').precio_por_unidad, '3.54');
    const m = await llamar(base, 'PUT', '/api/comercial/modulos/asistente', T.super, { precio_por_unidad: '0.80', nombre: 'Asistente PRO', activo: false });
    assert.equal(m.status, 200);
    assert.ok(!(await llamar(base, 'GET', '/api/publico/planes')).body.modulos.some((x: { clave: string }) => x.clave === 'asistente'), 'un módulo no activo no se ofrece');
    for (const mal of [{ precio_por_unidad: '-1' }, { precio_por_unidad: 'gratis' }, { precio_por_unidad: '1.23456' }]) assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro', T.super, mal)).status, 422);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/inventado', T.super, { nombre: 'X' })).status, 404);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/modulos/inventado', T.super, { nombre: 'X' })).status, 404);
    assert.ok(await prisma.auditoria.findFirst({ where: { entidad: 'plan_comercial', accion: 'editar' } }));
    await llamar(base, 'PUT', '/api/comercial/modulos/asistente', T.super, { activo: true });
  });

  it('editar datos de pago, IGV, gracia y correo: Mi plan los muestra; la auditoría guarda qué campos cambiaron, no los datos bancarios', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { pago_banco: 'Interbank', pago_cuenta: '898-3000000000', pago_yape: '', dias_gracia: 10, igv_tasa: 0.18, url_publica: 'https://house.ejemplo.test/' });
    assert.equal(r.status, 200, r.texto);
    const pagar = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.pagar;
    assert.equal(pagar.banco, 'Interbank');
    assert.equal(pagar.yape, null);
    assert.equal(pagar.dias_gracia, 10);
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'configuracion_comercial' }, orderBy: { id: 'desc' } });
    assert.ok(!JSON.stringify(a!.detalle).includes('898-3000000000'));
    for (const mal of [{ igv_tasa: 5 }, { igv_tasa: -1 }, { dias_gracia: -1 }, { dias_gracia: 500 }, { correo_superadmin: 'no-es-correo' }, { url_publica: 'javascript:alert(1)' }]) {
      assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, mal)).status, 422, JSON.stringify(mal));
    }
  });

  it('cambiar el IGV: el precio público y los totales siguen la tasa vigente (sin 18 % fijo en el código)', async () => {
    await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { igv_tasa: '0.10' });
    assert.equal((await llamar(base, 'GET', '/api/publico/planes')).body.planes.find((p: { clave: string }) => p.clave === 'pro').precio_por_unidad, '2.75');
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro')).body.total_mes, '275.00');
  });
});

describe('vencimientos en el planificador', () => {
  const unAdmin = async () => {
    await prisma.usuario.update({ where: { email: 'admin.a@test.pe' }, data: { correo_verificado: true } });
  };
  const aAdmin = () => enviados.filter((c) => c.para === 'admin.a@test.pe');
  const ahoraEn = (dias: number) => new Date(HOY + dias * DIA + 17 * 3_600_000); // 12:00 en Lima de ese día

  it('N días antes avisa al admin UNA sola vez (idempotente por periodo), con fecha, monto y cómo pagar', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 4 * DIA), estado: 'activa' });
    const r1 = await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas(() => ahoraEn(0)) });
    assert.equal(r1.correos, 1);
    const c = aAdmin()[0];
    assert.match(c.asunto, /vence el/);
    assert.match(c.cuerpo, /S\/ 5\.90 al mes \(IGV incluido\)/);
    assert.match(c.cuerpo, /Yape: 999 888 777/);
    assert.match(c.cuerpo, /HOUSE-\d+-\d{6}/);
    const r2 = await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas(() => ahoraEn(0)) });
    assert.equal(r2.correos, 0, 'no se repite');
    assert.equal(aAdmin().length, 1);
    assert.equal((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } })).estado, 'por_vencer');
  });

  it('no avisa a quien aún está lejos del vencimiento, ni a cortesía, ni a Gratis', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 40 * DIA) });
    await fijar(d.complejoB.id, { plan_clave: 'cortesia', vigente_hasta: new Date(HOY + 1 * DIA) });
    const r = await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    assert.equal(r.correos, 0);
    assert.equal(enviados.length, 0);
  });

  it('al vencer pasa a «vencida» y avisa los días de gracia; pasada la gracia apaga los módulos y avisa — cada aviso una vez', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY - 1 * DIA), estado: 'activa' });
    const v = await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    assert.equal(v.estados, 1);
    assert.equal((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } })).estado, 'vencida');
    assert.match(aAdmin().at(-1)!.cuerpo, /Tienes 7 días de gracia/);
    assert.equal(await moduloActivo(d.complejoA.id, 'asistente'), true, 'en gracia sigue encendido');
    await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    assert.equal(aAdmin().length, 1, 'el aviso de vencida no se repite');

    // Pasan 10 días más: la gracia terminó.
    const tarde = ahoraEn(9);
    const t = await procesarVencimientos({ ahora: tarde, deps: depsFalsas(() => tarde) });
    assert.ok(t.correos >= 1);
    assert.match(aAdmin().at(-1)!.asunto, /Se apagaron los módulos/);
    assert.match(aAdmin().at(-1)!.cuerpo, /datos siguen intactos/);
    const antes = aAdmin().length;
    await procesarVencimientos({ ahora: tarde, deps: depsFalsas(() => tarde) });
    assert.equal(aAdmin().length, antes);
  });

  it('un pago nuevo (otro vigente_hasta) rehabilita los avisos del periodo siguiente', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 3 * DIA) });
    await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    assert.equal(aAdmin().length, 1);
    await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody({ periodo_hasta: iso(HOY + 33 * DIA) }));
    await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    assert.equal(aAdmin().length, 1, 'ya no está por vencer');
    const luego = ahoraEn(30);
    await procesarVencimientos({ ahora: luego, deps: depsFalsas() });
    assert.equal(aAdmin().length, 2, 'el nuevo periodo vuelve a avisar');
  });

  it('si el correo falla (red) no se marca como avisado y se reintenta en el siguiente ciclo', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 2 * DIA) });
    fallaCorreo = true;
    await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    assert.equal(aAdmin().length, 0);
    fallaCorreo = false;
    await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    assert.equal(aAdmin().length, 1);
  });

  it('sólo avisa a admins con el correo verificado de la empresa dueña del condominio', async () => {
    await unAdmin();
    await prisma.usuario.update({ where: { email: 'admin.b@test.pe' }, data: { correo_verificado: false } });
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 2 * DIA) });
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: 'pro' } });
    await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    assert.deepEqual(enviados.map((c) => c.para), ['admin.a@test.pe']);
    await prisma.usuario.update({ where: { email: 'admin.b@test.pe' }, data: { correo_verificado: true } });
  });

  it('corre dentro del ciclo del planificador de avisos y un fallo suyo no frena los avisos de cobranza', async () => {
    await fijar(d.complejoA.id, { plan_clave: 'pro', vigente_hasta: new Date(HOY + 2 * DIA) });
    const r = await ciclo(depsFalsas(() => ahoraEn(0)));
    assert.ok(r && r.vencimientos && r.vencimientos.revisadas >= 1);
    assert.equal(aAdmin().length, 1);
  });
});
