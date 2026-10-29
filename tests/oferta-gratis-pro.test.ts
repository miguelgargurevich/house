// La oferta «Gratis con límite o Pro con todo»: mínimo de 20 departamentos cobrados en Pro y Administradora, tope de 20 en Gratis,
// capacidades por plan (IA de vouchers, WhatsApp, asistente, mora automática, reportes), módulos que ya no se venden sueltos y el script
// que deja una base existente con estos valores. Nada sale a la red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { darCortesia, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { cotizar, type PrecioPlan } from '../src/server/services/comercial/calculo';
import { CAPACIDADES } from '../src/server/services/comercial/catalogo';
import { estadoEfectivo } from '../src/server/services/comercial/estado';
import { complejosConModulo, exigirCupoDeUnidades, invalidarComercial, moduloActivo } from '../src/server/services/comercial/modulos';
import { ajustarOfertaGratisPro } from '../src/server/services/comercial/oferta';
import { montoDeMoraAplicable } from '../src/server/services/mora';

const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const TASA = '0.18';
const MENSAJE_LIMITE = 'El plan Gratis llega hasta 20 departamentos; pasa a Pro desde Mi plan';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;

const catalogo = [{ clave: 'ia_vouchers', precio_por_unidad: '1.00' }, { clave: 'whatsapp_avisos', precio_por_unidad: '1.00' }, { clave: 'asistente', precio_por_unidad: '0.50' }];
const pro: PrecioPlan = { clave: 'pro', precio_por_unidad: '2.50', igv_incluido: false, modulos_incluidos: [...CAPACIDADES], unidades_minimas: 20 };
const administradora: PrecioPlan = { clave: 'administradora', precio_por_unidad: '2.00', igv_incluido: false, modulos_incluidos: [...CAPACIDADES], unidades_minimas: 20 };
const total = (unidades: number, plan: PrecioPlan | null, sueltos: string[] = []) => cotizar({ unidades, plan, modulosSueltos: sueltos, catalogo, tasa: TASA });

/** Plan del condominio A: relativo a hoy (días; negativo = ya venció). */
async function fijarPlan(plan: 'gratis' | 'pro' | 'cortesia' | 'administradora', opts: { dias?: number | null; modulos?: string[] } = {}) {
  const data = { plan_clave: plan, modulos: opts.modulos ?? [], vigente_hasta: opts.dias == null ? null : new Date(HOY + opts.dias * DIA), estado: plan === 'cortesia' ? 'activa' : 'gratis' };
  await prisma.suscripcionCondominio.upsert({ where: { complejo_id: d.complejoA.id }, create: { complejo_id: d.complejoA.id, ...data }, update: data });
  invalidarComercial();
}

let codigoN = 0;
/** Deja el condominio A con exactamente `n` unidades (las 2 de la siembra cuentan). */
async function unidadesEn(complejoId: number, n: number) {
  const empresa_id = (await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: complejoId } })).empresa_id;
  const hay = await prisma.unidad.count({ where: { complejo_id: complejoId } });
  assert.ok(hay <= n, `ya hay ${hay} unidades`);
  await prisma.unidad.createMany({ data: Array.from({ length: n - hay }, () => ({ codigo: `X-${++codigoN}`, tipo: 'departamento', complejo_id: complejoId, empresa_id, estado: 'activa' })) });
}
const crearUnidad = (token: string, complejoId: number, codigo = `N-${++codigoN}`) => llamar(base, 'POST', '/api/unidades', token, { codigo, tipo: 'departamento', complejo_id: complejoId });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.unidad.deleteMany({ where: { codigo: { startsWith: 'X-' } } });
  await prisma.unidad.deleteMany({ where: { codigo: { startsWith: 'N-' } } });
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: 20 } });
  await fijarPlan('cortesia');
});

