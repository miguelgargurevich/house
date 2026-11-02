// Precio por tramos de Torre Pro y Torre Administradora (Miguel, 31-oct): los primeros 60 departamentos al precio normal y del 61 en adelante a un precio menor.
// `cotizar` con y sin tramo (frontera 60/61, mínimo, IGV una vez, moneda sin decimales), el seed y el script de la oferta, la API pública, la edición del
// superadmin (validada y auditada), el precio por moneda y el detalle de dos líneas en Mi plan. Nada sale a la red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { cotizar, type PrecioPlan } from '../src/server/services/comercial/calculo';
import { CAPACIDADES, PLANES_SEED, sembrarCatalogoComercial } from '../src/server/services/comercial/catalogo';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { ajustarOfertaGratisPro } from '../src/server/services/comercial/oferta';

const TASA = '0.18';
const pro: PrecioPlan = { clave: 'pro', precio_por_unidad: '3.00', igv_incluido: false, modulos_incluidos: [...CAPACIDADES], unidades_minimas: 20, tramo_desde: 61, tramo_precio: '2.00' };
const administradora: PrecioPlan = { clave: 'administradora', precio_por_unidad: '2.50', igv_incluido: false, modulos_incluidos: [...CAPACIDADES], unidades_minimas: 20, tramo_desde: 61, tramo_precio: '1.70' };
const total = (unidades: number, plan: PrecioPlan | null, extra: { tasa?: string; moneda?: string } = {}) => cotizar({ unidades, plan, modulosSueltos: [], catalogo: [], tasa: extra.tasa ?? TASA, moneda: extra.moneda });

