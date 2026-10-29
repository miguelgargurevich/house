// El correo de la junta reemplaza al «correo del block»: el aviso del voucher, el recibo impreso y la lectura de agua usan el de la junta vigente
// y, si ésta no tiene, el `correo_vouchers` del block (los recibos viejos no se rompen). Resend SIEMPRE falso: nunca sale nada a la red real.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { pagarComoResidente, voucherPng } from './helpers/pagoResidente';
import { hoyLima } from '../src/server/lib/fechas';
import { esperarAvisosVoucher, voucherBlockDeps } from '../src/server/services/avisos/voucherBlock';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';
import { llaveroDeps } from '../src/server/services/llavero';
import { correoEfectivo } from '../src/server/services/juntas';

const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const dia = (n: number) => new Date(HOY + n * DIA).toISOString().slice(0, 10);
const CORREO_BLOCK = 'respaldo.block1@ejemplo.test';
const CORREO_JUNTA = 'junta.2026@ejemplo.test';
const ENV_OK = { RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL', MAIL_FROM: 'House <house@ejemplo.test>' };

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let block: { id: number };
let ana: { id: number };
let carla: { id: number };
let T: Record<'prop1' | 'adminA', string>;
let correos: { to: string[] }[] = [];
const originales = { fetch: voucherBlockDeps.fetch, env: voucherBlockDeps.env, espera: voucherBlockDeps.esperaReintentoMs, ia: llaveroDeps.fetch };

/** Un recibo de mantenimiento con un cargo para el departamento. */
async function mantenimiento(unidadId: number) {
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.complejoA.empresa_id, complejo_id: d.complejoA.id, mes: 10, anio: 2026, fecha_emision: new Date(HOY - 10 * DIA), fecha_vencimiento: new Date(HOY + 20 * DIA), estado: 'emitido', estructura_id: block.id } });
  const concepto = await prisma.concepto.create({ data: { nombre: 'Cuota', empresa_id: d.complejoA.empresa_id, tipo_monto: 'fijo' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto: 100, orden: 1 } });
  await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidadId, monto: 100, estado_pago: 'pendiente' } });
  return recibo.id;
}
const pagar = async (reciboId: number) => {
  const r = await pagarComoResidente(base, T.prop1, reciboId, d.unidadA1.id, undefined, voucherPng());
  await esperarAvisosVoucher();
  assert.equal(r.status, 201, r.texto);
  return r;
};
const junta = (correo: string | null, extra: Record<string, unknown> = {}) => prisma.juntaDirectiva.create({ data: { complejo_id: d.complejoA.id, estructura_id: block.id, desde: new Date(HOY - 100 * DIA), correo, ...extra } });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  block = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: d.complejoA.id, correo_vouchers: CORREO_BLOCK } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: block.id } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  const propietario = async (nombre: string, email: string, codigo: string) => {
    const u = await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id } });
    await prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: block.id, propietario_id: u.id, estado: 'activa' } });
    return u;
  };
  ana = await propietario('Ana', 'ana@test.pe', 'B01-201');
  carla = await propietario('Carla', 'carla@test.pe', 'B01-202');
  T = { prop1: await login(base, 'prop1@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
  llaveroDeps.fetch = async () => { throw new Error('sin red en las pruebas'); };
  voucherBlockDeps.fetch = async (_url, init) => {
    correos.push({ to: JSON.parse(String(init?.body)).to });
    return new Response('{"id":"x"}', { status: 200 });
  };
  voucherBlockDeps.esperaReintentoMs = 0;
});
after(async () => {
  Object.assign(voucherBlockDeps, { fetch: originales.fetch, env: originales.env, esperaReintentoMs: originales.espera });
  llaveroDeps.fetch = originales.ia;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  correos = [];
  voucherBlockDeps.env = ENV_OK;
  await prisma.juntaDirectiva.deleteMany();
  await prisma.estructura.update({ where: { id: block.id }, data: { correo_vouchers: CORREO_BLOCK } });
});
afterEach(async () => { await esperarEvaluaciones(); await esperarAvisosVoucher(); });

describe('correoEfectivo', () => {
  it('el de la junta vigente gana; sin él (o vacío), el del block; sin ninguno, null', () => {
    assert.equal(correoEfectivo({ correo_vouchers: 'b@x.pe', juntas: [{ correo: ' j@x.pe ' }] }), 'j@x.pe');
    assert.equal(correoEfectivo({ correo_vouchers: ' b@x.pe ', juntas: [{ correo: null }] }), 'b@x.pe');
    assert.equal(correoEfectivo({ correo_vouchers: 'b@x.pe', juntas: [{ correo: '  ' }] }), 'b@x.pe');
    assert.equal(correoEfectivo({ correo_vouchers: 'b@x.pe', juntas: [] }), 'b@x.pe');
    assert.equal(correoEfectivo({ correo_vouchers: 'b@x.pe' }), 'b@x.pe');
    assert.equal(correoEfectivo({ correo_vouchers: null, juntas: [{ correo: null }] }), null);
    assert.equal(correoEfectivo(null), null);
  });
});

