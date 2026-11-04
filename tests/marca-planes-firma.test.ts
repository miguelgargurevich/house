// Marca propia: la migración que la suma UNA vez a los planes que ya existían (Pro, Administradora y Cortesía) y la firma de los avisos en texto
// (WhatsApp y respaldo del correo) con el nombre comercial de la empresa.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma, sembrar } from './helpers/app';
import { CONFIGURACION_ID, sembrarCatalogoComercial } from '../src/server/services/comercial/catalogo';
import { migracionMarca } from '../src/server/services/comercial/migracion';
import { plantilla } from '../src/server/services/avisos/plantillas';

const datos = { nombre: 'Ana', periodo: 'octubre de 2026', monto: 'S/ 100.00', vencimiento: '2026-11-02', condominio: 'Condominio Los Pinos' };

describe('firma de los avisos en texto', () => {
  it('con la marca activa suma el nombre comercial; sin ella, como siempre', () => {
    assert.match(plantilla('recibo_emitido', { ...datos, empresa: 'Grupo Vrany' }).cuerpo, /— Administración de Condominio Los Pinos · Grupo Vrany$/);
    assert.match(plantilla('recibo_emitido', datos).cuerpo, /— Administración de Condominio Los Pinos$/);
    assert.match(plantilla('comunicado', { ...datos, titulo: 'Corte de agua', texto: 'Mañana.', empresa: 'Grupo Vrany' }).cuerpo, /· Grupo Vrany$/);
    // Si el nombre comercial es el mismo que el del condominio, no se repite.
    assert.match(plantilla('recibo_emitido', { ...datos, empresa: 'Condominio Los Pinos' }).cuerpo, /— Administración de Condominio Los Pinos$/);
  });
});

describe('migración de la marca propia a los planes existentes', () => {
  before(async () => {
    await sembrar(); // base vacía y sembrada como en cada archivo
    await prisma.suscripcionCondominio.deleteMany({});
    await prisma.planComercial.deleteMany({});
    await prisma.configuracionComercial.deleteMany({});
    await sembrarCatalogoComercial(prisma);
    // Simula una base de antes: los planes existentes sin `marca_propia` y la migración sin aplicar.
    for (const p of await prisma.planComercial.findMany()) await prisma.planComercial.update({ where: { clave: p.clave }, data: { modulos_incluidos: p.modulos_incluidos.filter((m) => m !== 'marca_propia') } });
    await prisma.configuracionComercial.update({ where: { id: CONFIGURACION_ID }, data: { migracion_marca_at: null } });
  });
  after(async () => { await prisma.$disconnect(); });

  it('la suma a Pro, Administradora y Cortesía, no a Gratis ni Básico, y sólo una vez', async () => {
    const r = await migracionMarca(prisma);
    assert.deepEqual(r, { aplicada: true, planes: 3 });
    const con = (await prisma.planComercial.findMany({ where: { modulos_incluidos: { has: 'marca_propia' } }, select: { clave: true } })).map((p) => p.clave).sort();
    assert.deepEqual(con, ['administradora', 'cortesia', 'pro']);
    // El superadmin se la quita a Pro: al volver a arrancar NO vuelve.
    const pro = await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'pro' } });
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { modulos_incluidos: pro.modulos_incluidos.filter((m) => m !== 'marca_propia') } });
    assert.deepEqual(await migracionMarca(prisma), { aplicada: false, planes: 0 });
    assert.equal((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'pro' } })).modulos_incluidos.includes('marca_propia'), false);
  });
});