describe('cotizar con tramo', () => {
  // [departamentos, base sin IGV, total con IGV 18 %, departamentos al precio del tramo]
  const casos: [number, string, string, number][] = [
    [20, '60.00', '70.80', 0],
    [50, '150.00', '177.00', 0],
    [60, '180.00', '212.40', 0],
    [61, '182.00', '214.76', 1],
    [80, '220.00', '259.60', 20],
    [150, '360.00', '424.80', 90],
    [300, '660.00', '778.80', 240],
  ];
  for (const [n, base, conIgv, enTramo] of casos) {
    it(`Pro con ${n} departamentos: base ${base}, con IGV ${conIgv}`, () => {
      const c = total(n, pro);
      assert.deepEqual([c.base, c.total_mes, c.unidades_tramo], [base, conIgv, enTramo]);
    });
  }

  it('la frontera es el departamento 61: con 60 hay una línea y con 61 dos (60 a 3.00 y 1 a 2.00)', () => {
    const a = total(60, pro);
    assert.equal(a.lineas.length, 1);
    assert.deepEqual([a.lineas[0].unidades, a.lineas[0].precio_unidad_base, a.lineas[0].base], [60, '3.00', '180.00']);
    const b = total(61, pro);
    assert.equal(b.lineas.length, 2);
    assert.deepEqual(b.lineas.map((l) => [l.unidades, l.precio_unidad_base, l.base]), [[60, '3.00', '180.00'], [1, '2.00', '2.00']]);
  });

  it('con 150 departamentos hay dos líneas que suman la base: 60 × 3.00 y 90 × 2.00', () => {
    const c = total(150, pro);
    assert.deepEqual(c.lineas.map((l) => [l.unidades, l.precio_unidad_base, l.base]), [[60, '3.00', '180.00'], [90, '2.00', '180.00']]);
    assert.ok(c.lineas.every((l) => l.clave === 'pro'));
    assert.match(c.lineas[0].concepto, /1 a 60/);
    assert.match(c.lineas[1].concepto, /desde el departamento 61/);
  });

  it('Administradora (2.50 y desde el 61 a 1.70): 80 = 184.00, 150 = 303.00 y 300 = 558.00; más barata que Pro (360.00 con 150)', () => {
    assert.equal(total(80, administradora).base, '184.00');
    assert.equal(total(150, administradora).base, '303.00');
    assert.equal(total(150, administradora).total_mes, '357.54');
    assert.equal(total(300, administradora).base, '558.00');
  });

  it('el mínimo y el tramo conviven: con 10 departamentos se cobra el mínimo de 20 (sin tramo); con 65, 60 + 5', () => {
    const chico = total(10, pro);
    assert.deepEqual([chico.unidades_cobradas, chico.minimo_aplicado, chico.unidades_tramo, chico.base, chico.lineas.length], [20, true, 0, '60.00', 1]);
    const grande = total(65, pro);
    assert.deepEqual([grande.unidades_cobradas, grande.minimo_aplicado, grande.unidades_tramo, grande.base], [65, false, 5, '190.00']);
  });

  it('si el mínimo (puesto a mano en la base) pasa del tramo, el tramo se cobra sobre las unidades cobradas, no sobre las reales', () => {
    const c = total(10, { ...pro, unidades_minimas: 90 });
    assert.deepEqual([c.unidades_cobradas, c.unidades_tramo, c.base], [90, 30, '240.00']); // 60 × 3.00 + 30 × 2.00
  });

  it('sin tramo (o con sólo uno de los dos campos) el precio es único, igual que antes', () => {
    assert.equal(total(150, { ...pro, tramo_desde: null, tramo_precio: null }).base, '450.00');
    assert.equal(total(150, { ...pro, tramo_precio: null }).base, '450.00');
    assert.equal(total(150, { ...pro, tramo_desde: null }).base, '450.00');
    const sinCampos = { clave: 'pro', precio_por_unidad: '3.00', igv_incluido: false, modulos_incluidos: [], unidades_minimas: 20 };
    assert.equal(total(150, sinCampos).base, '450.00');
    assert.equal(total(150, sinCampos).unidades_tramo, 0);
  });

  it('un tramo desde el 1 o antes no se aplica (hace falta un primer tramo): se cobra el precio normal', () => {
    assert.equal(total(70, { ...pro, tramo_desde: 1 }).base, '210.00');
    assert.equal(total(70, { ...pro, tramo_desde: 0 }).base, '210.00');
  });

  it('el IGV se aplica UNA vez al final sobre la suma de las dos líneas: base + IGV = total', () => {
    const c = total(150, pro);
    assert.equal(c.igv, '64.80'); // 360.00 × 0.18
    assert.equal(c.total_mes, '424.80');
    assert.equal(c.total_anio, '5097.60');
    assert.equal((Number(c.base) + Number(c.igv)).toFixed(2), c.total_mes);
  });

  it('plan con IGV incluido: precio y tramo se les quita el IGV y el total sigue siendo el de la tarifa (60 × 3.54 + 10 × 2.36)', () => {
    const conIgv: PrecioPlan = { ...pro, precio_por_unidad: '3.54', tramo_precio: '2.36', igv_incluido: true };
    const c = total(70, conIgv);
    assert.equal(c.total_mes, '236.00');
    assert.equal(c.base, '200.00');
  });

  it('en una moneda sin decimales (pesos chilenos, IVA 19 %): 60 × 1900 + 10 × 1500 = 129000; con IVA 153510', () => {
    const c = total(70, { ...pro, precio_por_unidad: '1900', tramo_precio: '1500' }, { tasa: '0.19', moneda: 'CLP' });
    assert.deepEqual([c.base, c.total_mes, c.lineas.map((l) => l.base)], ['129000', '153510', ['114000', '15000']]);
  });

  it('tramo con precio 0: del 61 en adelante no se cobra', () => {
    assert.equal(total(100, { ...pro, tramo_precio: '0' }).base, '180.00');
  });
});

describe('seed y script de la oferta', () => {
  it('PLANES_SEED: ningún plan trae tramo (Pro y Administradora cobran parejo); el superadmin lo pone después', () => {
    for (const p of PLANES_SEED) assert.deepEqual([p.tramo_desde, p.tramo_precio], [null, null], p.clave);
  });
});

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA', string>;

/** Los planes y precios por moneda como los deja el seed. */
async function restaurar() {
  await prisma.precioPlanMoneda.deleteMany();
  await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '3.00', unidades_minimas: 20, tramo_desde: 61, tramo_precio: '2.00', igv_incluido: false } });
  await prisma.planComercial.update({ where: { clave: 'administradora' }, data: { precio_por_unidad: '2.50', unidades_minimas: 20, tramo_desde: 61, tramo_precio: '1.70', igv_incluido: false } });
  await prisma.suscripcionCondominio.deleteMany();
  await prisma.unidad.deleteMany({ where: { codigo: { startsWith: 'TR-' } } });
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { igv_tasa: '0.18' } });
  await prisma.impuestoPais.update({ where: { pais: 'PE' }, data: { tasa: '0.18' } });
  await prisma.complejoHabitacional.updateMany({ data: { pais: 'PE', moneda: 'PEN' } });
  await prisma.impuestoPais.update({ where: { pais: 'CL' }, data: { moneda: 'CLP' } }); // Chile en pesos con precios por fila: el mecanismo de otra moneda (el dólar al tipo de cambio vive en multimoneda-usd.test.ts)
  invalidarComercial();
}

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(restaurar);

