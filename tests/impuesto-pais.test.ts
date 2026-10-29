// Impuesto y moneda de la suscripción por país (fase 3 de multimoneda): tabla sembrada sin pisar lo editado, cotización con IGV en soles (= la de siempre)
// y con IVA en pesos chilenos (sin decimales), país sin precio → no contratable, API pública por país y edición del superadmin (auditada, nadie más).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { PAISES } from '../src/lib/paises';
import { cotizar, desglosarMonto } from '../src/server/services/comercial/calculo';
import { sembrarCatalogoComercial } from '../src/server/services/comercial/catalogo';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { procesarVencimientos } from '../src/server/services/comercial/vencimientos';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { hoyLima } from '../src/server/lib/fechas';

const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'mtto' | 'seg', string>;

const pro = { clave: 'pro', igv_incluido: false, modulos_incluidos: [], unidades_minimas: 20 };
const pagoBody = (over: Record<string, unknown> = {}) => ({ monto: '45220', fecha_pago: iso(HOY), medio: 'transferencia', operacion: 'OP-CL-1', periodo_desde: iso(HOY), periodo_hasta: iso(HOY + 30 * DIA), ...over });

/** Condominio A en Chile (pesos chilenos, IVA 19 %) con Pro a $ 1.900 por departamento; Perú (condominio B) queda como está. */
async function chileConPro() {
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { pais: 'CL', moneda: 'CLP' } });
  await prisma.precioPlanMoneda.upsert({ where: { plan_clave_moneda: { plan_clave: 'pro', moneda: 'CLP' } }, create: { plan_clave: 'pro', moneda: 'CLP', precio_por_unidad: '1900' }, update: { precio_por_unidad: '1900' } });
  invalidarComercial();
}

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), mtto: await login(base, 'mtto.a@test.pe'), seg: await login(base, 'seg.a@test.pe'),
  };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.pagoSuscripcion.deleteMany();
  await prisma.suscripcionCondominio.deleteMany();
  await prisma.precioPlanMoneda.deleteMany();
  await prisma.auditoria.deleteMany();
  await prisma.complejoHabitacional.updateMany({ data: { pais: 'PE', moneda: 'PEN' } });
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { igv_tasa: '0.18', dias_gracia: 7, dias_aviso_vencimiento: 5, correo_superadmin: null } });
  await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '2.50' } });
  await prisma.impuestoPais.deleteMany();
  await sembrarCatalogoComercial(prisma);
  invalidarComercial();
});
afterEach(() => { invalidarComercial(); });

describe('tabla ImpuestoPais: se siembra desde el catálogo y nunca pisa lo editado', () => {
  it('un país por fila con el impuesto y la moneda del catálogo: Perú = IGV 18 % en soles; Chile = IVA 19 % en pesos; EE. UU. sin impuesto nacional (tasa 0)', async () => {
    const filas = await prisma.impuestoPais.findMany();
    assert.equal(filas.length, PAISES.length);
    const f = (p: string) => filas.find((x) => x.pais === p)!;
    assert.deepEqual([f('PE').nombre, f('PE').tasa.toString(), f('PE').moneda, f('PE').activo], ['IGV', '0.18', 'PEN', true]);
    assert.deepEqual([f('CL').nombre, f('CL').tasa.toString(), f('CL').moneda], ['IVA', '0.19', 'CLP']);
    assert.deepEqual([f('DO').nombre, f('DO').tasa.toString()], ['ITBIS', '0.18']);
    assert.equal(f('US').tasa.toString(), '0', 'sin impuesto nacional: no se cobra ninguno hasta que el superadmin lo fije');
  });

  it('volver a sembrar NO pisa lo que editó el superadmin y sólo CREA la fila que falta', async () => {
    await prisma.impuestoPais.update({ where: { pais: 'CL' }, data: { tasa: '0.2', nombre: 'IVA (tarifa nueva)', moneda: 'USD', activo: false } });
    await prisma.impuestoPais.delete({ where: { pais: 'MX' } });
    await sembrarCatalogoComercial(prisma);
    const cl = await prisma.impuestoPais.findUniqueOrThrow({ where: { pais: 'CL' } });
    assert.deepEqual([cl.tasa.toString(), cl.nombre, cl.moneda, cl.activo], ['0.2', 'IVA (tarifa nueva)', 'USD', false], 'lo editado queda');
    const mx = await prisma.impuestoPais.findUniqueOrThrow({ where: { pais: 'MX' } });
    assert.deepEqual([mx.nombre, mx.tasa.toString()], ['IVA', '0.16'], 'la que faltaba se crea');
    assert.equal(await prisma.impuestoPais.count(), PAISES.length, 'sin duplicados');
  });

  it('Perú arranca con el `igv_tasa` que ya tenía la configuración (no cambia lo que se cobra)', async () => {
    await prisma.impuestoPais.deleteMany();
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { igv_tasa: '0.1' } });
    await sembrarCatalogoComercial(prisma);
    assert.equal((await prisma.impuestoPais.findUniqueOrThrow({ where: { pais: 'PE' } })).tasa.toString(), '0.1');
    assert.equal((await prisma.impuestoPais.findUniqueOrThrow({ where: { pais: 'CL' } })).tasa.toString(), '0.19', 'los demás, del catálogo');
  });
});

