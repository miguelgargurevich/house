// La capacidad `conciliacion` en el catálogo y en el plan: la traen Pro, Administradora y Cortesía (siempre, en código); Gratis y Básico no. El script de la
// oferta la agrega a una base que ya tenía los planes (idempotente) y a las viñetas de /precios.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { darCortesia, prisma, sembrar, type Datos } from './helpers/app';
import { CAPACIDADES, PLANES_SEED } from '../src/server/services/comercial/catalogo';
import { estadoEfectivo, type PlanMinimo } from '../src/server/services/comercial/estado';
import { invalidarComercial, moduloActivo, NOMBRES_MODULO } from '../src/server/services/comercial/modulos';
import { ajustarOfertaGratisPro } from '../src/server/services/comercial/oferta';

let d: Datos;
before(async () => { d = await sembrar(); });
after(async () => { await prisma.$disconnect(); });

const AHORA = new Date('2026-10-31T12:00:00Z');
const PLAZOS = { dias_gracia: 7, dias_aviso_vencimiento: 5 };
const planes: PlanMinimo[] = PLANES_SEED.map((p) => ({ clave: p.clave, modulos_incluidos: [...p.modulos_incluidos] }));
const sus = (plan_clave: string, extra: Record<string, unknown> = {}) => ({ plan_clave, modulos: [], estado: 'activa', vigente_hasta: null, solicitud_plan: null, solicitud_modulos: [], ...extra });

describe('catálogo', () => {
  it('es una capacidad con nombre; Pro, Administradora y Cortesía la traen; Gratis y Básico no', () => {
    assert.ok((CAPACIDADES as readonly string[]).includes('conciliacion'));
    assert.equal(NOMBRES_MODULO.conciliacion, 'Conciliación bancaria');
    for (const clave of ['pro', 'administradora', 'cortesia']) assert.ok(PLANES_SEED.find((p) => p.clave === clave)!.modulos_incluidos.includes('conciliacion' as never), clave);
    for (const clave of ['gratis', 'basico']) assert.ok(!PLANES_SEED.find((p) => p.clave === clave)!.modulos_incluidos.includes('conciliacion' as never), clave);
  });
  it('la viñeta «Conciliación bancaria» está en la tarjeta de Pro', () => {
    assert.ok(PLANES_SEED.find((p) => p.clave === 'pro')!.caracteristicas.includes('Conciliación bancaria'));
  });
});

describe('estado efectivo', () => {
  it('Pro y Administradora vigentes la tienen; Gratis, Básico y sin suscripción no', () => {
    for (const p of ['pro', 'administradora']) assert.ok(estadoEfectivo(sus(p), planes, PLAZOS, AHORA).modulos.includes('conciliacion'), p);
    for (const p of ['gratis', 'basico']) assert.ok(!estadoEfectivo(sus(p, { estado: 'gratis' }), planes, PLAZOS, AHORA).modulos.includes('conciliacion'), p);
    assert.ok(!estadoEfectivo(null, planes, PLAZOS, AHORA).modulos.includes('conciliacion'));
  });
  it('Pro vencido pasada la gracia la pierde; dentro de la gracia la conserva', () => {
    assert.ok(estadoEfectivo(sus('pro', { vigente_hasta: new Date('2026-10-28T00:00:00Z') }), planes, PLAZOS, AHORA).modulos.includes('conciliacion'));
    assert.ok(!estadoEfectivo(sus('pro', { vigente_hasta: new Date('2026-09-01T00:00:00Z') }), planes, PLAZOS, AHORA).modulos.includes('conciliacion'));
  });
  it('la cortesía la trae siempre, aunque el plan «cortesia» de la base aún no la liste', () => {
    const sinLaClave = planes.map((p) => (p.clave === 'cortesia' ? { ...p, modulos_incluidos: p.modulos_incluidos.filter((m) => m !== 'conciliacion') } : p));
    assert.ok(estadoEfectivo(sus('cortesia'), sinLaClave, PLAZOS, AHORA).modulos.includes('conciliacion'));
  });
  it('contra la base: cortesía sí, y Gratis no', async () => {
    await darCortesia(d.complejoA.id);
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoB.id } }); // la siembra deja a los dos en cortesía
    assert.equal(await moduloActivo(d.complejoA.id, 'conciliacion'), true);
    assert.equal(await moduloActivo(d.complejoB.id, 'conciliacion'), false, 'sin suscripción es Gratis');
    invalidarComercial();
  });
});

describe('script de la oferta sobre una base que ya tenía los planes', () => {
  const ANTES = ['ia_vouchers', 'whatsapp_avisos', 'asistente', 'mora_automatica', 'reportes'];
  const VINETAS_ANTES = ['Todo lo de Torre Gratis, sin tope de departamentos', 'IA que lee y valida vouchers', 'Avisos por WhatsApp', 'Asistente con IA (web y bots)', 'Mora automática', 'Reportes y exportes'];

  it('agrega la capacidad (y la viñeta de Pro) a Pro, Administradora y Cortesía; no toca Gratis ni Básico; la segunda corrida no cambia nada', async () => {
    for (const clave of ['pro', 'administradora', 'cortesia']) await prisma.planComercial.update({ where: { clave }, data: { modulos_incluidos: ANTES, ...(clave === 'pro' ? { caracteristicas: VINETAS_ANTES } : {}) } });
    const seco = await ajustarOfertaGratisPro(prisma, { seco: true });
    assert.deepEqual(seco.map((c) => c.clave).sort(), ['administradora', 'cortesia', 'pro']);
    assert.ok(!(await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'pro' } })).modulos_incluidos.includes('conciliacion'), 'en seco no se escribe');

    const real = await ajustarOfertaGratisPro(prisma);
    assert.deepEqual(real.map((c) => c.clave).sort(), ['administradora', 'cortesia', 'pro']);
    for (const clave of ['pro', 'administradora', 'cortesia']) {
      const p = await prisma.planComercial.findUniqueOrThrow({ where: { clave } });
      assert.ok(p.modulos_incluidos.includes('conciliacion'), clave);
      assert.deepEqual(p.modulos_incluidos.slice(0, 5), ANTES, 'se conserva el orden de lo que ya tenía');
    }
    assert.ok((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'pro' } })).caracteristicas.includes('Conciliación bancaria'));
    for (const clave of ['gratis', 'basico']) assert.ok(!(await prisma.planComercial.findUniqueOrThrow({ where: { clave } })).modulos_incluidos.includes('conciliacion'), clave);
    assert.deepEqual(await ajustarOfertaGratisPro(prisma), [], 'idempotente');
    assert.deepEqual(await ajustarOfertaGratisPro(prisma, { seco: true }), []);
  });
});