const plan = async (clave: string) => prisma.planComercial.findUniqueOrThrow({ where: { clave } });
const planPublico = async (clave: string, query = '') => (await llamar(base, 'GET', `/api/publico/planes${query}`)).body.planes.find((p: { clave: string }) => p.clave === clave);
const editar = (clave: string, cuerpo: Record<string, unknown>, token = T.super) => llamar(base, 'PUT', `/api/comercial/planes/${clave}`, token, cuerpo);

describe('la base siembra los tramos y el script no pisa lo editado', () => {
  it('una base nueva no trae tramos (Pro y Administradora cobran parejo)', async () => {
    await prisma.planComercial.deleteMany();
    await sembrarCatalogoComercial(prisma);
    const filas = await prisma.planComercial.findMany();
    for (const f of filas) assert.deepEqual([f.clave, f.tramo_desde, f.tramo_precio], [f.clave, null, null]);
  });

  it('ajustarOfertaGratisPro no pone tramos: ni en filas sin tramo ni en la segunda corrida (y no los quita de filas que ya los tienen)', async () => {
    await prisma.planComercial.updateMany({ where: { clave: { in: ['pro', 'administradora'] } }, data: { tramo_desde: null, tramo_precio: null } });
    const informe = await ajustarOfertaGratisPro(prisma);
    assert.deepEqual(informe.filter((i) => i.cambios.some((c) => c.startsWith('tramo'))), []);
    assert.deepEqual([(await plan('pro')).tramo_desde, (await plan('pro')).tramo_precio], [null, null]);
    assert.deepEqual([(await plan('administradora')).tramo_desde, (await plan('administradora')).tramo_precio], [null, null]);
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { tramo_desde: 61, tramo_precio: '2.00' } });
    await ajustarOfertaGratisPro(prisma);
    assert.deepEqual([(await plan('pro')).tramo_desde, (await plan('pro')).tramo_precio?.toString()], [61, '2'], 'un tramo que ya está se queda');
  });

  it('el script no pisa un tramo que el superadmin ya editó (ni una fila con sólo uno de los dos campos); en seco no escribe', async () => {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { tramo_desde: 81, tramo_precio: '1.80' } });
    await prisma.planComercial.update({ where: { clave: 'administradora' }, data: { tramo_desde: 51, tramo_precio: null } });
    await ajustarOfertaGratisPro(prisma);
    assert.deepEqual([(await plan('pro')).tramo_desde, (await plan('pro')).tramo_precio?.toString()], [81, '1.8']);
    assert.deepEqual([(await plan('administradora')).tramo_desde, (await plan('administradora')).tramo_precio], [51, null]);
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { tramo_desde: null, tramo_precio: null } });
    await ajustarOfertaGratisPro(prisma, { seco: true });
    assert.equal((await plan('pro')).tramo_desde, null, 'en seco no escribe');
  });
});