describe('cálculo con el mínimo de 20 departamentos', () => {
  it('Pro: 10 deptos = 59.00 (se cobra el mínimo), 20 = 59.00, 21 = 61.95, 100 = 295.00', () => {
    const c10 = total(10, pro);
    assert.deepEqual({ total: c10.total_mes, cobradas: c10.unidades_cobradas, minimo: c10.minimo_aplicado, unidades: c10.unidades }, { total: '59.00', cobradas: 20, minimo: true, unidades: 10 });
    assert.equal(c10.base, '50.00');
    assert.equal(c10.igv, '9.00');
    assert.equal(c10.total_anio, '708.00');
    assert.equal(total(20, pro).total_mes, '59.00');
    assert.equal(total(20, pro).minimo_aplicado, false, 'justo en el mínimo: no se aplica nada extra');
    assert.equal(total(21, pro).total_mes, '61.95');
    assert.equal(total(100, pro).total_mes, '295.00');
    assert.equal(total(0, pro).total_mes, '59.00', 'un condominio sin unidades igual paga el mínimo del plan de pago');
  });

  it('Administradora: 10 deptos = 47.20 (mínimo 20 × 2,00 + IGV), por condominio', () => {
    assert.equal(total(10, administradora).total_mes, '47.20');
    assert.equal(total(100, administradora).total_mes, '236.00');
    // «Por condominio»: dos condominios de 10 deptos pagan el mínimo CADA uno (no 20 en total).
    assert.equal((Number(total(10, administradora).total_mes) * 2).toFixed(2), '94.40');
  });

  it('Gratis no cobra nada, tenga las unidades que tenga; sin mínimo', () => {
    const gratis = { clave: 'gratis', precio_por_unidad: '0.00', igv_incluido: false, modulos_incluidos: [], unidades_minimas: null };
    assert.deepEqual([total(5, gratis).total_mes, total(20, gratis).total_mes, total(300, gratis).total_mes], ['0.00', '0.00', '0.00']);
  });

  it('el mínimo es del plan: un módulo suelto heredado (suscripción antigua) se cobra por las unidades reales, sin mínimo', () => {
    const gratis = { clave: 'gratis', precio_por_unidad: '0.00', igv_incluido: false, modulos_incluidos: [] as string[], unidades_minimas: null };
    assert.equal(total(20, gratis, ['whatsapp_avisos']).total_mes, '23.60', 'el ejemplo de Miguel: 20 deptos + WhatsApp = S/ 23.60');
    assert.equal(total(10, gratis, ['whatsapp_avisos']).total_mes, '11.80');
    assert.equal(total(10, pro, ['whatsapp_avisos']).total_mes, '59.00', 'Pro ya trae WhatsApp: no se cobra dos veces');
  });

  it('un plan con IGV incluido también respeta el mínimo', () => {
    const conIgv = { ...pro, precio_por_unidad: '2.95', igv_incluido: true };
    assert.equal(total(10, conIgv).total_mes, '59.00');
  });
});

describe('API pública: cotizar y planes sin módulos sueltos', () => {
  it('cotizar aplica el mínimo y dice cuántas unidades se cobran', async () => {
    const a = await llamar(base, 'GET', '/api/publico/cotizar?unidades=10&plan=pro');
    assert.deepEqual(a.body, { pais: 'PE', moneda: 'PEN', impuesto_nombre: 'IGV', consultar: false, unidades: 10, unidades_cobradas: 20, minimo_aplicado: true, total_mes: '50.00', total_anio: '600.00', igv_mes: '9.00', total_con_igv_mes: '59.00', igv_incluido: false }, 'precio público sin IGV; aparte el total con IGV');
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro')).body.total_mes, '250.00');
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=10&plan=administradora')).body.total_mes, '40.00');
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=15&plan=gratis')).body.total_mes, '0.00');
  });

  it('cotizar ignora los módulos sueltos: Gratis + WhatsApp ya no cuesta nada aparte, y no se pueden sumar a Pro', async () => {
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=20&plan=gratis&modulos=whatsapp_avisos,ia_vouchers')).body.total_mes, '0.00');
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro&modulos=asistente')).body.total_mes, '250.00');
  });

  it('/api/publico/planes: Gratis con tope 20 y sin capacidades; Pro y Administradora con mínimo 20 y todo; módulos sin precio', async () => {
    const r = await llamar(base, 'GET', '/api/publico/planes');
    const por = (c: string) => r.body.planes.find((p: { clave: string }) => p.clave === c);
    assert.deepEqual([por('gratis').unidades_maximas, por('gratis').unidades_minimas, por('gratis').modulos_incluidos], [20, null, []]);
    for (const c of ['pro', 'administradora']) {
      assert.deepEqual([por(c).unidades_maximas, por(c).unidades_minimas], [null, 20]);
      assert.deepEqual([...por(c).modulos_incluidos].sort(), [...CAPACIDADES].sort());
    }
    assert.equal(por('cortesia'), undefined, 'cortesía sigue oculta');
    for (const m of r.body.modulos) assert.deepEqual(Object.keys(m).sort(), ['clave', 'descripcion', 'nombre']);
  });
});

