import './helpers/env';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { prisma, sembrar, type Datos } from './helpers/app';
import { avisarReciboEmitido, encolarAviso, encolarRecordatorios, encolarReciboEmitido, planAvisoRecibo } from '../src/server/services/avisos';
import { hoyLima } from '../src/server/lib/fechas';

// Quién paga: un aviso de cobro de una unidad va SÓLO a quien la paga (el inquilino si la unidad tiene inquilino; si no, el propietario).
// Los comunicados no cambian (van a todos los vecinos). Siembra: A-101 (propietario1, inquilino1), A-102 (propietario2, sin inquilino).

const DIA = 86_400_000;
let D: Datos;

/** Canales de las filas de un tipo para una persona y un recibo (orden estable). */
async function filasDe(usuario_id: number, tipo: string, ref_id: number): Promise<string[]> {
  const filas = await prisma.notificacion.findMany({ where: { usuario_id, tipo, ref_entidad: 'recibo', ref_id }, select: { canal: true }, orderBy: { canal: 'asc' } });
  return filas.map((f) => f.canal);
}

/** Un recibo de A con cargo en A-101 (la unidad con inquilino) que vence dentro de `dias` días, contados en Lima (negativo = ya venció). */
async function reciboQueVence(dias: number) {
  const r = await prisma.recibo.create({
    data: { empresa_id: D.empresaA.id, complejo_id: D.complejoA.id, mes: 11, anio: 2026, fecha_emision: new Date(hoyLima().getTime() - 60 * DIA), fecha_vencimiento: new Date(hoyLima().getTime() + dias * DIA), estado: 'emitido', descripcion: 'Prueba de cobro' },
  });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: r.id, concepto_id: D.conceptoA.id, monto: 150, orden: 1 } });
  await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: D.unidadA1.id, monto: 150, estado_pago: 'pendiente' } });
  return r;
}

beforeEach(async () => {
  D = await sembrar();
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: true, telefono: null } });
  await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { telefono: '987654321' } });
  await prisma.usuario.update({ where: { id: D.propietario2.id }, data: { telefono: '922222222' } });
  await prisma.usuario.update({ where: { id: D.inquilino1.id }, data: { telefono: '933333333' } });
});

after(async () => {
  await prisma.$disconnect();
});

describe('recibo emitido', () => {
  it('la unidad con inquilino avisa sólo al inquilino; el propietario de esa unidad no recibe nada', async () => {
    await encolarReciboEmitido(D.reciboVencidoA.id);
    assert.deepEqual(await filasDe(D.inquilino1.id, 'recibo_emitido', D.reciboVencidoA.id), ['email', 'whatsapp']);
    assert.deepEqual(await filasDe(D.propietario1.id, 'recibo_emitido', D.reciboVencidoA.id), []);
  });

  it('la unidad sin inquilino avisa a su propietario', async () => {
    await encolarReciboEmitido(D.reciboVencidoA.id);
    assert.deepEqual(await filasDe(D.propietario2.id, 'recibo_emitido', D.reciboVencidoA.id), ['email', 'whatsapp']);
  });
});

describe('recordatorios de pago', () => {
  it('vence hoy: sólo al inquilino de la unidad con inquilino', async () => {
    const r = await reciboQueVence(0);
    await encolarRecordatorios(new Date());
    assert.deepEqual(await filasDe(D.inquilino1.id, 'vence_hoy', r.id), ['email', 'whatsapp']);
    assert.deepEqual(await filasDe(D.propietario1.id, 'vence_hoy', r.id), []);
  });

  it('venció ayer: sólo al inquilino', async () => {
    const r = await reciboQueVence(-1);
    await encolarRecordatorios(new Date());
    assert.deepEqual(await filasDe(D.inquilino1.id, 'vencido', r.id), ['email', 'whatsapp']);
    assert.deepEqual(await filasDe(D.propietario1.id, 'vencido', r.id), []);
  });

  it('2 días antes (si la administración lo enciende): sólo al inquilino', async () => {
    await prisma.complejoHabitacional.update({ where: { id: D.complejoA.id }, data: { whatsapp_avisos: ['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'cierre_pendiente'] } });
    const r = await reciboQueVence(2);
    await encolarRecordatorios(new Date());
    assert.deepEqual(await filasDe(D.inquilino1.id, 'por_vencer', r.id), ['email', 'whatsapp']);
    assert.deepEqual(await filasDe(D.propietario1.id, 'por_vencer', r.id), []);
  });

  it('a quien no paga la unidad no se le encola el aviso del recibo, ni a mano', async () => {
    await encolarReciboEmitido(D.reciboVencidoA.id);
    const r = await encolarAviso('vencido', D.propietario1.id, { entidad: 'recibo', id: D.reciboVencidoA.id });
    assert.equal(r, 0, 'el propietario de A-101 no paga esa unidad');
  });
});

describe('«Avisar a los vecinos»: la vista previa cuenta lo que se encola', () => {
  it('cuenta a quien paga, y el envío encola exactamente eso', async () => {
    const plan = await planAvisoRecibo(D.reciboVencidoA.id);
    assert.equal(plan.vecinos, 2, 'el inquilino de A-101 y el propietario de A-102; el propietario de A-101 no cuenta');
    assert.equal(plan.por_avisar, 2);
    assert.equal(plan.por_correo, 2);
    assert.equal(plan.por_whatsapp, 2);
    const r = await avisarReciboEmitido(D.reciboVencidoA.id);
    assert.equal(r.encolados, plan.por_avisar);
    const filas = await prisma.notificacion.findMany({ where: { tipo: 'recibo_emitido', ref_id: D.reciboVencidoA.id }, select: { usuario_id: true } });
    assert.equal(filas.length, plan.por_correo + plan.por_whatsapp);
    assert.ok(!filas.some((f) => f.usuario_id === D.propietario1.id), 'el propietario de A-101 no recibe el recibo');
  });
});
