import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { cabecerasDeSesion, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { cambiarAdministradora } from '../src/server/lib/contratos';

const JPG = (marca: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marca)]);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'prop1', string>;
let pagoId: number;

const subir = async (token: string, id: number, bytes: Buffer) => {
  const r = await fetch(`${base}/api/pagos/${id}/comprobante`, { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-nombre-archivo': 'v.jpg', ...cabecerasDeSesion(token) }, body: new Uint8Array(bytes) });
  return r.status;
};

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  // El vecino de A paga y sube su comprobante; después el condominio pasa a la administradora B (la A sólo lo consulta).
  const pago = await llamar(base, 'POST', `/api/me/cargos/${d.cargoVencidoA1.id}/pagos`, T.prop1, { metodo_pago: 'transferencia', referencia: 'OP-1' });
  assert.equal(pago.status, 201, pago.texto);
  pagoId = pago.body.id;
  assert.equal(await subir(T.prop1, pagoId, JPG('original')), 201);
  await cambiarAdministradora(d.complejoA.id, d.empresaB.id);
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('comprobantes: sólo quien administra HOY el condominio puede subir o reemplazar', () => {
  it('la administradora anterior (consulta) ve el comprobante pero no lo reemplaza', async () => {
    const ver = await fetch(`${base}/api/pagos/${pagoId}/comprobante`, { headers: cabecerasDeSesion(T.adminA) });
    assert.equal(ver.status, 200, 'la anterior sigue pudiendo consultar');
    assert.equal(await subir(T.adminA, pagoId, JPG('falsificado')), 404);
    const guardado = await prisma.archivoComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } });
    assert.ok(Buffer.from(guardado.datos).toString('latin1').endsWith('original'), 'el comprobante original sigue intacto');
  });

  it('la administradora vigente sí puede subir', async () => {
    assert.equal(await subir(T.adminB, pagoId, JPG('de-la-vigente')), 201);
  });
});
