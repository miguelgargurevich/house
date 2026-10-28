// Dinero (IGV una sola vez, Decimal), estado de la suscripción según el reloj, seed idempotente y migración a cortesía.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { prisma, sembrar, vaciarBase } from './helpers/app';
import { cotizar, desglosarMonto, precioConIgv } from '../src/server/services/comercial/calculo';
import { sembrarCatalogoComercial } from '../src/server/services/comercial/catalogo';
import { estadoEfectivo, type EntradaSuscripcion } from '../src/server/services/comercial/estado';
import { migracionInicial, migrarACortesia } from '../src/server/services/comercial/migracion';
import { comercialDeps, estadoDeComplejo, invalidarComercial, moduloActivo } from '../src/server/services/comercial/modulos';

const TASA = '0.18';
const catalogo = [{ clave: 'ia_vouchers', precio_por_unidad: '1.00' }, { clave: 'whatsapp_avisos', precio_por_unidad: '1.00' }, { clave: 'asistente', precio_por_unidad: '0.50' }];
const pro = { clave: 'pro', precio_por_unidad: '2.50', igv_incluido: false, modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'] };
const PLANES = [{ clave: 'gratis', modulos_incluidos: [] }, { clave: 'pro', modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'] }, { clave: 'cortesia', modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'] }];
const PLAZOS = { dias_gracia: 7, dias_aviso_vencimiento: 5 };
// 2026-10-27 12:00 en Lima = 17:00 UTC; «hoy en Lima» es el 27.
const AHORA = new Date('2026-10-27T17:00:00Z');
const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('precios con IGV', () => {
  it('los precios publicados salen de base × 1,18 con 2 decimales', () => {
    assert.equal(precioConIgv('1.00', TASA).toFixed(2), '1.18');
    assert.equal(precioConIgv('0.50', TASA).toFixed(2), '0.59');
    assert.equal(precioConIgv('2.50', TASA).toFixed(2), '2.95');
    assert.equal(precioConIgv('2.00', TASA).toFixed(2), '2.36');
    assert.equal(precioConIgv('0.00', TASA).toFixed(2), '0.00');
  });
  it('si el plan ya guarda el precio con IGV no se vuelve a sumar', () => {
    assert.equal(precioConIgv('2.95', TASA, true).toFixed(2), '2.95');
  });
});