describe('API pública con tramo', () => {
  it('/api/publico/planes: Pro y Administradora traen tramo_desde y tramo_precio sin IGV; Gratis y Básico null; el total mínimo no cambia', async () => {
    const pro = await planPublico('pro');
    assert.deepEqual([pro.precio_por_unidad, pro.tramo_desde, pro.tramo_precio, pro.total_minimo_mes], ['3.00', 61, '2.00', '60.00']);
    const adm = await planPublico('administradora');
    assert.deepEqual([adm.precio_por_unidad, adm.tramo_desde, adm.tramo_precio, adm.total_minimo_mes], ['2.50', 61, '1.70', '50.00']);
    for (const c of ['gratis', 'basico']) assert.deepEqual([(await planPublico(c)).tramo_desde, (await planPublico(c)).tramo_precio], [null, null], c);
  });

  it('un plan que guarda el precio con IGV publica el tramo SIN IGV, como el precio', async () => {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '3.54', tramo_precio: '2.36', igv_incluido: true } });
    invalidarComercial();
    const pro = await planPublico('pro');
    assert.deepEqual([pro.precio_por_unidad, pro.tramo_precio], ['3.00', '2.00']);
  });

  it('/api/publico/cotizar: 20, 60, 61, 80, 150 y 300 departamentos de Pro con IGV aparte, y cuántos caen en el tramo', async () => {
    const cot = async (n: number, p = 'pro') => (await llamar(base, 'GET', `/api/publico/cotizar?unidades=${n}&plan=${p}`)).body;
    const filas: [number, string, string, string, number][] = [[20, '60.00', '10.80', '70.80', 0], [60, '180.00', '32.40', '212.40', 0], [61, '182.00', '32.76', '214.76', 1], [80, '220.00', '39.60', '259.60', 20], [150, '360.00', '64.80', '424.80', 90], [300, '660.00', '118.80', '778.80', 240]];
    for (const [n, mes, igv, conIgv, enTramo] of filas) {
      const c = await cot(n);
      assert.deepEqual([c.total_mes, c.igv_mes, c.total_con_igv_mes, c.unidades_tramo, c.tramo_desde, c.tramo_precio], [mes, igv, conIgv, enTramo, 61, '2.00'], `${n} departamentos`);
    }
    assert.equal((await cot(150, 'administradora')).total_mes, '303.00');
    assert.equal((await cot(80, 'administradora')).total_mes, '184.00');
    assert.equal((await cot(300, 'administradora')).total_mes, '558.00');
    assert.equal((await cot(150)).total_anio, '4320.00');
  });

  it('cotizar de un plan sin tramo (Básico, Gratis) o sin plan: tramo null y 0 departamentos en el tramo', async () => {
    const b = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=basico')).body;
    assert.deepEqual([b.total_mes, b.tramo_desde, b.tramo_precio, b.unidades_tramo], ['200.00', null, null, 0]); // 100 × 2.00
    const s = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100')).body;
    assert.deepEqual([s.tramo_desde, s.unidades_tramo], [null, 0]);
  });

  it('moneda sin tramo: en pesos chilenos el plan se cobra con precio único (no se inventa una conversión); con su tramo en esa moneda, se aplica', async () => {
    await prisma.precioPlanMoneda.create({ data: { plan_clave: 'pro', moneda: 'CLP', precio_por_unidad: '1900' } });
    invalidarComercial();
    const unico = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=70&plan=pro&pais=CL')).body;
    assert.deepEqual([unico.moneda, unico.total_mes, unico.tramo_desde, unico.tramo_precio, unico.unidades_tramo], ['CLP', '133000', null, null, 0]);
    const planCl = await planPublico('pro', '?pais=CL');
    assert.deepEqual([planCl.precio_por_unidad, planCl.tramo_desde, planCl.tramo_precio], ['1900', null, null]);
    await prisma.precioPlanMoneda.update({ where: { plan_clave_moneda: { plan_clave: 'pro', moneda: 'CLP' } }, data: { tramo_precio_por_unidad: '1500' } });
    invalidarComercial();
    const conTramo = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=70&plan=pro&pais=CL')).body;
    assert.deepEqual([conTramo.total_mes, conTramo.tramo_desde, conTramo.tramo_precio, conTramo.unidades_tramo], ['129000', 61, '1500', 10]);
    assert.deepEqual([(await planPublico('pro', '?pais=CL')).tramo_desde, (await planPublico('pro', '?pais=CL')).tramo_precio], [61, '1500']);
  });
});

describe('Mi plan muestra el detalle de las dos líneas', () => {
  it('con 65 departamentos en Pro: dos líneas (60 a 3.00 y 5 a 2.00), 190.00 de base; con 30, una sola', async () => {
    const empresa_id = (await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).empresa_id;
    const hay = await prisma.unidad.count({ where: { complejo_id: d.complejoA.id } });
    await prisma.unidad.createMany({ data: Array.from({ length: 65 - hay }, (_, i) => ({ codigo: `TR-${i}`, tipo: 'departamento', complejo_id: d.complejoA.id, empresa_id, estado: 'activa' })) });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'pro', modulos: [], estado: 'activa', vigente_hasta: new Date(Date.now() + 20 * 86_400_000) } });
    invalidarComercial();
    const vista = async () => (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios.find((c: { complejo_id: number }) => c.complejo_id === d.complejoA.id);
    const c = (await vista()).cotizacion;
    assert.deepEqual([c.base, c.unidades_cobradas, c.unidades_tramo], ['190.00', 65, 5]);
    assert.deepEqual(c.lineas.map((l: { unidades: number; precio_unidad_base: string; base: string }) => [l.unidades, l.precio_unidad_base, l.base]), [[60, '3.00', '180.00'], [5, '2.00', '10.00']]);
    await prisma.unidad.deleteMany({ where: { codigo: { startsWith: 'TR-' } } });
    await prisma.unidad.createMany({ data: Array.from({ length: 30 - hay }, (_, i) => ({ codigo: `TR-${i}`, tipo: 'departamento', complejo_id: d.complejoA.id, empresa_id, estado: 'activa' })) });
    invalidarComercial();
    const chico = (await vista()).cotizacion;
    assert.deepEqual([chico.lineas.length, chico.unidades_tramo, chico.base], [1, 0, '90.00']);
  });
});