describe('cotizar con el impuesto y la moneda del país', () => {
  it('Perú: IGV 18 % en soles, los mismos números de siempre (448 deptos × 2,50 = 1120,00 + 201,60 = 1321,60)', () => {
    const c = cotizar({ unidades: 448, plan: { ...pro, precio_por_unidad: '2.50' }, modulosSueltos: [], catalogo: [], tasa: '0.18', moneda: 'PEN', impuestoNombre: 'IGV' });
    assert.deepEqual([c.base, c.igv, c.total_mes, c.total_anio, c.moneda, c.impuesto_nombre], ['1120.00', '201.60', '1321.60', '15859.20', 'PEN', 'IGV']);
  });

  it('Chile: IVA 19 % en pesos SIN decimales (100 deptos × $ 1.900 = 190.000 + 36.100 = 226.100)', () => {
    const c = cotizar({ unidades: 100, plan: { ...pro, precio_por_unidad: '1900' }, modulosSueltos: [], catalogo: [], tasa: '0.19', moneda: 'CLP', impuestoNombre: 'IVA' });
    assert.deepEqual([c.base, c.igv, c.total_mes, c.total_anio, c.moneda, c.impuesto_nombre], ['190000', '36100', '226100', '2713200', 'CLP', 'IVA']);
  });

  it('en pesos el redondeo es a entero y base + IVA = total exacto (33 deptos × $ 1.234 = 40.722; IVA 7.737,18 → 7.737; total 48.459)', () => {
    const c = cotizar({ unidades: 33, plan: { ...pro, unidades_minimas: null, precio_por_unidad: '1234' }, modulosSueltos: [], catalogo: [], tasa: '0.19', moneda: 'CLP' });
    assert.deepEqual([c.base, c.igv, c.total_mes], ['40722', '7737', '48459']);
    assert.equal(Number(c.base) + Number(c.igv), Number(c.total_mes));
    assert.equal(c.lineas[0].precio_unidad_base, '1234', 'ni el precio por unidad lleva decimales en pesos');
  });

  it('desglosar un pago respeta los decimales de la moneda: $ 45.220 con IVA 19 % = 38.000 + 7.220', () => {
    const r = desglosarMonto('45220', '0.19', 'CLP');
    assert.deepEqual([r.base.toString(), r.igv.toString(), r.total.toString()], ['38000', '7220', '45220']);
    const s = desglosarMonto('5.90', '0.18');
    assert.deepEqual([s.base.toFixed(2), s.igv.toFixed(2)], ['5.00', '0.90'], 'sin moneda, soles como siempre');
  });
});

