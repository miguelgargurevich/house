// Plan Básico (S/ 1 por departamento, mínimo 20, hasta 50): fila del catálogo (también en una base que ya tenía planes), cotización, tope de 50,
// sin módulos de Pro, sin plazo ni solo lectura mientras esté pagado y vigente, y cuenta como plan de pago para el límite de «un condominio gratis».
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { PLANES_SEED, sembrarCatalogoComercial } from '../src/server/services/comercial/catalogo';
import { ajustarOfertaGratisPro } from '../src/server/services/comercial/oferta';
import { invalidarComercial, moduloActivo } from '../src/server/services/comercial/modulos';
import { hoyLima } from '../src/server/lib/fechas';

const DIA = 86_400_000;
const HOY = () => hoyLima().getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
  await prisma.unidad.deleteMany({ where: { codigo: { startsWith: 'BX-' } } });
  invalidarComercial();
});

const ponerBasico = (venceDias: number | null = 20, extra: Record<string, unknown> = {}) =>
  prisma.suscripcionCondominio.upsert({
    where: { complejo_id: d.complejoA.id },
    create: { complejo_id: d.complejoA.id, plan_clave: 'basico', estado: 'activa', vigente_hasta: venceDias == null ? null : new Date(HOY() + venceDias * DIA), ...extra },
    update: { plan_clave: 'basico', estado: 'activa', vigente_hasta: venceDias == null ? null : new Date(HOY() + venceDias * DIA), ...extra },
  }).then((r) => { invalidarComercial(); return r; });