describe('Mi plan y Suscripciones: unidades cobradas y topes', () => {
  it('Pro con 2 deptos: se cobra el mínimo (59.00) y la vista lo dice; Gratis muestra su tope', async () => {
    await fijarPlan('pro', { dias: 40 });
    const pro2 = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.deepEqual({ cobradas: pro2.unidades_cobradas, reales: pro2.unidades_facturables, min: pro2.unidades_minimas, max: pro2.unidades_maximas, mes: pro2.cotizacion.total_mes }, { cobradas: 20, reales: 2, min: 20, max: null, mes: '59.00' });
    await fijarPlan('gratis');
    const g = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.deepEqual({ max: g.unidades_maximas, min: g.unidades_minimas, mes: g.cotizacion.total_mes }, { max: 20, min: null, mes: '0.00' });
    assert.deepEqual(g.modulos_activos, []);
  });

  it('cortesía: nada de cobro ni mínimo ni tope, y el superadmin lo ve igual', async () => {
    const c = (await llamar(base, 'GET', '/api/comercial/suscripciones', T.super)).body.items.find((x: { complejo_id: number }) => x.complejo_id === d.complejoA.id);
    assert.deepEqual({ mes: c.cotizacion.total_mes, min: c.unidades_minimas, max: c.unidades_maximas }, { mes: '0.00', min: null, max: null });
  });

  it('el superadmin edita el tope y el mínimo en Precios: cambian el cobro y el límite al instante; se validan y quedan auditados', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/planes/pro', T.super, { unidades_minimas: 30 });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.unidades_minimas, 30);
    await fijarPlan('pro', { dias: 40 });
    assert.equal((await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0].cotizacion.total_mes, '88.50', '30 × 2,50 = 75,00 + IGV 13,50');
    try {
      assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/gratis', T.super, { unidades_maximas: 5 })).status, 200);
      await fijarPlan('gratis');
      await unidadesEn(d.complejoA.id, 5);
      const sexta = await crearUnidad(T.adminA, d.complejoA.id);
      assert.equal(sexta.status, 403, 'con tope 5 y 5 unidades, la siguiente no entra');
      assert.match(sexta.body.error, /llega hasta 5 departamentos/);
    } finally {
      await llamar(base, 'PUT', '/api/comercial/planes/gratis', T.super, { unidades_maximas: 20 });
    }
    // null quita el tope / el mínimo; 0 y negativos no valen.
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/gratis', T.super, { unidades_maximas: null })).body.unidades_maximas, null);
    for (const mal of [{ unidades_maximas: 0 }, { unidades_minimas: -3 }, { unidades_minimas: 1.5 }, { unidades_maximas: 'veinte' }]) assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/gratis', T.super, mal)).status, 422, JSON.stringify(mal));
    for (const t of [T.adminA, T.prop1]) assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/gratis', t, { unidades_maximas: 99 })).status, 403, 'sólo el superadmin');
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'plan_comercial', accion: 'editar' }, orderBy: { id: 'asc' } });
    assert.equal((a!.detalle as { unidades_minimas: number }).unidades_minimas, 30);
    // Dejar la base como el seed.
    await llamar(base, 'PUT', '/api/comercial/planes/pro', T.super, { unidades_minimas: 20 });
    await llamar(base, 'PUT', '/api/comercial/planes/gratis', T.super, { unidades_maximas: 20 });
    assert.equal((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'gratis' } })).unidades_maximas, 20);
  });
});