describe('el aviso del voucher va al correo de la junta', () => {
  it('con una junta vigente que tiene correo, el voucher llega a ESE correo y no al del block', async () => {
    await junta(CORREO_JUNTA);
    await pagar(await mantenimiento(d.unidadA1.id));
    assert.deepEqual(correos.map((c) => c.to), [[CORREO_JUNTA]]);
  });

  it('si la junta vigente no tiene correo, cae al `correo_vouchers` del block (respaldo)', async () => {
    await junta(null);
    await pagar(await mantenimiento(d.unidadA1.id));
    assert.deepEqual(correos.map((c) => c.to), [[CORREO_BLOCK]]);
  });

  it('un block sin junta sigue con su `correo_vouchers`', async () => {
    await pagar(await mantenimiento(d.unidadA1.id));
    assert.deepEqual(correos.map((c) => c.to), [[CORREO_BLOCK]]);
  });

  it('el correo de una gestión CERRADA no se usa; con la nueva gestión el voucher va al correo de la nueva junta', async () => {
    const vieja = await junta('vieja.junta@ejemplo.test', { hasta: new Date(HOY - 11 * DIA) });
    await pagar(await mantenimiento(d.unidadA1.id));
    assert.deepEqual(correos.map((c) => c.to), [[CORREO_BLOCK]], 'una junta cerrada no cuenta');
    correos = [];
    await prisma.juntaDirectiva.update({ where: { id: vieja.id }, data: { hasta: null } }); // la vuelve vigente
    const nueva = await llamar(base, 'POST', `/api/juntas/${vieja.id}/nueva-gestion`, T.adminA, { desde: dia(-1), correo: 'nueva.junta@ejemplo.test', miembros: [{ usuario_id: ana.id, cargo: 'presidente' }] });
    assert.equal(nueva.status, 201, nueva.texto);
    await pagar(await mantenimiento(d.unidadA1.id));
    assert.deepEqual(correos.map((c) => c.to), [['nueva.junta@ejemplo.test']]);
  });
});

describe('el recibo impreso, la lectura de agua y la torre muestran el correo efectivo', () => {
  it('el detalle del mantenimiento trae el correo de la junta vigente y, sin él, el del block', async () => {
    const recibo = await mantenimiento(d.unidadA1.id);
    const ver = async () => (await llamar(base, 'GET', `/api/me/mantenimientos/${recibo}/${d.unidadA1.id}`, T.prop1)).body.correo_vouchers;
    assert.equal(await ver(), CORREO_BLOCK);
    const j = await junta(CORREO_JUNTA);
    assert.equal(await ver(), CORREO_JUNTA);
    await prisma.juntaDirectiva.update({ where: { id: j.id }, data: { correo: null } });
    assert.equal(await ver(), CORREO_BLOCK, 'el recibo viejo no se rompe');
    const admin = await llamar(base, 'GET', `/api/recibos/${recibo}/mantenimientos/${d.unidadA1.id}`, T.adminA);
    assert.equal(admin.body.correo_vouchers, CORREO_BLOCK);
  });

  it('la cabecera de lectura de agua y la lista de torres traen el correo efectivo', async () => {
    const recibo = await mantenimiento(d.unidadA1.id);
    await junta(CORREO_JUNTA);
    const agua = await llamar(base, 'GET', `/api/recibos/${recibo}/agua`, T.adminA);
    assert.equal(agua.status, 200, agua.texto);
    assert.equal(agua.body.recibo.estructura.correo_vouchers, CORREO_JUNTA);
    const torres = await llamar(base, 'GET', `/api/estructuras?complejo_id=${d.complejoA.id}`, T.adminA);
    assert.equal(torres.body.items.find((t: { id: number }) => t.id === block.id).correo_vouchers, CORREO_JUNTA);
    assert.ok(!('juntas' in torres.body.items[0]), 'la lista no filtra la relación interna');
  });

  it('PUT correo-vouchers cambia el correo de la junta vigente (y vaciarlo lo vacía de verdad, aunque el respaldo tuviera uno)', async () => {
    const j = await junta(CORREO_JUNTA);
    const put = (correo_vouchers: string | null) => llamar(base, 'PUT', `/api/estructuras/${block.id}/correo-vouchers`, T.adminA, { correo_vouchers });
    assert.equal((await put('otro.correo@ejemplo.test')).status, 200);
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } })).correo, 'otro.correo@ejemplo.test');
    assert.equal((await put(null)).status, 200);
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } })).correo, null);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: block.id } })).correo_vouchers, null);
    // Editar la torre con el correo de la torre también mueve el de la junta (un solo correo)
    const torre = await llamar(base, 'PUT', `/api/estructuras/${block.id}`, T.adminA, { correo_vouchers: 'desde.la.torre@ejemplo.test' });
    assert.equal(torre.status, 200, torre.texto);
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } })).correo, 'desde.la.torre@ejemplo.test');
    // La gestión CERRADA no se toca
    const cerrada = await junta('historia@ejemplo.test', { hasta: new Date(HOY - 200 * DIA), desde: new Date(HOY - 300 * DIA) });
    await put('otro.mas@ejemplo.test');
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: cerrada.id } })).correo, 'historia@ejemplo.test');
  });

  it('la junta (presidente) cambia el correo desde su pantalla y se usa en el aviso', async () => {
    const j = await junta(CORREO_JUNTA, {});
    await prisma.miembroJunta.create({ data: { junta_id: j.id, usuario_id: carla.id, cargo: 'presidente' } });
    await prisma.usuario.update({ where: { id: carla.id }, data: { cargo_junta: 'presidente', estructura_id: block.id } });
    const tCarla = await login(base, 'carla@test.pe');
    assert.equal((await llamar(base, 'PUT', `/api/juntas/${j.id}`, tCarla, { correo: 'carla.presidenta@ejemplo.test' })).status, 200);
    await pagar(await mantenimiento(d.unidadA1.id));
    assert.deepEqual(correos.map((c) => c.to), [['carla.presidenta@ejemplo.test']]);
  });
});