describe('Superadmin edita el tramo del plan (validado y auditado)', () => {
  it('el catálogo del superadmin trae tramo_desde y tramo_precio de cada plan', async () => {
    const r = await llamar(base, 'GET', '/api/comercial/catalogo', T.super);
    const pro = r.body.planes.find((p: { clave: string }) => p.clave === 'pro');
    assert.deepEqual([pro.tramo_desde, pro.tramo_precio], [61, '2']);
  });

  it('cambiar el tramo de Pro cambia lo que ve el público y el total; queda en la auditoría', async () => {
    const r = await editar('pro', { tramo_desde: 81, tramo_precio: '1.50' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.body.tramo_desde, r.body.tramo_precio], [81, '1.5']);
    invalidarComercial();
    assert.deepEqual([(await planPublico('pro')).tramo_desde, (await planPublico('pro')).tramo_precio], [81, '1.50']);
    // 80 × 3.00 + 20 × 1.50 = 270.00 (100 departamentos)
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro')).body.total_mes, '270.00');
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'plan_comercial' }, orderBy: { id: 'desc' } });
    assert.deepEqual([(a!.detalle as Record<string, unknown>).tramo_desde, (a!.detalle as Record<string, unknown>).tramo_precio], [81, '1.50']);
  });

  it('quitar el tramo (los dos en null) deja el precio único; con el tramo en null el público ya no lo ve', async () => {
    assert.equal((await editar('pro', { tramo_desde: null, tramo_precio: null })).status, 200);
    invalidarComercial();
    assert.deepEqual([(await planPublico('pro')).tramo_desde, (await planPublico('pro')).tramo_precio], [null, null]);
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=150&plan=pro')).body.total_mes, '450.00');
  });

  it('los dos campos o ninguno: sólo uno → 422 con el campo', async () => {
    await editar('pro', { tramo_desde: null, tramo_precio: null });
    const a = await editar('pro', { tramo_desde: 61 });
    assert.equal(a.status, 422, a.texto);
    assert.ok(a.body.campos.tramo_precio, JSON.stringify(a.body));
    const b = await editar('pro', { tramo_precio: '2.00' });
    assert.equal(b.status, 422, b.texto);
    assert.ok(b.body.campos.tramo_desde, JSON.stringify(b.body));
    assert.deepEqual([(await plan('pro')).tramo_desde, (await plan('pro')).tramo_precio], [null, null], 'no se guardó nada');
  });

  it('tramo_desde: mínimo 2 y mayor que el mínimo de departamentos del plan (20); 21 sí vale', async () => {
    for (const mal of [1, 0, -5, 20, 2.5]) {
      const r = await editar('pro', { tramo_desde: mal, tramo_precio: '2.00' });
      assert.equal(r.status, 422, `tramo_desde ${mal}: ${r.texto}`);
    }
    assert.equal((await plan('pro')).tramo_desde, 61, 'lo inválido no se guardó');
    assert.equal((await editar('pro', { tramo_desde: 21, tramo_precio: '2.00' })).status, 200);
  });

  it('tramo_precio: no negativo y menor que el precio por departamento (3.00); 0 sí vale', async () => {
    for (const mal of ['3.00', '4', '-1', 'abc', '1.12345']) {
      const r = await editar('pro', { tramo_desde: 61, tramo_precio: mal });
      assert.equal(r.status, 422, `tramo_precio ${mal}: ${r.texto}`);
    }
    assert.equal((await plan('pro')).tramo_precio?.toString(), '2');
    assert.equal((await editar('pro', { tramo_desde: 61, tramo_precio: '0' })).status, 200);
  });

  it('editar sólo el precio o el mínimo también deja el tramo coherente: precio ≤ tramo → 422; mínimo ≥ tramo_desde → 422', async () => {
    const p = await editar('pro', { precio_por_unidad: '1.00' });
    assert.equal(p.status, 422, p.texto);
    assert.ok(p.body.campos.tramo_precio);
    const m = await editar('pro', { unidades_minimas: 61 });
    assert.equal(m.status, 422, m.texto);
    assert.ok(m.body.campos.tramo_desde);
    assert.equal((await editar('pro', { precio_por_unidad: '4.00' })).status, 200, 'subir el precio sigue valiendo');
    assert.equal((await editar('pro', { unidades_minimas: 60 })).status, 200);
  });

  it('un plan sin tramo se puede editar como siempre (Básico), y Gratis (precio 0) no admite tramo', async () => {
    assert.equal((await editar('basico', { precio_por_unidad: '1.60' })).status, 200);
    await editar('basico', { precio_por_unidad: '2.00' });
    assert.equal((await editar('gratis', { tramo_desde: 61, tramo_precio: '0.10' })).status, 422);
  });

  it('sólo el superadmin: un admin recibe 403 y no cambia nada', async () => {
    const r = await editar('pro', { tramo_desde: 99, tramo_precio: '1.00' }, T.adminA);
    assert.equal(r.status, 403);
    assert.equal((await plan('pro')).tramo_desde, 61);
  });
});