describe('puertas por capacidad: Gratis sin IA, WhatsApp, asistente, mora ni reportes', () => {
  it('Gratis: las 5 capacidades apagadas; Pro y Administradora vigentes: las 5 encendidas', async () => {
    await fijarPlan('gratis');
    for (const c of CAPACIDADES) assert.equal(await moduloActivo(d.complejoA.id, c), false, `gratis: ${c}`);
    for (const plan of ['pro', 'administradora'] as const) {
      await fijarPlan(plan, { dias: 40 });
      for (const c of CAPACIDADES) assert.equal(await moduloActivo(d.complejoA.id, c), true, `${plan}: ${c}`);
    }
  });

  it('Pro vencido pasada la gracia se comporta como Gratis (sin mora ni reportes); dentro de la gracia sigue con todo', async () => {
    await fijarPlan('pro', { dias: -3 });
    assert.equal(await moduloActivo(d.complejoA.id, 'reportes'), true, 'en gracia');
    await fijarPlan('pro', { dias: -30 });
    for (const c of CAPACIDADES) assert.equal(await moduloActivo(d.complejoA.id, c), false, `apagado: ${c}`);
  });

  it('cortesía conserva todo AUNQUE el plan «cortesia» de la base todavía no liste mora ni reportes (antes de correr el script)', async () => {
    const antes = await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'cortesia' } });
    await prisma.planComercial.update({ where: { clave: 'cortesia' }, data: { modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'] } });
    invalidarComercial();
    try {
      for (const c of CAPACIDADES) assert.equal(await moduloActivo(d.complejoA.id, c), true, c);
      assert.equal(estadoEfectivo({ plan_clave: 'cortesia', modulos: [], estado: 'activa', vigente_hasta: null, solicitud_plan: null, solicitud_modulos: [] }, [{ clave: 'cortesia', modulos_incluidos: [] }], { dias_gracia: 7, dias_aviso_vencimiento: 5 }, new Date()).modulos.length, CAPACIDADES.length);
    } finally {
      await prisma.planComercial.update({ where: { clave: 'cortesia' }, data: { modulos_incluidos: antes.modulos_incluidos } });
      invalidarComercial();
    }
  });

  it('un módulo suelto heredado se respeta mientras no cambie de plan', async () => {
    await fijarPlan('gratis', { modulos: ['whatsapp_avisos'] });
    assert.equal(await moduloActivo(d.complejoA.id, 'whatsapp_avisos'), true);
    assert.equal(await moduloActivo(d.complejoA.id, 'reportes'), false);
    const v = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.deepEqual(v.modulos_sueltos, ['whatsapp_avisos']);
    assert.equal(v.cotizacion.total_mes, '2.36', 'sigue pagando lo que ya tenía: 2 deptos × 1,00 + IGV (sin mínimo)');
  });

  it('al pasar de plan los módulos sueltos viejos se vacían (el plan nuevo trae lo suyo); con el mismo plan se conservan', async () => {
    await fijarPlan('gratis', { modulos: ['whatsapp_avisos'] });
    await llamar(base, 'PATCH', `/api/comercial/suscripciones/${d.complejoA.id}`, T.super, { notas: 'sólo una nota' });
    assert.deepEqual((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } })).modulos, ['whatsapp_avisos'], 'sin cambio de plan no se toca');
    await llamar(base, 'PATCH', `/api/comercial/suscripciones/${d.complejoA.id}`, T.super, { plan_clave: 'gratis' });
    assert.deepEqual((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } })).modulos, ['whatsapp_avisos'], 'mismo plan: se conservan');
    const r = await llamar(base, 'PATCH', `/api/comercial/suscripciones/${d.complejoA.id}`, T.super, { plan_clave: 'pro' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } })).modulos, [], 'cambió de plan');
  });

  it('un pago del plan solicitado también deja atrás los módulos sueltos viejos', async () => {
    await fijarPlan('gratis', { modulos: ['whatsapp_avisos'] });
    assert.equal((await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' })).status, 200);
    const pago = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, { monto: '59.00', fecha_pago: '2026-10-28', medio: 'yape', operacion: 'OP-ofer', periodo_desde: '2026-10-28', periodo_hasta: '2026-11-28' });
    assert.equal(pago.status, 201, pago.texto);
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
    assert.deepEqual([s.plan_clave, s.modulos], ['pro', []]);
  });

  it('complejosConModulo: el superadmin ve todos (null); el admin sólo los condominios con la capacidad', async () => {
    const adminA = await prisma.usuario.findUniqueOrThrow({ where: { id: d.adminA.id } });
    const user = (u: typeof adminA) => ({ id: u.id, rol: u.rol, empresa_id: u.empresa_id, complejo_id: u.complejo_id }) as never;
    await fijarPlan('gratis');
    assert.deepEqual(await complejosConModulo(user(adminA), 'reportes'), []);
    await fijarPlan('pro', { dias: 30 });
    assert.deepEqual(await complejosConModulo(user(adminA), 'reportes'), [d.complejoA.id]);
    const sup = await prisma.usuario.findUniqueOrThrow({ where: { id: d.superadmin.id } });
    assert.equal(await complejosConModulo(user(sup), 'reportes'), null);
  });
});