describe('Mi plan y la solicitud usan el impuesto y la moneda del país del condominio', () => {
  it('un condominio chileno ve su plan en pesos con IVA (Pro: mínimo 20 × $ 1.900 = 38.000 + 7.220 = 45.220); el peruano sigue en soles con IGV', async () => {
    await chileConPro();
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'pro', estado: 'activa', vigente_hasta: new Date(HOY + 30 * DIA) } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoB.id, plan_clave: 'pro', estado: 'activa', vigente_hasta: new Date(HOY + 30 * DIA) } });
    const a = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.deepEqual([a.pais, a.moneda, a.impuesto], ['CL', 'CLP', { nombre: 'IVA', tasa: '0.19' }]);
    assert.deepEqual([a.cotizacion.base, a.cotizacion.igv, a.cotizacion.total_mes, a.cotizacion.moneda, a.cotizacion.impuesto_nombre], ['38000', '7220', '45220', 'CLP', 'IVA']);
    assert.equal(a.precio_consultar, false);
    assert.deepEqual(a.planes_disponibles, ['pro'], 'Administradora no tiene precio en pesos: no se puede pedir');
    const b = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminB)).body.condominios[0];
    assert.deepEqual([b.pais, b.moneda, b.impuesto.nombre, b.cotizacion.total_mes], ['PE', 'PEN', 'IGV', '59.00'], 'Perú: lo de siempre (20 × 2,50 = 50,00 + 9,00)');
    assert.deepEqual(b.planes_disponibles, ['pro', 'administradora']);
  });

  it('un plan sin precio en la moneda del país no se puede pedir («Consúltanos»): 422 y no queda solicitud; el que sí tiene precio, sí', async () => {
    await chileConPro();
    const mal = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'administradora' });
    assert.equal(mal.status, 422, mal.texto);
    assert.match(mal.body.error, /consúltanos/i);
    assert.equal(await prisma.suscripcionCondominio.count({ where: { complejo_id: d.complejoA.id, solicitud_plan: { not: null } } }), 0);
    const bien = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' });
    assert.equal(bien.status, 200, bien.texto);
    assert.equal(bien.body.solicitud.cotizacion.total_mes, '45220');
    assert.equal(bien.body.solicitud.consultar, false);
  });

  it('un país cerrado (activo = false) no puede contratar aunque el plan tenga precio', async () => {
    await chileConPro();
    await prisma.impuestoPais.update({ where: { pais: 'CL' }, data: { activo: false } });
    const r = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' });
    assert.equal(r.status, 422, r.texto);
  });

  it('Registrar pago: se guarda en la moneda y con el impuesto del país, y un pago ya registrado NO cambia si después se edita la tasa', async () => {
    await chileConPro();
    await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' });
    const r = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody());
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual({ base: r.body.pago.base, igv: r.body.pago.igv, monto: r.body.pago.monto, moneda: r.body.pago.moneda, imp: r.body.pago.impuesto_nombre, tasa: r.body.pago.impuesto_tasa }, { base: '38000', igv: '7220', monto: '45220', moneda: 'CLP', imp: 'IVA', tasa: '0.19' });
    const edit = await llamar(base, 'PUT', '/api/comercial/impuestos/CL', T.super, { tasa: '0.21' });
    assert.equal(edit.status, 200, edit.texto);
    const h = (await llamar(base, 'GET', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super)).body.items[0];
    assert.deepEqual([h.base, h.igv, h.monto, h.moneda, h.impuesto_nombre, h.impuesto_tasa], ['38000', '7220', '45220', 'CLP', 'IVA', '0.19'], 'el pago de ayer queda como se registró');
    const propio = (await llamar(base, 'GET', `/api/comercial/mi-plan/${d.complejoA.id}/pagos`, T.adminA)).body.items[0];
    assert.deepEqual([propio.monto, propio.moneda, propio.impuesto_nombre], ['45220', 'CLP', 'IVA']);
    const a = await prisma.auditoria.findFirst({ where: { accion: 'registrar_pago' } });
    assert.deepEqual([(a!.detalle as { monto: string }).monto, (a!.detalle as { moneda: string }).moneda], ['45220', 'CLP']);
  });

  it('en pesos el monto del pago no lleva decimales (422); en soles se acepta con dos como siempre', async () => {
    await chileConPro();
    await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' });
    const mal = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody({ monto: '45220.50' }));
    assert.equal(mal.status, 422, mal.texto);
    assert.equal(await prisma.pagoSuscripcion.count(), 0);
    await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoB.id}/solicitud`, T.adminB, { plan: 'pro' });
    const sol = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoB.id}/pagos`, T.super, pagoBody({ monto: '5.90', operacion: 'OP-PE-1' }));
    assert.equal(sol.status, 201, sol.texto);
    assert.deepEqual([sol.body.pago.base, sol.body.pago.igv, sol.body.pago.moneda, sol.body.pago.impuesto_nombre, sol.body.pago.impuesto_tasa], ['5.00', '0.90', 'PEN', 'IGV', '0.18']);
  });

  it('el aviso de vencimiento habla en la moneda y con el impuesto del país («$ 45.220 al mes (IVA incluido)»), y el de Perú sigue en soles con IGV', async () => {
    await chileConPro();
    await prisma.usuario.update({ where: { email: 'admin.a@test.pe' }, data: { correo_verificado: true } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'pro', vigente_hasta: new Date(HOY + 4 * DIA), estado: 'activa' } });
    const enviados: string[] = [];
    const deps: DepsAvisos = {
      ahora: () => new Date(HOY + 17 * 3_600_000), env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <house@ejemplo.test>' },
      fetch: (async (_u: string | URL | Request, init?: RequestInit) => { enviados.push(JSON.parse(String(init?.body)).text); return new Response('{}', { status: 200 }); }) as typeof fetch,
    };
    const original = comercialCorreo.deps;
    comercialCorreo.deps = () => deps;
    try {
      const r = await procesarVencimientos({ ahora: new Date(HOY + 17 * 3_600_000), deps });
      assert.equal(r.correos, 1);
    } finally { comercialCorreo.deps = original; }
    assert.match(enviados[0], /\$ 45\.220 al mes \(IVA incluido\)/);
    assert.doesNotMatch(enviados[0], /S\/|IGV/);
  });
});