describe('cotización: el IGV se aplica una sola vez sobre la base', () => {
  it('Pro con 448 departamentos: base 1120,00 + IGV 201,60 = 1321,60 (no 448 × 2,95 sumado y redondeado)', () => {
    const c = cotizar({ unidades: 448, plan: pro, modulosSueltos: [], catalogo, tasa: TASA });
    assert.equal(c.base, '1120.00');
    assert.equal(c.igv, '201.60');
    assert.equal(c.total_mes, '1321.60');
    assert.equal(c.total_anio, '15859.20');
  });
  it('módulos sueltos: los 3 módulos en 33 departamentos = base 82,50 + IGV 14,85 = 97,35', () => {
    const c = cotizar({ unidades: 33, plan: null, modulosSueltos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'], catalogo, tasa: TASA });
    assert.equal(c.base, '82.50');
    assert.equal(c.igv, '14.85');
    assert.equal(c.total_mes, '97.35');
  });
  it('otros tamaños: 7 deptos de un módulo de S/ 0,50 → 4,13; 1001 → 590,59; 13 deptos con dos módulos → 23,01', () => {
    assert.equal(cotizar({ unidades: 7, plan: null, modulosSueltos: ['asistente'], catalogo, tasa: TASA }).total_mes, '4.13');
    assert.equal(cotizar({ unidades: 1001, plan: null, modulosSueltos: ['asistente'], catalogo, tasa: TASA }).total_mes, '590.59');
    assert.equal(cotizar({ unidades: 13, plan: null, modulosSueltos: ['ia_vouchers', 'asistente'], catalogo, tasa: TASA }).total_mes, '23.01');
  });
  it('se redondea UNA vez: con un precio base de S/ 0,33, 100 deptos son 33,00 + IGV 5,94 = 38,94 (redondear antes el precio unitario daría 39,00)', () => {
    const c = cotizar({ unidades: 100, plan: null, modulosSueltos: ['x'], catalogo: [{ clave: 'x', precio_por_unidad: '0.33' }], tasa: TASA });
    assert.equal(c.total_mes, '38.94');
    assert.notEqual(c.total_mes, precioConIgv('0.33', TASA).times(100).toFixed(2));
  });
  it('los módulos que el plan ya trae no se cobran dos veces', () => {
    const c = cotizar({ unidades: 100, plan: pro, modulosSueltos: ['ia_vouchers'], catalogo, tasa: TASA });
    assert.equal(c.base, '250.00');
    assert.equal(c.lineas.length, 1);
  });
  it('Gratis sin módulos cuesta cero; 0 departamentos cuesta cero', () => {
    assert.equal(cotizar({ unidades: 448, plan: { clave: 'gratis', precio_por_unidad: '0', igv_incluido: false, modulos_incluidos: [] }, modulosSueltos: [], catalogo, tasa: TASA }).total_mes, '0.00');
    assert.equal(cotizar({ unidades: 0, plan: pro, modulosSueltos: [], catalogo, tasa: TASA }).total_mes, '0.00');
  });
  it('plan con IGV incluido: el total es el precio publicado × unidades', () => {
    const c = cotizar({ unidades: 100, plan: { ...pro, precio_por_unidad: '2.95', igv_incluido: true }, modulosSueltos: [], catalogo, tasa: TASA });
    assert.equal(c.total_mes, '295.00');
    assert.equal(c.base, '250.00');
  });
  it('desglose de un pago: base + IGV = monto exacto', () => {
    const d = desglosarMonto('1321.60', TASA);
    assert.equal(d.base.toFixed(2), '1120.00');
    assert.equal(d.igv.toFixed(2), '201.60');
    assert.equal(d.base.plus(d.igv).toFixed(2), '1321.60');
    const e = desglosarMonto('100.00', TASA);
    assert.equal(e.base.plus(e.igv).toFixed(2), '100.00');
  });
});

describe('estado de la suscripción según el reloj', () => {
  const sus = (p: Partial<EntradaSuscripcion> = {}): EntradaSuscripcion => ({ plan_clave: 'pro', modulos: [], estado: 'activa', vigente_hasta: dia('2026-12-31'), solicitud_plan: null, solicitud_modulos: [], ...p });
  const ef = (s: EntradaSuscripcion | null, ahora = AHORA) => estadoEfectivo(s, PLANES, PLAZOS, ahora);

  it('sin suscripción = Gratis, sin módulos', () => {
    const e = ef(null);
    assert.equal(e.estado, 'gratis');
    assert.deepEqual(e.modulos, []);
  });
  it('Pro vigente: activa con los tres módulos', () => {
    const e = ef(sus());
    assert.equal(e.estado, 'activa');
    assert.deepEqual(e.modulos.sort(), ['asistente', 'ia_vouchers', 'whatsapp_avisos']);
  });
  it('faltando 5 días o menos: por_vencer (los módulos siguen)', () => {
    const e = ef(sus({ vigente_hasta: dia('2026-11-01') }));
    assert.equal(e.estado, 'por_vencer');
    assert.equal(e.dias_para_vencer, 5);
    assert.equal(e.modulos.length, 3);
  });
  it('vencida dentro de la gracia (7 días): estado vencida pero los módulos siguen', () => {
    const e = ef(sus({ vigente_hasta: dia('2026-10-20') }));
    assert.equal(e.estado, 'vencida');
    assert.equal(e.en_gracia, true);
    assert.equal(e.modulos.length, 3);
  });
  it('vencida PASADA la gracia: se comporta como Gratis (módulos apagados)', () => {
    const e = ef(sus({ vigente_hasta: dia('2026-10-19') }));
    assert.equal(e.estado, 'vencida');
    assert.equal(e.apagada, true);
    assert.deepEqual(e.modulos, []);
  });
  it('cortesía: todos los módulos y sin vencimiento aunque tuviera una fecha vieja', () => {
    const e = ef(sus({ plan_clave: 'cortesia', vigente_hasta: dia('2020-01-01') }));
    assert.equal(e.estado, 'activa');
    assert.deepEqual([...e.modulos].sort(), ['asistente', 'ia_vouchers', 'mora_automatica', 'reportes', 'whatsapp_avisos'], 'cortesía trae los 3 módulos + mora automática + reportes, aunque el plan en la base aún no los liste');
  });
  it('módulos sueltos con vigencia vencida pasada la gracia también se apagan', () => {
    const e = ef(sus({ plan_clave: 'gratis', modulos: ['asistente'], vigente_hasta: dia('2026-09-01') }));
    assert.deepEqual(e.modulos, []);
  });
  it('solicitud pendiente sobre Gratis: «solicitada» y sin módulos hasta que se pague', () => {
    const e = ef(sus({ plan_clave: 'gratis', vigente_hasta: null, solicitud_plan: 'pro' }));
    assert.equal(e.estado, 'solicitada');
    assert.deepEqual(e.modulos, []);
  });
  it('el reloj manda: el mismo registro, otro día, otro estado', () => {
    const s = sus({ vigente_hasta: dia('2026-11-10') });
    assert.equal(ef(s).estado, 'activa');
    assert.equal(ef(s, new Date('2026-11-07T17:00:00Z')).estado, 'por_vencer');
    assert.equal(ef(s, new Date('2026-11-12T17:00:00Z')).estado, 'vencida');
    assert.equal(ef(s, new Date('2026-11-30T17:00:00Z')).modulos.length, 0);
  });
});

describe('caché de la puerta por módulo', () => {
  let ttlOriginal: number;
  before(() => { ttlOriginal = comercialDeps.ttlMs; });
  after(() => { comercialDeps.ttlMs = ttlOriginal; invalidarComercial(); });

  it('con caché el cambio no se ve hasta invalidar; con invalidarComercial() se ve al instante', async () => {
    const d = await sembrar();
    comercialDeps.ttlMs = 60_000;
    invalidarComercial();
    assert.equal(await moduloActivo(d.complejoA.id, 'asistente'), true);
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: 'gratis', modulos: [] } });
    assert.equal(await moduloActivo(d.complejoA.id, 'asistente'), true, 'sirve de la caché');
    invalidarComercial(d.complejoA.id);
    assert.equal(await moduloActivo(d.complejoA.id, 'asistente'), false);
    comercialDeps.ttlMs = 0;
  });
  it('sin condominio no hay módulo; sin suscripción es Gratis', async () => {
    const d = await sembrar();
    assert.equal(await moduloActivo(null, 'asistente'), false);
    const nuevo = await prisma.complejoHabitacional.create({ data: { nombre: 'Sin fila', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    assert.equal((await estadoDeComplejo(nuevo.id)).estado, 'gratis');
    assert.equal(await moduloActivo(nuevo.id, 'ia_vouchers'), false);
  });
});

describe('seed del catálogo y migración a cortesía', () => {
  beforeEach(async () => { await vaciarBase(); });

  it('el seed deja los precios base y es idempotente: no pisa lo que el superadmin editó', async () => {
    const precios = async () => Object.fromEntries((await prisma.moduloComercial.findMany()).map((m) => [m.clave, m.precio_por_unidad.toFixed(2)]));
    assert.deepEqual(await precios(), { ia_vouchers: '1.00', whatsapp_avisos: '1.00', asistente: '0.50' });
    assert.deepEqual((await prisma.planComercial.findMany({ orderBy: { orden: 'asc' } })).map((p) => [p.clave, p.precio_por_unidad.toFixed(2), p.visible]), [['gratis', '0.00', true], ['pro', '2.50', true], ['administradora', '2.00', true], ['cortesia', '0.00', false]]);
    assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).igv_tasa.toString(), '0.18');
    await prisma.moduloComercial.update({ where: { clave: 'asistente' }, data: { precio_por_unidad: '0.75' } });
    await sembrarCatalogoComercial(prisma);
    await sembrarCatalogoComercial(prisma);
    assert.equal((await precios()).asistente, '0.75', 'el seed no pisa la edición');
    assert.equal(await prisma.planComercial.count(), 4);
    assert.equal(await prisma.moduloComercial.count(), 3);
  });

  it('migración en SECO no escribe nada; en real deja a todos los existentes en cortesía con todos los módulos; una segunda corrida no cambia nada', async () => {
    const e = await prisma.empresaAdministradora.create({ data: { nombre: 'GRUPO VRANY' } });
    const a = await prisma.complejoHabitacional.create({ data: { nombre: 'Los Libertadores', tipo: 'Condominio', empresa_id: e.id } });
    const b = await prisma.complejoHabitacional.create({ data: { nombre: 'Otro', tipo: 'Edificio', empresa_id: e.id } });
    const seco = await migrarACortesia(prisma, { seco: true });
    assert.deepEqual(seco, { sinSuscripcion: 2, creadas: 0, yaTenian: 0 });
    assert.equal(await prisma.suscripcionCondominio.count(), 0, 'el seco no escribe');
    const real = await migrarACortesia(prisma);
    assert.equal(real.creadas, 2);
    for (const c of [a, b]) {
      const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: c.id } });
      assert.equal(s.plan_clave, 'cortesia');
      assert.equal(s.vigente_hasta, null);
      assert.deepEqual([...s.modulos].sort(), ['asistente', 'ia_vouchers', 'whatsapp_avisos']);
      assert.deepEqual([...(await estadoDeComplejo(c.id)).modulos].sort(), ['asistente', 'ia_vouchers', 'mora_automatica', 'reportes', 'whatsapp_avisos']);
    }
    assert.deepEqual(await migrarACortesia(prisma), { sinSuscripcion: 0, creadas: 0, yaTenian: 2 });
  });

  it('la migración no toca a quien ya tiene suscripción (un registro nuevo sigue en Gratis)', async () => {
    const e = await prisma.empresaAdministradora.create({ data: { nombre: 'Nueva' } });
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Nuevo', tipo: 'Edificio', empresa_id: e.id } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: c.id, plan_clave: 'gratis' } });
    await migrarACortesia(prisma);
    assert.equal((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: c.id } })).plan_clave, 'gratis');
  });

  it('la migración inicial corre UNA sola vez: los condominios creados después no pasan a cortesía', async () => {
    const e = await prisma.empresaAdministradora.create({ data: { nombre: 'Vieja' } });
    const vieja = await prisma.complejoHabitacional.create({ data: { nombre: 'Vieja', tipo: 'Edificio', empresa_id: e.id } });
    assert.deepEqual(await migracionInicial(prisma), { aplicada: true, creadas: 1 });
    const nueva = await prisma.complejoHabitacional.create({ data: { nombre: 'Nueva', tipo: 'Edificio', empresa_id: e.id } });
    assert.deepEqual(await migracionInicial(prisma), { aplicada: false, creadas: 0 });
    assert.equal(await prisma.suscripcionCondominio.count({ where: { complejo_id: vieja.id } }), 1);
    assert.equal(await prisma.suscripcionCondominio.count({ where: { complejo_id: nueva.id } }), 0);
    assert.equal(await moduloActivo(nueva.id, 'ia_vouchers'), false);
  });
});

after(async () => { await prisma.$disconnect(); });