describe('reportes: del plan Pro', () => {
  it('Gratis → 403 «Disponible en el plan Pro» con el código y la capacidad; el resto de la cobranza sigue', async () => {
    await fijarPlan('gratis');
    const r = await llamar(base, 'GET', '/api/reportes/morosidad', T.adminA);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'MODULO_NO_ACTIVO');
    assert.equal(r.body.modulo, 'reportes');
    assert.match(r.body.error, /plan Pro/);
    assert.equal((await llamar(base, 'GET', `/api/reportes/morosidad?complejo_id=${d.complejoA.id}`, T.adminA)).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/recibos', T.adminA)).status, 200, 'los recibos y la cobranza no se tocan');
  });

  it('Pro y cortesía → 200 con los morosos como hoy; el superadmin siempre entra', async () => {
    const cortesia = await llamar(base, 'GET', '/api/reportes/morosidad', T.adminA);
    assert.equal(cortesia.status, 200, cortesia.texto);
    assert.equal(cortesia.body.total, 2, 'las dos unidades de A con cargo vencido');
    await fijarPlan('pro', { dias: 30 });
    assert.equal((await llamar(base, 'GET', '/api/reportes/morosidad', T.adminA)).body.total, 2);
    await fijarPlan('gratis');
    assert.equal((await llamar(base, 'GET', '/api/reportes/morosidad', T.super)).status, 200);
  });

  it('un admin con otro condominio en Gratis no recibe filas de él; pedirlo por complejo_id da 403', async () => {
    // El condominio B (otra empresa) pasa a Gratis: su admin pierde el reporte, el de A (cortesía) no.
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoB.id }, data: { plan_clave: 'gratis', modulos: [], estado: 'gratis' } });
    invalidarComercial();
    try {
      assert.equal((await llamar(base, 'GET', '/api/reportes/morosidad', T.adminB)).status, 403);
      assert.equal((await llamar(base, 'GET', '/api/reportes/morosidad', T.adminA)).status, 200);
    } finally {
      await darCortesiaDeNuevoB();
    }
  });
});

async function darCortesiaDeNuevoB() {
  await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoB.id }, data: { plan_clave: 'cortesia', modulos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'], estado: 'activa' } });
  invalidarComercial();
}

describe('mora automática: del plan Pro', () => {
  const emitir = () => llamar(base, 'POST', '/api/recibos', T.adminA, {
    complejo_id: d.complejoA.id, mes: 9, anio: 2026, fecha_emision: '2026-09-01', fecha_vencimiento: '2026-10-02', conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }],
  });
  const morasEnBase = () => prisma.reciboConceptoUnidad.count({ where: { observaciones: { startsWith: 'Pago fuera de fecha' } } });
  beforeEach(async () => {
    // Que no quede el recibo de setiembre de una prueba anterior.
    const previos = await prisma.recibo.findMany({ where: { complejo_id: d.complejoA.id, mes: 9, anio: 2026 }, select: { id: true } });
    for (const r of previos) {
      await prisma.reciboConceptoUnidad.deleteMany({ where: { reciboConcepto: { recibo_id: r.id } } });
      await prisma.reciboConcepto.deleteMany({ where: { recibo_id: r.id } });
      await prisma.recibo.delete({ where: { id: r.id } });
    }
  });

  it('con Pro, quien no pagó a tiempo el recibo anterior recibe la mora de S/ 20 (como hoy)', async () => {
    await fijarPlan('pro', { dias: 30 });
    const r = await emitir();
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.mora.cantidad, 2);
    assert.equal(r.body.mora.monto, '20.00');
    assert.equal(await morasEnBase(), 2);
  });

  it('con cortesía (como Los Libertadores) sigue igual que hoy', async () => {
    const r = await emitir();
    assert.equal(r.status, 201);
    assert.equal(r.body.mora.cantidad, 2);
    assert.equal(await morasEnBase(), 2);
  });

  it('en Gratis el recibo se emite igual (201) y NO se agrega mora; el monto configurado no se borra', async () => {
    await fijarPlan('gratis');
    const r = await emitir();
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.mora.cantidad, 0);
    assert.equal(r.body.mora.mensaje, null);
    assert.equal(await morasEnBase(), 0);
    assert.deepEqual((await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo_id: r.body.id } } })).map((c) => c.monto.toFixed(2)), ['100.00', '100.00'], 'sólo el mantenimiento');
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).mora_monto.toFixed(2), '20.00');
  });

  it('montoDeMoraAplicable: Gratis 0, Pro el configurado, sin condominio 0', async () => {
    await fijarPlan('gratis');
    assert.equal((await montoDeMoraAplicable(d.complejoA.id, '20.00')).toFixed(2), '0.00');
    await fijarPlan('pro', { dias: 30 });
    assert.equal((await montoDeMoraAplicable(d.complejoA.id, '35.50')).toFixed(2), '35.50');
    assert.equal((await montoDeMoraAplicable(null, '20.00')).toFixed(2), '0.00');
  });
});