describe('API pública por país', () => {
  const planes = async (q = '') => (await llamar(base, 'GET', `/api/publico/planes${q}`)).body;
  const porClave = (c: { planes: { clave: string }[] }, k: string) => c.planes.find((p) => p.clave === k) as unknown as Record<string, unknown>;

  it('sin `?pais=` es Perú: soles, IGV y los precios de siempre', async () => {
    const c = await planes();
    assert.deepEqual([c.pais, c.moneda, c.impuesto], ['PE', 'PEN', { nombre: 'IGV', tasa: '0.18' }]);
    assert.deepEqual([porClave(c, 'pro').precio_por_unidad, porClave(c, 'administradora').precio_por_unidad, porClave(c, 'gratis').precio_por_unidad], ['2.50', '2.00', '0.00']);
    assert.equal(porClave(c, 'pro').consultar, false);
  });

  it('`?pais=CL`: pesos sin decimales e IVA; el plan con precio en pesos lo muestra y el que no, «Consúltanos» (precio null)', async () => {
    await prisma.precioPlanMoneda.create({ data: { plan_clave: 'pro', moneda: 'CLP', precio_por_unidad: '1900' } });
    const c = await planes('?pais=CL');
    assert.deepEqual([c.pais, c.moneda, c.impuesto], ['CL', 'CLP', { nombre: 'IVA', tasa: '0.19' }]);
    assert.deepEqual([porClave(c, 'pro').precio_por_unidad, porClave(c, 'pro').consultar, porClave(c, 'pro').total_minimo_mes], ['1900', false, '38000']);
    assert.deepEqual([porClave(c, 'administradora').precio_por_unidad, porClave(c, 'administradora').consultar, porClave(c, 'administradora').total_minimo_mes], [null, true, null]);
    assert.deepEqual([porClave(c, 'gratis').precio_por_unidad, porClave(c, 'gratis').consultar], ['0', false], 'Gratis es gratis en todas partes');
    assert.deepEqual((await planes('?pais=cl')).pais, 'CL', 'minúsculas también');
  });

  it('el selector: lista los países abiertos con su moneda e impuesto; uno cerrado no está y, si se pide, responde Perú', async () => {
    await prisma.impuestoPais.update({ where: { pais: 'MX' }, data: { activo: false } });
    const c = await planes();
    const codigos = c.paises.map((p: { codigo: string }) => p.codigo);
    assert.ok(codigos.includes('PE') && codigos.includes('CL'));
    assert.ok(!codigos.includes('MX'), 'un país cerrado no se ofrece');
    assert.deepEqual(c.paises.find((p: { codigo: string }) => p.codigo === 'CL'), { codigo: 'CL', nombre: 'Chile', bandera: '🇨🇱', moneda: 'CLP', impuesto: { nombre: 'IVA', tasa: '0.19' } });
    const cerrado = await planes('?pais=MX');
    assert.deepEqual([cerrado.pais, cerrado.moneda], ['PE', 'PEN']);
  });

  it('`?pais=` con algo que no es un país → 422', async () => {
    assert.equal((await llamar(base, 'GET', '/api/publico/planes?pais=ZZ')).status, 422);
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=10&pais=ZZ')).status, 422);
  });

  it('cotizar en Chile: 100 deptos en Pro = $ 190.000 + IVA 36.100 = 226.100 al mes; el plan sin precio en pesos devuelve consultar y totales null', async () => {
    await prisma.precioPlanMoneda.create({ data: { plan_clave: 'pro', moneda: 'CLP', precio_por_unidad: '1900' } });
    const c = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro&pais=CL')).body;
    assert.deepEqual(c, { pais: 'CL', moneda: 'CLP', impuesto_nombre: 'IVA', consultar: false, unidades: 100, unidades_cobradas: 100, minimo_aplicado: false, total_mes: '190000', total_anio: '2280000', igv_mes: '36100', total_con_igv_mes: '226100', igv_incluido: false });
    const sin = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=administradora&pais=CL')).body;
    assert.deepEqual([sin.consultar, sin.total_mes, sin.total_anio, sin.igv_mes, sin.total_con_igv_mes, sin.moneda], [true, null, null, null, null, 'CLP']);
    const pe = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro')).body;
    assert.deepEqual([pe.total_mes, pe.igv_mes, pe.total_con_igv_mes, pe.moneda, pe.impuesto_nombre], ['250.00', '45.00', '295.00', 'PEN', 'IGV'], 'Perú: igual que antes');
  });

  it('la API pública no expone tasas internas ni datos de pago', async () => {
    const t = (await llamar(base, 'GET', '/api/publico/planes?pais=CL')).texto;
    for (const prohibido of ['igv_tasa', 'pago_', 'correo_superadmin', 'updated_at']) assert.ok(!t.includes(prohibido), `no debe exponer ${prohibido}`);
  });
});