const unidades = (n: number) => prisma.unidad.createMany({ data: Array.from({ length: n }, (_, i) => ({ codigo: `BX-${i}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estado: 'activa' })) });
const miPlan = async () => (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios.find((c: { complejo_id: number }) => c.complejo_id === d.complejoA.id);

describe('el catálogo trae Básico', () => {
  it('con los valores pedidos: S/ 1,00 por departamento, mínimo 20, hasta 50, sin módulos de Pro, entre Gratis y Pro', async () => {
    const r = await llamar(base, 'GET', '/api/publico/planes');
    assert.deepEqual(r.body.planes.map((p: { clave: string }) => p.clave), ['gratis', 'basico', 'pro', 'administradora']);
    const b = r.body.planes.find((p: { clave: string }) => p.clave === 'basico');
    assert.deepEqual([b.nombre, b.descripcion, b.precio_por_unidad, b.unidades_minimas, b.unidades_maximas, b.modulos_incluidos, b.consultar, b.total_minimo_mes], ['Básico', 'Para edificios chicos que ya terminaron su periodo gratis.', '1.00', 20, 50, [], false, '20.00']);
    assert.deepEqual(b.caracteristicas, ['Todo lo de Gratis, sin plazo', 'Hasta 50 departamentos', 'Vouchers validados a mano', 'Avisos por correo']);
    const fila = await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'basico' } });
    assert.deepEqual([fila.visible, fila.orden, fila.igv_incluido, fila.asistente_por_unidad_mes, fila.whatsapp_por_unidad_mes], [true, 2, false, null, null]);
    assert.deepEqual(PLANES_SEED.map((p) => [p.clave, p.orden]), [['gratis', 1], ['basico', 2], ['pro', 3], ['administradora', 4], ['cortesia', 5]]);
  });

  it('Gratis ya no dice «para siempre»: «Gratis por 3 meses, hasta 20 departamentos»', async () => {
    const g = (await llamar(base, 'GET', '/api/publico/planes')).body.planes.find((p: { clave: string }) => p.clave === 'gratis');
    assert.equal(g.descripcion, 'Gratis por 3 meses, hasta 20 departamentos.');
    assert.doesNotMatch(JSON.stringify(PLANES_SEED), /siempre/);
  });

  it('en una base que ya tenía planes, el seed crea Básico, corre un puesto a los demás y una segunda corrida no vuelve a correrlos', async () => {
    await prisma.planComercial.delete({ where: { clave: 'basico' } });
    for (const [clave, orden] of [['gratis', 1], ['pro', 2], ['administradora', 3], ['cortesia', 4]] as const) await prisma.planComercial.update({ where: { clave }, data: { orden } });
    await sembrarCatalogoComercial(prisma);
    const orden = async () => Object.fromEntries((await prisma.planComercial.findMany()).map((p) => [p.clave, p.orden]));
    assert.deepEqual(await orden(), { gratis: 1, basico: 2, pro: 3, administradora: 4, cortesia: 5 });
    await sembrarCatalogoComercial(prisma);
    assert.deepEqual(await orden(), { gratis: 1, basico: 2, pro: 3, administradora: 4, cortesia: 5 });
    assert.equal(await prisma.planComercial.count({ where: { clave: 'basico' } }), 1);
  });

  it('el ajuste de la oferta (producción) deja la descripción de Gratis con plazo y Básico completo, y es idempotente', async () => {
    await prisma.planComercial.update({ where: { clave: 'gratis' }, data: { descripcion: 'Para empezar y para siempre, sin costo.' } });
    await prisma.planComercial.delete({ where: { clave: 'basico' } });
    const primera = await ajustarOfertaGratisPro(prisma);
    assert.ok(primera.some((c) => c.clave === 'gratis' && c.cambios.includes('descripcion')), JSON.stringify(primera));
    assert.equal((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'gratis' } })).descripcion, 'Gratis por 3 meses, hasta 20 departamentos.');
    assert.equal((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'basico' } })).unidades_maximas, 50);
    assert.deepEqual(await ajustarOfertaGratisPro(prisma), [], 'la segunda corrida no cambia nada');
  });

  it('fuera de Perú Básico no tiene precio por ahora: «consultar», y no se puede pedir', async () => {
    const cl = (await llamar(base, 'GET', '/api/publico/planes?pais=CL')).body.planes.find((p: { clave: string }) => p.clave === 'basico');
    assert.deepEqual([cl.consultar, cl.precio_por_unidad], [true, null]);
  });
});

describe('cotización', () => {
  it('10 departamentos → S/ 20 (el mínimo); 35 → S/ 35; 50 → S/ 50; y con IGV (18 %) 23,60 / 41,30 / 59,00', async () => {
    const cotizar = async (n: number) => (await llamar(base, 'GET', `/api/publico/cotizar?unidades=${n}&plan=basico`)).body;
    const a = await cotizar(10);
    assert.deepEqual([a.total_mes, a.unidades_cobradas, a.minimo_aplicado, a.total_con_igv_mes], ['20.00', 20, true, '23.60']);
    const b = await cotizar(35);
    assert.deepEqual([b.total_mes, b.unidades_cobradas, b.minimo_aplicado, b.total_con_igv_mes], ['35.00', 35, false, '41.30']);
    const c = await cotizar(50);
    assert.deepEqual([c.total_mes, c.total_anio, c.total_con_igv_mes], ['50.00', '600.00', '59.00']);
  });

  it('Mi plan cotiza lo que ya paga: un condominio de 10 departamentos con Básico paga S/ 20 + IGV', async () => {
    await unidades(10);
    await ponerBasico();
    const c = await miPlan();
    assert.deepEqual([c.plan.clave, c.plan.nombre, c.cotizacion.base, c.cotizacion.total_mes, c.unidades_maximas, c.unidades_minimas], ['basico', 'Básico', '20.00', '23.60', 50, 20]);
  });
});

describe('el tope de 50 departamentos', () => {
  it('con 50 o menos se ofrece Básico (con «desde S/ 20»); con 51 no aparece en planes_disponibles y pedirlo da 422', async () => {
    await unidades(48); // 2 de la siembra + 48 = 50
    let c = await miPlan();
    assert.equal(c.unidades_facturables, 50);
    assert.deepEqual([c.planes_disponibles.includes('basico'), c.basico_desde], [true, 'S/ 20']);
    await prisma.unidad.create({ data: { codigo: 'BX-extra', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estado: 'activa' } }); // 51
    c = await miPlan();
    assert.equal(c.unidades_facturables, 51);
    assert.deepEqual([c.planes_disponibles.includes('basico'), c.basico_desde], [false, null]);
    assert.ok(c.planes_disponibles.includes('pro'), 'Pro sigue disponible');
    const r = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'basico' });
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.error, /Básico llega hasta 50 departamentos y este condominio tiene 51/);
    assert.equal((await prisma.suscripcionCondominio.findUnique({ where: { complejo_id: d.complejoA.id } }))?.solicitud_plan ?? null, null, 'no queda solicitud');
  });

  it('con Básico vigente no se crea el departamento 51 (403 LIMITE_UNIDADES), igual que Gratis frena el 21', async () => {
    await unidades(48);
    await ponerBasico();
    const tope = await llamar(base, 'POST', '/api/unidades', T.adminA, { codigo: 'BX-50', tipo: 'Departamento', complejo_id: d.complejoA.id });
    assert.equal(tope.status, 403, 'ya son 50: el 51 no entra');
    assert.equal(tope.body.code, 'LIMITE_UNIDADES');
    assert.equal(tope.body.limite, 50);
    await prisma.unidad.deleteMany({ where: { codigo: { startsWith: 'BX-4' } } }); // salen 9: quedan 41 y el siguiente sí cabe
    const cabe = await llamar(base, 'POST', '/api/unidades', T.adminA, { codigo: 'BX-nueva', tipo: 'Departamento', complejo_id: d.complejoA.id });
    assert.equal(cabe.status, 201, cabe.texto);
  });

  it('un condominio que ya tiene más de 50 no puede ofrecer ni cobrar Básico: se le sugiere Pro en el modal (planes_disponibles sin Básico)', async () => {
    await unidades(60);
    const c = await miPlan();
    assert.deepEqual([c.planes_disponibles.includes('basico'), c.planes_disponibles.includes('pro')], [false, true]);
  });
});

describe('Básico pagado y vigente', () => {
  it('es «activa», trae lo de Gratis (ningún módulo de Pro) y no está en solo lectura aunque su gratis_hasta ya pasó', async () => {
    await ponerBasico(20, { gratis_hasta: new Date(HOY() - 5 * DIA) });
    const c = await miPlan();
    assert.deepEqual([c.estado, c.solo_lectura, c.modulos_activos, c.dias_gratis_restantes, c.en_prueba], ['activa', false, [], null, false]);
    for (const m of ['ia_vouchers', 'whatsapp_avisos', 'asistente', 'mora_automatica', 'reportes'] as const) assert.equal(await moduloActivo(d.complejoA.id, m), false, m);
    const r = await llamar(base, 'POST', '/api/comunicados', T.adminA, { complejo_id: d.complejoA.id, titulo: 'Con Básico', cuerpo: 'Texto del comunicado con el plan Básico.' });
    assert.equal(r.status, 201, r.texto);
    await prisma.comunicado.deleteMany({ where: { titulo: 'Con Básico' } });
  });

  it('sin fecha de vencimiento (lo dejó así el superadmin) no vence y nunca queda en solo lectura', async () => {
    await ponerBasico(null, { gratis_hasta: new Date(HOY() - 5 * DIA) });
    const c = await miPlan();
    assert.deepEqual([c.estado, c.solo_lectura, c.vigente_hasta], ['activa', false, null]);
  });

  it('cuenta como plan de pago para el límite de «un condominio gratis»: la administradora puede crear otro', async () => {
    await ponerBasico();
    const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Segundo condominio', tipo: 'Edificio' });
    assert.equal(r.status, 201, r.texto);
    // Y ese segundo, ahora en Gratis, frena un tercero.
    const tercero = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Tercer condominio', tipo: 'Edificio' });
    assert.equal(tercero.status, 409, tercero.texto);
    await prisma.complejoHabitacional.delete({ where: { id: r.body.id } }).catch(() => undefined);
  });

  it('en cambio, un Básico vencido y apagado vuelve a contar como Gratis y, con el plazo pasado, queda en solo lectura', async () => {
    await ponerBasico(-30, { gratis_hasta: new Date(HOY() - 5 * DIA) });
    const c = await miPlan();
    assert.deepEqual([c.estado, c.solo_lectura], ['vencida', true]);
    const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Otro condominio', tipo: 'Edificio' });
    assert.equal(r.status, 409, 'cuenta como Gratis: no se agrega otro');
  });

  it('el superadmin lo activa por el pago: «Básico» queda como plan, con vigencia, y la pantalla de Suscripciones lo lista con su nombre', async () => {
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'gratis', estado: 'gratis' } });
    assert.equal((await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'basico' })).status, 200);
    const pago = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, { monto: '23.60', fecha_pago: iso(HOY()), medio: 'yape', operacion: 'OP-BASICO-1', periodo_desde: iso(HOY()), periodo_hasta: iso(HOY() + 30 * DIA) });
    assert.equal(pago.status, 201, pago.texto);
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
    assert.deepEqual([s.plan_clave, s.estado, s.solicitud_plan, iso(s.vigente_hasta!.getTime())], ['basico', 'activa', null, iso(HOY() + 30 * DIA)]);
    const lista = await llamar(base, 'GET', '/api/comercial/suscripciones', T.super);
    assert.equal(lista.body.items.find((x: { complejo_id: number }) => x.complejo_id === d.complejoA.id).plan.nombre, 'Básico');
  });
});