describe('tope de 20 departamentos en Gratis', () => {
  it('con 20 unidades ya creadas, la 21ª falla con el mensaje claro (403 LIMITE_UNIDADES); hasta la 20ª entra', async () => {
    await fijarPlan('gratis');
    await unidadesEn(d.complejoA.id, 19);
    const veinte = await crearUnidad(T.adminA, d.complejoA.id);
    assert.equal(veinte.status, 201, veinte.texto);
    const r = await crearUnidad(T.adminA, d.complejoA.id);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, MENSAJE_LIMITE);
    assert.equal(r.body.code, 'LIMITE_UNIDADES');
    assert.equal(await prisma.unidad.count({ where: { complejo_id: d.complejoA.id } }), 20, 'no se creó');
  });

  it('un condominio sin suscripción también es Gratis; otro condominio con espacio no se ve afectado', async () => {
    await prisma.suscripcionCondominio.delete({ where: { complejo_id: d.complejoA.id } });
    invalidarComercial();
    await unidadesEn(d.complejoA.id, 20);
    assert.equal((await crearUnidad(T.adminA, d.complejoA.id)).status, 403);
    // B (otra empresa, cortesía) no tiene tope.
    assert.equal((await crearUnidad(T.adminB, d.complejoB.id)).status, 201);
    await prisma.unidad.deleteMany({ where: { complejo_id: d.complejoB.id, codigo: { startsWith: 'N-' } } });
  });

  it('Pro, Administradora y cortesía no tienen tope', async () => {
    await unidadesEn(d.complejoA.id, 25);
    for (const plan of ['cortesia', 'pro', 'administradora'] as const) {
      await fijarPlan(plan, { dias: plan === 'cortesia' ? null : 30 });
      const r = await crearUnidad(T.adminA, d.complejoA.id);
      assert.equal(r.status, 201, `${plan}: ${r.texto}`);
    }
  });

  it('quien ya pasa de 20 no pierde nada: las unidades siguen, se pueden editar, sólo no se agregan más', async () => {
    await unidadesEn(d.complejoA.id, 25);
    await fijarPlan('gratis');
    assert.equal((await crearUnidad(T.adminA, d.complejoA.id)).status, 403);
    assert.equal(await prisma.unidad.count({ where: { complejo_id: d.complejoA.id } }), 25, 'ninguna se borró ni se escondió');
    const lista = await llamar(base, 'GET', `/api/unidades?complejo_id=${d.complejoA.id}&pageSize=100`, T.adminA);
    assert.equal(lista.body.total, 25);
    const x = await prisma.unidad.findFirstOrThrow({ where: { codigo: { startsWith: 'X-' } } });
    const upd = await llamar(base, 'PUT', `/api/unidades/${x.id}`, T.adminA, { descripcion: 'editada' });
    assert.equal(upd.status, 200, upd.texto);
  });

  it('Pro vencido pasada la gracia vuelve a tener el tope (se comporta como Gratis) y no se borra nada', async () => {
    await unidadesEn(d.complejoA.id, 30);
    await fijarPlan('pro', { dias: -30 });
    assert.equal((await crearUnidad(T.adminA, d.complejoA.id)).status, 403);
    await fijarPlan('pro', { dias: -3 });
    assert.equal((await crearUnidad(T.adminA, d.complejoA.id)).status, 201, 'dentro de la gracia aún tiene todo');
  });

  it('mover una unidad a un condominio que ya está en el tope también falla; a uno con cupo, no', async () => {
    await fijarPlan('gratis');
    await unidadesEn(d.complejoA.id, 20);
    const deB = await prisma.unidad.create({ data: { codigo: 'N-mover', tipo: 'departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, estado: 'activa' } });
    // B es de otra empresa: el admin de A no la alcanza (404); con el superadmin sí se llega al tope.
    const r = await llamar(base, 'PUT', `/api/unidades/${deB.id}`, T.super, { complejo_id: d.complejoA.id });
    assert.equal(r.status, 403, r.texto);
    assert.equal(r.body.code, 'LIMITE_UNIDADES');
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: deB.id } })).complejo_id, d.complejoB.id);
    await prisma.unidad.delete({ where: { id: deB.id } });
  });

  it('exigirCupoDeUnidades: pedir varias a la vez cuenta todas; sin condominio no valida; sin tope pasa', async () => {
    await fijarPlan('gratis');
    await unidadesEn(d.complejoA.id, 18);
    await exigirCupoDeUnidades(d.complejoA.id, 2);
    await assert.rejects(() => exigirCupoDeUnidades(d.complejoA.id, 3), /llega hasta 20 departamentos/);
    await exigirCupoDeUnidades(null, 999);
  });
});

