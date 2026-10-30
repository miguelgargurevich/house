// Números del mes para pasar a Pro: vouchers validados a mano y con la IA, por condominio, del mes en Lima. Un grupo (mantenimiento completo) cuenta una vez.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { conteoVouchers, periodoDe } from '../src/server/services/comercial/consumo';

const DIA = 86_400_000;

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB', string>;

interface Opciones { validadoAt?: Date; ia?: boolean; comprobante?: boolean; grupo?: string | null; principal?: boolean; estado?: string }
/** Un pago de un cargo: validado en `validadoAt`, por la IA o a mano, con o sin voucher, y con o sin grupo. */
async function pagar(cargoId: number, o: Opciones = {}) {
  const fecha = o.validadoAt ?? new Date();
  const p = await prisma.pago.create({
    data: { recibo_concepto_unidad_id: cargoId, monto: '10.00', fecha_pago: fecha, estado_validacion: o.estado ?? 'validado', validado_at: fecha, validado_por_ia: o.ia ?? false, grupo: o.grupo ?? null, grupo_principal: o.principal ?? false },
  });
  if (o.comprobante !== false) {
    await prisma.archivoComprobante.create({ data: { pago_id: p.id, nombre: 'v.png', tipo_mime: 'image/png', tamano: 3, sha256: 'v'.repeat(64), datos: Buffer.from([1, 2, 3]) } });
  }
  return p;
}

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe') };
  // Cargos de Complejo A (rcVencidoA: cargoVencidoA1 y cargoA2) y de Complejo B (cargoB1), como los deja `sembrar`.
  await pagar(d.cargoVencidoA1.id, { ia: false }); // a mano → cuenta
  await pagar(d.cargoA2.id, { ia: true }); // IA → cuenta
  await pagar(d.cargoVencidoA1.id, { ia: false, grupo: 'g-1', principal: true }); // grupo: el principal → cuenta una vez
  await pagar(d.cargoA2.id, { ia: false, grupo: 'g-1', principal: false }); // grupo: el resto del mismo grupo → no cuenta
  await pagar(d.cargoA2.id, { ia: false, validadoAt: new Date(Date.now() - 40 * DIA) }); // otro mes → no cuenta
  await pagar(d.cargoA2.id, { ia: false, comprobante: false }); // sin voucher → no cuenta
  await pagar(d.cargoA2.id, { ia: false, estado: 'pendiente' }); // no validado → no cuenta
  await pagar(d.cargoB1.id, { ia: false }); // otro condominio → no cuenta en A
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('vouchers del mes por condominio', () => {
  it('cuenta a mano y con la IA, un grupo una sola vez, y deja fuera lo que no es del mes, no tiene voucher o no está validado', async () => {
    assert.deepEqual(await conteoVouchers(d.complejoA.id), { a_mano: 2, ia: 1 });
  });

  it('el condominio B tiene sus propios números', async () => {
    assert.deepEqual(await conteoVouchers(d.complejoB.id), { a_mano: 1, ia: 0 });
  });

  it('con el mes siguiente, el conteo empieza de cero (la fecha la pone el reloj que se pasa)', async () => {
    assert.deepEqual(await conteoVouchers(d.complejoA.id, new Date(Date.now() + 40 * DIA)), { a_mano: 0, ia: 0 });
  });

  it('el periodo es AAAAMM del mes en Lima', () => {
    assert.match(periodoDe(new Date('2026-10-31T03:00:00Z')), /^202610$/, 'a las 22:00 del 30 en Lima ya es octubre');
    assert.match(periodoDe(new Date('2026-11-01T03:00:00Z')), /^202610$/, 'a las 22:00 del 31 de octubre en Lima sigue en octubre');
    assert.match(periodoDe(new Date('2026-11-01T06:00:00Z')), /^202611$/, 'a la 01:00 del 1 de noviembre en Lima ya es noviembre');
  });

  it('la administradora ve sus números en el endpoint de uso; otra empresa recibe 404', async () => {
    const r = await llamar(base, 'GET', `/api/comercial/mi-plan/${d.complejoA.id}/uso`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.vouchers_a_mano, 2);
    assert.equal(r.body.vouchers_ia, 1);
    assert.match(r.body.periodo, /^\d{6}$/);
    const ajeno = await llamar(base, 'GET', `/api/comercial/mi-plan/${d.complejoA.id}/uso`, T.adminB);
    assert.equal(ajeno.status, 404, ajeno.texto);
  });

  it('Mi plan trae los números de cada condominio de la empresa', async () => {
    const r = await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA);
    assert.equal(r.status, 200, r.texto);
    const c = r.body.condominios.find((x: { complejo_id: number }) => x.complejo_id === d.complejoA.id);
    assert.equal(c.uso.vouchers_a_mano, 2);
    assert.equal(c.uso.vouchers_ia, 1);
  });
});