describe('el superadmin edita impuestos y precios por moneda (auditado); nadie más', () => {
  it('editar el impuesto de un país: queda guardado, lo ve la API pública y queda en la auditoría con lo que cambió', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/impuestos/CL', T.super, { nombre: 'IVA', tasa: 0.2, activo: true });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.body.pais, r.body.nombre, r.body.tasa], ['CL', 'IVA', '0.2']);
    assert.equal((await llamar(base, 'GET', '/api/publico/planes?pais=CL')).body.impuesto.tasa, '0.2');
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'impuesto_pais', accion: 'editar' }, orderBy: { id: 'desc' } });
    assert.ok(a);
    assert.equal(a.usuario_id, d.superadmin.id);
    assert.deepEqual(a.detalle, { pais: 'CL', nombre: 'IVA', tasa: '0.2', activo: true });
  });

  it('cerrar un país o cambiar su moneda de cobro se refleja en el catálogo del superadmin', async () => {
    await llamar(base, 'PUT', '/api/comercial/impuestos/CL', T.super, { moneda: 'USD', activo: false });
    const c = (await llamar(base, 'GET', '/api/comercial/catalogo', T.super)).body;
    const cl = c.impuestos.find((i: { pais: string }) => i.pais === 'CL');
    assert.deepEqual([cl.moneda, cl.activo], ['USD', false]);
    assert.equal(c.impuestos.length, PAISES.length);
    assert.ok(Array.isArray(c.precios_moneda));
  });

  it('la tasa de Perú y `igv_tasa` van juntas: editar una cambia la otra', async () => {
    await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { igv_tasa: '0.10' });
    assert.equal((await prisma.impuestoPais.findUniqueOrThrow({ where: { pais: 'PE' } })).tasa.toString(), '0.1');
    assert.equal((await llamar(base, 'GET', '/api/publico/planes')).body.impuesto.tasa, '0.1');
    await llamar(base, 'PUT', '/api/comercial/impuestos/PE', T.super, { tasa: '0.12' });
    assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).igv_tasa.toString(), '0.12');
    const c = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro')).body;
    assert.deepEqual([c.igv_mes, c.total_con_igv_mes], ['30.00', '280.00']);
  });

  it('datos inválidos → 422: tasa fuera de 0–1, moneda o país que no existen, nombre vacío; un país válido pero sin fila no pasa de 404', async () => {
    for (const mal of [{ tasa: 5 }, { tasa: -1 }, { moneda: 'XXX' }, { nombre: '' }, { activo: 'si' }]) assert.equal((await llamar(base, 'PUT', '/api/comercial/impuestos/CL', T.super, mal)).status, 422, JSON.stringify(mal));
    assert.equal((await llamar(base, 'PUT', '/api/comercial/impuestos/ZZ', T.super, { tasa: 0.1 })).status, 422);
    await prisma.impuestoPais.delete({ where: { pais: 'CL' } });
    assert.equal((await llamar(base, 'PUT', '/api/comercial/impuestos/CL', T.super, { tasa: 0.1 })).status, 404);
  });

  it('precio de un plan en otra moneda: se fija, lo ve la API pública y el aviso queda auditado; se quita y vuelve a «Consúltanos»', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/COP', T.super, { precio_por_unidad: '8000' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await llamar(base, 'GET', '/api/publico/planes?pais=CO')).body.planes.find((p: { clave: string }) => p.clave === 'pro').precio_por_unidad, '8000');
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'precio_plan_moneda', accion: 'editar' } });
    assert.deepEqual(a!.detalle, { plan: 'pro', moneda: 'COP', precio_por_unidad: '8000' });
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/COP', T.super, { precio_por_unidad: '8500' })).status, 200, 'se puede volver a editar');
    assert.equal((await prisma.precioPlanMoneda.findUniqueOrThrow({ where: { plan_clave_moneda: { plan_clave: 'pro', moneda: 'COP' } } })).precio_por_unidad.toString(), '8500');
    assert.equal((await llamar(base, 'DELETE', '/api/comercial/planes/pro/precios/COP', T.super)).status, 204);
    const p = (await llamar(base, 'GET', '/api/publico/planes?pais=CO')).body.planes.find((x: { clave: string }) => x.clave === 'pro');
    assert.deepEqual([p.precio_por_unidad, p.consultar], [null, true]);
    assert.ok(await prisma.auditoria.findFirst({ where: { entidad: 'precio_plan_moneda', accion: 'quitar' } }));
  });

  it('el precio en soles es el del plan; en pesos no lleva decimales; plan o moneda inexistentes no pasan; el de soles no se quita', async () => {
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/PEN', T.super, { precio_por_unidad: '3.00' })).status, 200);
    assert.equal((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'pro' } })).precio_por_unidad.toString(), '3');
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/CLP', T.super, { precio_por_unidad: '1900.50' })).status, 422);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/XXX', T.super, { precio_por_unidad: '10' })).status, 422);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/nada/precios/CLP', T.super, { precio_por_unidad: '10' })).status, 404);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/CLP', T.super, { precio_por_unidad: '-5' })).status, 422);
    assert.equal((await llamar(base, 'DELETE', '/api/comercial/planes/pro/precios/PEN', T.super)).status, 422);
    assert.equal((await llamar(base, 'DELETE', '/api/comercial/planes/pro/precios/CLP', T.super)).status, 404, 'quitar lo que no hay');
  });

  it('un plan gratuito es gratis en todas partes: Gratis no necesita precio en la moneda del país', async () => {
    await chileConPro();
    const a = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.deepEqual([a.plan.clave, a.cotizacion.total_mes, a.precio_consultar], ['gratis', '0', false]);
  });

  it('sólo el superadmin: administrador, propietario, mantenimiento y seguridad reciben 403; sin sesión, 401', async () => {
    const llamadas: [string, string, unknown][] = [
      ['PUT', '/api/comercial/impuestos/CL', { tasa: 0.5 }],
      ['PUT', '/api/comercial/planes/pro/precios/CLP', { precio_por_unidad: '1' }],
      ['DELETE', '/api/comercial/planes/pro/precios/CLP', undefined],
      ['GET', '/api/comercial/catalogo', undefined],
    ];
    for (const [rol, tok] of [['admin', T.adminA], ['propietario', T.prop1], ['mantenimiento', T.mtto], ['seguridad', T.seg]] as const) {
      for (const [m, ruta, body] of llamadas) assert.equal((await llamar(base, m, ruta, tok, body)).status, 403, `${rol} ${m} ${ruta}`);
    }
    for (const [m, ruta, body] of llamadas) assert.equal((await llamar(base, m, ruta, null, body)).status, 401, `sin sesión ${m} ${ruta}`);
    assert.equal((await prisma.impuestoPais.findUniqueOrThrow({ where: { pais: 'CL' } })).tasa.toString(), '0.19', 'nada cambió');
    assert.equal(await prisma.precioPlanMoneda.count(), 0);
  });
});