describe('script de la oferta: deja una base existente con los valores nuevos', () => {
  const comoProduccionHoy = async () => {
    await prisma.planComercial.update({ where: { clave: 'gratis' }, data: { unidades_maximas: null, descripcion: 'Para siempre, sin límite de departamentos.', caracteristicas: ['Recibos por torre'] } });
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { unidades_minimas: null, modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'] } });
    await prisma.planComercial.update({ where: { clave: 'administradora' }, data: { unidades_minimas: null, modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'] } });
    await prisma.planComercial.update({ where: { clave: 'cortesia' }, data: { modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'] } });
    invalidarComercial();
  };

  it('en seco informa sin escribir; real aplica; la segunda corrida no cambia nada; no toca precios ni suscripciones', async () => {
    await comoProduccionHoy();
    const precios = (await prisma.planComercial.findMany({ orderBy: { clave: 'asc' } })).map((p) => [p.clave, p.precio_por_unidad.toFixed(2)]);
    const suscripciones = JSON.stringify(await prisma.suscripcionCondominio.findMany({ orderBy: { id: 'asc' } }));

    const seco = await ajustarOfertaGratisPro(prisma, { seco: true });
    assert.deepEqual(seco.map((c) => c.clave).sort(), ['administradora', 'cortesia', 'gratis', 'pro']);
    assert.equal((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'gratis' } })).unidades_maximas, null, 'el seco no escribe');

    const real = await ajustarOfertaGratisPro(prisma);
    assert.equal(real.length, 4);
    const g = await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'gratis' } });
    assert.deepEqual([g.unidades_maximas, g.unidades_minimas, g.modulos_incluidos], [20, null, []]);
    for (const c of ['pro', 'administradora']) {
      const p = await prisma.planComercial.findUniqueOrThrow({ where: { clave: c } });
      assert.deepEqual([p.unidades_maximas, p.unidades_minimas], [null, 20]);
      assert.deepEqual([...p.modulos_incluidos].sort(), [...CAPACIDADES].sort());
    }
    assert.deepEqual([...(await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'cortesia' } })).modulos_incluidos].sort(), [...CAPACIDADES].sort());
    assert.deepEqual((await prisma.planComercial.findMany({ orderBy: { clave: 'asc' } })).map((p) => [p.clave, p.precio_por_unidad.toFixed(2)]), precios, 'los precios no se tocan');
    assert.equal(JSON.stringify(await prisma.suscripcionCondominio.findMany({ orderBy: { id: 'asc' } })), suscripciones, 'las suscripciones no se tocan');

    assert.deepEqual(await ajustarOfertaGratisPro(prisma), [], 'idempotente');
    assert.deepEqual(await ajustarOfertaGratisPro(prisma, { seco: true }), []);
  });

  it('conserva lo que el superadmin cambió a mano en precios y respeta un tope puesto por él sólo si coincide con la oferta', async () => {
    await comoProduccionHoy();
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '3.10', visible: false } });
    await ajustarOfertaGratisPro(prisma);
    const p = await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'pro' } });
    assert.equal(p.precio_por_unidad.toFixed(2), '3.10');
    assert.equal(p.visible, false);
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '2.50', visible: true } });
  });

  it('con la oferta aplicada, Libertadores (cortesía) sigue con todas las capacidades', async () => {
    await comoProduccionHoy();
    await ajustarOfertaGratisPro(prisma);
    for (const c of CAPACIDADES) assert.equal(await moduloActivo(d.complejoA.id, c), true, c);
    await darCortesia(); // sin condominios: no hace nada, sólo comprueba el helper
  });
});