describe('Superadmin edita el tramo por moneda', () => {
  const ponerClp = (cuerpo: Record<string, unknown>) => llamar(base, 'PUT', '/api/comercial/planes/pro/precios/CLP', T.super, cuerpo);

  it('el precio de una moneda lleva su tramo; sin tramo_precio_por_unidad en el cuerpo se conserva el que había; null lo quita', async () => {
    const r = await ponerClp({ precio_por_unidad: '1900', tramo_precio_por_unidad: '1500' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.tramo_precio_por_unidad, '1500');
    assert.equal((await prisma.precioPlanMoneda.findUniqueOrThrow({ where: { plan_clave_moneda: { plan_clave: 'pro', moneda: 'CLP' } } })).tramo_precio_por_unidad?.toString(), '1500');
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'precio_plan_moneda' }, orderBy: { id: 'desc' } });
    assert.equal((a!.detalle as Record<string, unknown>).tramo_precio_por_unidad, '1500');
    assert.equal((await ponerClp({ precio_por_unidad: '2000' })).body.tramo_precio_por_unidad, '1500', 'cambiar sólo el precio conserva el tramo');
    assert.equal((await ponerClp({ precio_por_unidad: '2000', tramo_precio_por_unidad: null })).body.tramo_precio_por_unidad, null);
    assert.equal((await prisma.precioPlanMoneda.findUniqueOrThrow({ where: { plan_clave_moneda: { plan_clave: 'pro', moneda: 'CLP' } } })).tramo_precio_por_unidad, null);
    const cat = await llamar(base, 'GET', '/api/comercial/catalogo', T.super);
    assert.ok('tramo_precio_por_unidad' in cat.body.precios_moneda[0]);
  });

  it('validaciones: el tramo de la moneda va por debajo de su precio, sin decimales en pesos, y el plan debe tener tramo; en soles se edita en el plan', async () => {
    assert.equal((await ponerClp({ precio_por_unidad: '1900', tramo_precio_por_unidad: '1900' })).status, 422);
    assert.equal((await ponerClp({ precio_por_unidad: '1900', tramo_precio_por_unidad: '2500' })).status, 422);
    assert.equal((await ponerClp({ precio_por_unidad: '1900', tramo_precio_por_unidad: '1500.5' })).status, 422);
    assert.equal(await prisma.precioPlanMoneda.count(), 0, 'nada se guardó');
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/basico/precios/CLP', T.super, { precio_por_unidad: '900', tramo_precio_por_unidad: '700' })).status, 422, 'Básico no tiene tramo');
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/PEN', T.super, { precio_por_unidad: '3.00', tramo_precio_por_unidad: '1.50' })).status, 422);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/PEN', T.super, { precio_por_unidad: '2.00' })).status, 422, 'el precio en soles no puede quedar en el tramo o por debajo');
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/PEN', T.super, { precio_por_unidad: '3.20' })).status, 200);
  });
});
