import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { rutaPermitida } from '../src/server/lib/rutasApp';
import {
  cuentaCargo, estadoMantenimiento, listarMantenimientos, numeroMantenimiento, repartirSaldos, sumarCuentas, tituloMantenimiento, type CargoCuenta,
} from '../src/server/lib/mantenimientos';
import { avisarResultado } from '../src/server/services/validacionPago';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'prop1' | 'prop2' | 'propB' | 'inq1' | 'presiA' | 'super', string>;

// ---------- Pruebas puras: las cuentas del mantenimiento ----------
describe('mantenimiento: número, título y cuentas (funciones puras)', () => {
  it('el número es legible y estable; el título lleva mes en español, año y unidad', () => {
    assert.equal(numeroMantenimiento(2026, 10, 'B01-804'), '2026-10-B01-804');
    assert.equal(numeroMantenimiento(2026, 3, 'A-101'), '2026-03-A-101');
    assert.equal(tituloMantenimiento(2026, 10, 'B01-804'), 'Mantenimiento de octubre de 2026 · B01-804');
  });

  it('cuentaCargo: pagado manda; lo validado cuenta como cobrado; lo por validar, en revisión; el resto es saldo', () => {
    const c = (x: Partial<CargoCuenta>): CargoCuenta => ({ monto: 100, estado_pago: 'pendiente', ...x });
    const f = (x: ReturnType<typeof cuentaCargo>) => [x.cobrado, x.en_revision, x.saldo].map((v) => v.toFixed(2));
    assert.deepEqual(f(cuentaCargo(c({}))), ['0.00', '0.00', '100.00']);
    assert.deepEqual(f(cuentaCargo(c({ estado_pago: 'pagado' }))), ['100.00', '0.00', '0.00']);
    assert.deepEqual(f(cuentaCargo(c({ validado: 30 }))), ['30.00', '0.00', '70.00']);
    assert.deepEqual(f(cuentaCargo(c({ validado: 30, por_validar: 70, estado_pago: 'en_revision' }))), ['30.00', '70.00', '0.00']);
    assert.deepEqual(f(cuentaCargo(c({ por_validar: 100 }))), ['0.00', '100.00', '0.00']);
    assert.deepEqual(f(cuentaCargo(c({ estado_pago: 'en_revision' }))), ['0.00', '100.00', '0.00'], 'un cargo marcado en revisión cuenta entero aunque no se vea el pago');
    assert.deepEqual(f(cuentaCargo(c({ validado: 500 }))), ['100.00', '0.00', '0.00'], 'lo cobrado nunca pasa del monto');
  });

  const ayer = new Date(HOY - DIA);
  const manana = new Date(HOY + DIA);
  const est = (cargos: CargoCuenta[], vence: Date) => estadoMantenimiento(sumarCuentas(cargos), vence, new Date(HOY));
  const p = (x: Partial<CargoCuenta> = {}): CargoCuenta => ({ monto: 50, estado_pago: 'pendiente', ...x });

  it('estadoMantenimiento: pagado | en_revision | parcial | vencido | pendiente', () => {
    assert.equal(est([p({ estado_pago: 'pagado' }), p({ estado_pago: 'pagado' })], ayer), 'pagado');
    assert.equal(est([p({ estado_pago: 'en_revision' }), p({ estado_pago: 'en_revision' })], ayer), 'en_revision', 'en revisión no es moroso aunque venció');
    assert.equal(est([p(), p()], ayer), 'vencido');
    assert.equal(est([p(), p()], manana), 'pendiente');
    assert.equal(est([p(), p()], new Date(HOY)), 'pendiente', 'el día del vencimiento aún no es mora');
    assert.equal(est([p({ estado_pago: 'pagado' }), p()], manana), 'parcial');
    assert.equal(est([p({ estado_pago: 'en_revision' }), p()], manana), 'parcial');
    assert.equal(est([p({ estado_pago: 'pagado' }), p()], ayer), 'vencido', 'lo que falta ya venció');
    assert.equal(est([p({ estado_pago: 'pagado' }), p({ estado_pago: 'en_revision' })], ayer), 'en_revision');
    assert.equal(est([], ayer), 'pendiente');
  });

  it('repartirSaldos: un monto por cargo con saldo (calculado, no recibido); omite lo pagado o en revisión', () => {
    const r = repartirSaldos([
      { id: 1, monto: '40.00', estado_pago: 'pendiente' },
      { id: 2, monto: '100.00', estado_pago: 'pendiente', validado: '30.00' },
      { id: 3, monto: '10.00', estado_pago: 'pagado' },
      { id: 4, monto: '25.00', estado_pago: 'en_revision' },
    ]);
    assert.deepEqual(r.map((x) => [x.cargoId, x.monto.toFixed(2)]), [[1, '40.00'], [2, '70.00']]);
    assert.equal(r.reduce((a, x) => a + Number(x.monto), 0), 110);
  });
});

// ---------- Con base de datos ----------
let n = 0;
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`captura-${++n}`)]);

async function subir(token: string, pagoId: number, bytes = PNG()) {
  const r = await fetch(`${base}/api/pagos/${pagoId}/comprobante`, { method: 'POST', headers: { 'content-type': 'image/png', ...cabecerasDeSesion(token) }, body: new Uint8Array(bytes) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Mant { reciboId: number; unidadId: number; cargos: { id: number; monto: number; nombre: string }[]; total: number }

/** Un recibo del mes con varios conceptos para UNA unidad: agua 40, limpieza 60, mora 15 (total 115). */
async function mantenimiento(unidad: { id: number }, opts: { mes?: number; vence?: number; complejo?: { id: number; empresa_id: number | null }; conceptos?: [string, number][] } = {}): Promise<Mant> {
  const complejo = opts.complejo ?? d.complejoA;
  const conceptos = opts.conceptos ?? [['Agua', 40], ['Limpieza', 60], ['Mora', 15]];
  const recibo = await prisma.recibo.create({
    data: { empresa_id: complejo.empresa_id, complejo_id: complejo.id, mes: opts.mes ?? 9, anio: 2026, fecha_emision: new Date(HOY - 40 * DIA), fecha_vencimiento: new Date(opts.vence ?? HOY + 20 * DIA), estado: 'emitido' },
  });
  const cargos: Mant['cargos'] = [];
  for (const [i, [nombre, monto]] of conceptos.entries()) {
    const concepto = await prisma.concepto.create({ data: { nombre, empresa_id: complejo.empresa_id, tipo_monto: 'fijo' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, orden: i + 1, es_recargo: nombre === 'Mora' } });
    const c = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: 'pendiente' } });
    cargos.push({ id: c.id, monto, nombre });
  }
  return { reciboId: recibo.id, unidadId: unidad.id, cargos, total: conceptos.reduce((a, [, m]) => a + m, 0) };
}

const pagarMant = (token: string, m: Mant, cuerpo: unknown = { metodo_pago: 'yape', referencia: 'OP123456' }) =>
  llamar(base, 'POST', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}/pagos`, token, cuerpo);
const pagosDe = (m: Mant) => prisma.pago.findMany({ where: { reciboConceptoUnidad: { unidad_id: m.unidadId, reciboConcepto: { recibo_id: m.reciboId } } }, orderBy: { id: 'asc' } });
const estadosCargos = async (m: Mant) => (await prisma.reciboConceptoUnidad.findMany({ where: { id: { in: m.cargos.map((c) => c.id) } }, orderBy: { id: 'asc' } })).map((c) => c.estado_pago);
const validar = (token: string, id: number, cuerpo: unknown = { estado: 'validado' }) => llamar(base, 'PATCH', `/api/pagos/${id}/validacion`, token, cuerpo);

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  await prisma.usuario.create({ data: { nombre: 'Presi A', email: 'presi.a@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'presidente' } });
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'), propB: await login(base, 'propb@test.pe'), inq1: await login(base, 'inq1@test.pe'),
    presiA: await login(base, 'presi.a@test.pe'),
  };
});
after(async () => {
  delete process.env.LLAVERO_ENC_KEY;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.notificacion.deleteMany();
});

describe('asistente: la pantalla del periodo', () => {
  it('/admin/recibos/<id> se reconoce como la pantalla del periodo (sólo para el admin)', () => {
    const admin = { id: 1, email: 'a@x.pe', rol: 'admin', empresa_id: 1, cargo_junta: null, complejo_id: null, estructura_id: null } as const;
    assert.equal(rutaPermitida(admin, '/admin/recibos/12'), '/admin/recibos/:id');
    assert.equal(rutaPermitida(admin, '/admin/recibos/12/'), '/admin/recibos/:id');
    assert.equal(rutaPermitida({ ...admin, rol: 'propietario' }, '/admin/recibos/12'), null);
  });
});

describe('residente: mis mantenimientos (uno por recibo y departamento)', () => {
  it('lista UN mantenimiento por mes y unidad con total, saldo y estado; no mezcla unidades ajenas', async () => {
    const m = await mantenimiento(d.unidadA1);
    await mantenimiento(d.unidadA2); // de otro propietario
    const r = await llamar(base, 'GET', '/api/me/mantenimientos?pageSize=100', T.prop1);
    assert.equal(r.status, 200);
    const propio = r.body.items.filter((x: any) => x.recibo_id === m.reciboId); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(propio.length, 1, 'tres conceptos, un solo mantenimiento');
    assert.equal(propio[0].total, '115.00');
    assert.equal(propio[0].saldo, '115.00');
    assert.equal(propio[0].estado, 'pendiente');
    assert.equal(propio[0].numero, '2026-09-A-101');
    assert.equal(propio[0].titulo, 'Mantenimiento de septiembre de 2026 · A-101');
    assert.ok(r.body.items.every((x: any) => x.unidad.codigo === 'A-101')); // eslint-disable-line @typescript-eslint/no-explicit-any
    // el inquilino de la misma unidad también lo ve
    const inq = await llamar(base, 'GET', '/api/me/mantenimientos?pageSize=100', T.inq1);
    assert.ok(inq.body.items.some((x: any) => x.recibo_id === m.reciboId)); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('el detalle trae los conceptos con sus montos, el condominio, la empresa y los medios de pago; uno ajeno → 404', async () => {
    const m = await mantenimiento(d.unidadA1);
    await prisma.medioPago.deleteMany();
    await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '987654321', titular: 'María Pérez', creado_por_id: d.adminA.id } });
    const r = await llamar(base, 'GET', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}`, T.prop1);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.conceptos.map((c: any) => [c.concepto, c.monto, c.es_recargo]), [['Agua', '40.00', false], ['Limpieza', '60.00', false], ['Mora', '15.00', true]]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.condominio.nombre, 'Complejo A');
    assert.equal(r.body.empresa.nombre, 'Empresa A');
    assert.equal(r.body.medios_pago.length, 1);
    assert.equal(r.body.medios_pago[0].celular, '987654321');
    assert.ok(!('qr_datos' in r.body.medios_pago[0]));
    assert.equal((await llamar(base, 'GET', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}`, T.prop2)).status, 404, 'otro propietario');
    assert.equal((await llamar(base, 'GET', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}`, T.propB)).status, 404, 'otra empresa');
    assert.equal((await llamar(base, 'GET', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}`, T.adminA)).status, 403, 'es para residentes');
  });

  it('filtra por estado y pagina', async () => {
    const vencido = await mantenimiento(d.unidadA1, { mes: 5, vence: HOY - 10 * DIA });
    const r = await llamar(base, 'GET', '/api/me/mantenimientos?estado=vencido&pageSize=100', T.prop1);
    assert.ok(r.body.items.length >= 1 && r.body.items.every((x: any) => x.estado === 'vencido')); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(r.body.items.some((x: any) => x.recibo_id === vencido.reciboId)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const p1 = await llamar(base, 'GET', '/api/me/mantenimientos?pageSize=1&page=1', T.prop1);
    assert.equal(p1.body.items.length, 1);
    assert.ok(p1.body.total > 1);
    assert.equal((await llamar(base, 'GET', '/api/me/mantenimientos?estado=otro', T.prop1)).status, 422);
    assert.equal((await llamar(base, 'GET', '/api/me/mantenimientos?estado=vencido,otro', T.prop1)).status, 422);
    const varios = await llamar(base, 'GET', '/api/me/mantenimientos?estado=vencido,pendiente&pageSize=100', T.prop1);
    assert.ok(varios.body.items.length > 1 && varios.body.items.every((x: any) => ['vencido', 'pendiente'].includes(x.estado))); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(new Set(varios.body.items.map((x: any) => x.estado)).size === 2, 'trae los dos estados'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('pagar el mantenimiento completo (residente)', () => {
  it('un pago reparte un Pago por cargo con el saldo de cada uno, bajo un mismo grupo; los cargos pasan a en_revision', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await pagarMant(T.prop1, m);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.total, '115.00');
    assert.equal(r.body.cargos, 3);
    const pagos = await pagosDe(m);
    assert.deepEqual(pagos.map((p) => Number(p.monto)), [40, 60, 15], 'el monto de cada Pago es el saldo de su cargo');
    assert.equal(new Set(pagos.map((p) => p.grupo)).size, 1);
    assert.equal(pagos[0].grupo, r.body.grupo);
    assert.deepEqual(pagos.map((p) => p.grupo_principal), [true, false, false]);
    assert.equal(r.body.pago_id, pagos[0].id);
    assert.ok(pagos.every((p) => p.estado_validacion === 'por_validar' && p.usuario_id === d.propietario1.id && p.metodo_pago === 'yape' && p.referencia === 'OP123456'));
    assert.deepEqual(await estadosCargos(m), ['en_revision', 'en_revision', 'en_revision']);
    assert.equal(r.body.mantenimiento.estado, 'en_revision');
    assert.equal(r.body.mantenimiento.pagos.length, 1, 'el historial muestra UN pago del mantenimiento');
    assert.equal(r.body.mantenimiento.pagos[0].monto, '115.00');
  });

  it('los montos los calcula el servidor: el cliente no puede mandar montos, cargos ni recibos (422)', async () => {
    const m = await mantenimiento(d.unidadA1);
    for (const extra of [{ monto: '1.00' }, { cargos: [m.cargos[0].id] }, { recibo_id: 999 }, { montos: { [m.cargos[0].id]: 1 } }]) {
      const r = await pagarMant(T.prop1, m, { metodo_pago: 'yape', ...extra });
      assert.equal(r.status, 422, JSON.stringify(extra));
    }
    assert.equal((await pagarMant(T.prop1, m, { referencia: 'x' })).status, 422, 'el método es obligatorio');
    assert.equal((await pagarMant(T.prop1, m, { metodo_pago: 'trueque' })).status, 422);
    assert.equal((await pagosDe(m)).length, 0, 'nada se guardó');
  });

  it('una segunda vez da 409 y no duplica pagos; también si ya está en revisión', async () => {
    const m = await mantenimiento(d.unidadA1);
    assert.equal((await pagarMant(T.prop1, m)).status, 201);
    const otra = await pagarMant(T.prop1, m);
    assert.equal(otra.status, 409);
    assert.match(otra.body.error, /revisión/);
    assert.equal((await pagosDe(m)).length, 3);
  });

  it('dos pagos simultáneos: sólo uno pasa', async () => {
    const m = await mantenimiento(d.unidadA1);
    const rs = await Promise.all([pagarMant(T.prop1, m), pagarMant(T.inq1, m), pagarMant(T.prop1, m)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal((await pagosDe(m)).length, 3);
    assert.equal(new Set((await pagosDe(m)).map((p) => p.grupo)).size, 1);
  });

  it('alcance: el mantenimiento de otro propietario, de otra empresa o inexistente → 404 y no se crea nada', async () => {
    const m = await mantenimiento(d.unidadA2);
    assert.equal((await pagarMant(T.prop1, m)).status, 404, 'otro propietario de la misma empresa');
    assert.equal((await pagarMant(T.propB, m)).status, 404, 'otra empresa');
    assert.equal((await llamar(base, 'POST', `/api/me/mantenimientos/${m.reciboId}/99999/pagos`, T.prop1, { metodo_pago: 'yape' })).status, 404);
    assert.equal((await llamar(base, 'POST', `/api/me/mantenimientos/${m.reciboId + 999}/${d.unidadA1.id}/pagos`, T.prop1, { metodo_pago: 'yape' })).status, 404, 'recibo sin cargos de esa unidad');
    assert.equal((await pagarMant(T.adminA, m)).status, 403);
    assert.equal((await pagosDe(m)).length, 0);
  });

  it('no mezcla meses ni unidades: el recibo y la unidad de la ruta fijan los cargos del grupo', async () => {
    const m1 = await mantenimiento(d.unidadA1, { mes: 6 });
    const m2 = await mantenimiento(d.unidadA1, { mes: 7 });
    const mA2 = await mantenimiento(d.unidadA2, { mes: 6 });
    assert.equal((await pagarMant(T.prop1, m1)).status, 201);
    const pagos = await prisma.pago.findMany({ where: { grupo: { not: null } }, include: { reciboConceptoUnidad: { select: { unidad_id: true, reciboConcepto: { select: { recibo_id: true } } } } } });
    const delGrupo = pagos.filter((p) => p.reciboConceptoUnidad?.reciboConcepto?.recibo_id === m1.reciboId);
    assert.equal(delGrupo.length, 3);
    assert.ok(delGrupo.every((p) => p.reciboConceptoUnidad?.unidad_id === d.unidadA1.id));
    assert.deepEqual(await estadosCargos(m2), ['pendiente', 'pendiente', 'pendiente']);
    assert.deepEqual(await estadosCargos(mA2), ['pendiente', 'pendiente', 'pendiente']);
  });

  it('con un pago parcial previo de un concepto (validado por el admin) paga sólo lo que falta', async () => {
    const m = await mantenimiento(d.unidadA1);
    const parcial = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: m.cargos[1].id, monto: 20, metodo_pago: 'efectivo' });
    assert.equal(parcial.status, 201, JSON.stringify(parcial.body));
    const r = await pagarMant(T.prop1, m);
    assert.equal(r.status, 201);
    assert.equal(r.body.total, '95.00');
    const grupo = (await pagosDe(m)).filter((p) => p.grupo);
    assert.deepEqual(grupo.map((p) => Number(p.monto)), [40, 40, 15]);
  });

  it('el aviso de resultado se manda una vez por grupo (al pago principal)', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await pagarMant(T.prop1, m);
    assert.equal((await validar(T.adminA, r.body.pago_id)).status, 200);
    await esperar(async () => (await prisma.notificacion.count({ where: { tipo: 'pago_validado' } })) > 0);
    const pagos = await pagosDe(m);
    await avisarResultado(pagos[0].id, 'validado'); // idempotente
    const avisos = await prisma.notificacion.findMany({ where: { tipo: 'pago_validado' } });
    const refs = new Set(avisos.map((a) => `${a.usuario_id}:${a.ref_id}`));
    assert.equal(refs.size, avisos.length, 'sin repetidos');
    assert.ok(avisos.every((a) => a.ref_id === pagos[0].id), 'el aviso apunta al pago principal');
  });
});

describe('validar o rechazar el pago del mantenimiento (atómico por grupo)', () => {
  it('validar CUALQUIER pago del grupo valida todos y deja los cargos pagados', async () => {
    const m = await mantenimiento(d.unidadA1);
    await pagarMant(T.prop1, m);
    const pagos = await pagosDe(m);
    const r = await validar(T.adminA, pagos[2].id); // un pago que no es el principal
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const despues = await pagosDe(m);
    assert.ok(despues.every((p) => p.estado_validacion === 'validado' && p.validado_por_id === d.adminA.id && p.validado_at));
    assert.deepEqual(await estadosCargos(m), ['pagado', 'pagado', 'pagado']);
    const det = await llamar(base, 'GET', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}`, T.prop1);
    assert.equal(det.body.estado, 'pagado');
    assert.equal(det.body.saldo, '0.00');
    assert.equal((await validar(T.adminA, pagos[0].id)).status, 409, 'ya se revisó');
  });

  it('rechazar deja TODOS los cargos como antes, con el motivo en cada pago, y se puede volver a pagar', async () => {
    const m = await mantenimiento(d.unidadA1);
    await pagarMant(T.prop1, m);
    const [principal] = await pagosDe(m);
    assert.equal((await validar(T.adminA, principal.id, { estado: 'rechazado' })).status, 422, 'el motivo es obligatorio');
    assert.deepEqual(await estadosCargos(m), ['en_revision', 'en_revision', 'en_revision'], 'un rechazo inválido no cambia nada');
    const r = await validar(T.adminA, principal.id, { estado: 'rechazado', motivo: 'La captura no se ve' });
    assert.equal(r.status, 200);
    const pagos = await pagosDe(m);
    assert.ok(pagos.every((p) => p.estado_validacion === 'rechazado' && p.motivo_rechazo === 'La captura no se ve'));
    assert.deepEqual(await estadosCargos(m), ['pendiente', 'pendiente', 'pendiente']);
    const otra = await pagarMant(T.prop1, m);
    assert.equal(otra.status, 201, 'tras el rechazo vuelve a pagar el total');
    assert.equal(otra.body.total, '115.00');
  });

  it('es atómico: si un pago del grupo ya no está por validar la validación no deja el grupo a medias', async () => {
    const m = await mantenimiento(d.unidadA1);
    await pagarMant(T.prop1, m);
    const [principal] = await pagosDe(m);
    // Dos revisiones a la vez: una gana, la otra recibe 409, y el grupo queda en UN solo estado.
    const rs = await Promise.all([validar(T.adminA, principal.id), validar(T.adminA, principal.id, { estado: 'rechazado', motivo: 'No coincide' })]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    const estados = new Set((await pagosDe(m)).map((p) => p.estado_validacion));
    assert.equal(estados.size, 1);
  });

  it('el alcance de validar es el de siempre: otra empresa → 404; el que pagó no se valida a sí mismo; la junta del block sí valida', async () => {
    const m = await mantenimiento(d.unidadA1);
    await pagarMant(T.prop1, m);
    const [principal, , ultimo] = await pagosDe(m);
    assert.equal((await validar(T.adminB, ultimo.id)).status, 404);
    assert.equal((await validar(T.prop1, principal.id)).status, 403);
    assert.equal((await validar(T.presiA, ultimo.id)).status, 200, 'presidente de la junta del condominio');
    assert.deepEqual(await estadosCargos(m), ['pagado', 'pagado', 'pagado']);
  });
});

describe('la administración registra el pago del mantenimiento', () => {
  it('queda validado de inmediato: un Pago por cargo, cargos pagados, mismo grupo', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await llamar(base, 'POST', `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}/pagos`, T.adminA, { metodo_pago: 'efectivo', usuario_id: d.propietario1.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const pagos = await pagosDe(m);
    assert.equal(pagos.length, 3);
    assert.ok(pagos.every((p) => p.estado_validacion === 'validado' && p.validado_por_id === d.adminA.id && p.grupo === r.body.grupo));
    assert.deepEqual(await estadosCargos(m), ['pagado', 'pagado', 'pagado']);
    assert.equal(r.body.mantenimiento.estado, 'pagado');
    assert.equal((await llamar(base, 'POST', `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}/pagos`, T.adminA, { metodo_pago: 'efectivo' })).status, 409);
  });

  it('otra empresa → 404; un residente → 403; no acepta montos; el usuario debe ser de la empresa', async () => {
    const m = await mantenimiento(d.unidadA1);
    const ruta = `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}/pagos`;
    assert.equal((await llamar(base, 'POST', ruta, T.adminB, { metodo_pago: 'efectivo' })).status, 404);
    assert.equal((await llamar(base, 'POST', ruta, T.prop1, { metodo_pago: 'efectivo' })).status, 403);
    assert.equal((await llamar(base, 'POST', ruta, T.adminA, { metodo_pago: 'efectivo', monto: 1 })).status, 422);
    assert.equal((await llamar(base, 'POST', ruta, T.adminA, { metodo_pago: 'efectivo', usuario_id: d.propietarioB.id })).status, 422);
    assert.equal((await pagosDe(m)).length, 0);
  });
});

describe('comprobante y evaluación de la IA van contra el TOTAL del grupo', () => {
  const fetchOriginal = llaveroDeps.fetch;
  let lectura: Record<string, unknown>;
  let llamadasIA = 0;
  const lec = (extra: Record<string, unknown> = {}) => ({
    es_comprobante_de_pago: true, legible: true, medio: 'yape', estado_operacion: 'exitosa', monto: 115, moneda: 'PEN', fecha: iso(HOY),
    numero_operacion: `OP${String(++n).padStart(6, '0')}`, destinatario_nombre: 'Maria Perez Garcia', destino_numero: '321', ...extra,
  });
  before(() => {
    llaveroDeps.fetch = async () => {
      llamadasIA += 1;
      const t = JSON.stringify(lectura);
      return new Response(JSON.stringify({ choices: [{ message: { content: t } }], candidates: [{ content: { parts: [{ text: t }] } }] }), { status: 200 });
    };
  });
  after(() => { llaveroDeps.fetch = fetchOriginal; });
  beforeEach(async () => {
    llamadasIA = 0;
    await prisma.claveIntegracion.deleteMany();
    await guardarClaveLlavero({ proveedor: 'gemini', clave: 'clave-falsa-gemini-0001', usuarioId: d.superadmin.id });
    await prisma.medioPago.deleteMany();
    await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '987654321', titular: 'María Pérez García', creado_por_id: d.adminA.id } });
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: false } });
  });

  it('el comprobante se guarda UNA vez en el pago principal, también si se sube con el id de otro pago del grupo', async () => {
    const m = await mantenimiento(d.unidadA1);
    lectura = lec();
    await pagarMant(T.prop1, m);
    const [principal, , ultimo] = await pagosDe(m);
    const s = await subir(T.prop1, ultimo.id); // el id de un pago que no es el principal
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.pago_id, principal.id, 'va al principal');
    await esperarEvaluaciones();
    assert.equal(await prisma.archivoComprobante.count({ where: { pago: { grupo: principal.grupo } } }), 1);
    assert.equal(await prisma.evaluacionComprobante.count({ where: { pago: { grupo: principal.grupo } } }), 1);
    // se ve desde cualquier pago del grupo
    for (const p of [principal, ultimo]) {
      const v = await fetch(`${base}/api/pagos/${p.id}/comprobante`, { headers: cabecerasDeSesion(T.adminA) });
      assert.equal(v.status, 200);
    }
    const ev = await llamar(base, 'GET', `/api/pagos/${ultimo.id}/evaluacion`, T.adminA);
    assert.equal(ev.body.evaluacion.estado, 'completada');
  });

  it('compara contra el total del grupo: coincide con S/ 115, NO coincide con el monto de un solo concepto', async () => {
    const m1 = await mantenimiento(d.unidadA1, { mes: 2 });
    lectura = lec({ monto: 115 });
    const r1 = await pagarMant(T.prop1, m1);
    await subir(T.prop1, r1.body.pago_id);
    await esperarEvaluaciones();
    const ev1 = await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: r1.body.pago_id } });
    assert.equal(ev1.veredicto, 'coincide');
    assert.equal((ev1.coincidencias as any).monto, true); // eslint-disable-line @typescript-eslint/no-explicit-any

    const m2 = await mantenimiento(d.unidadA1, { mes: 3 });
    lectura = lec({ monto: 60 }); // sólo la limpieza
    const r2 = await pagarMant(T.prop1, m2);
    await subir(T.prop1, r2.body.pago_id);
    await esperarEvaluaciones();
    const ev2 = await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: r2.body.pago_id } });
    assert.equal(ev2.veredicto, 'no_coincide');
    assert.equal((ev2.coincidencias as any).monto, false); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(llamadasIA >= 2);
  });

  it('la validación automática también va por grupo: valida los 3 pagos y los 3 cargos; nunca rechaza', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: true } });
    const m = await mantenimiento(d.unidadA1, { mes: 4 });
    lectura = lec({ monto: 115 });
    const r = await pagarMant(T.prop1, m);
    await subir(T.prop1, r.body.pago_id);
    await esperarEvaluaciones();
    const pagos = await pagosDe(m);
    assert.ok(pagos.every((p) => p.estado_validacion === 'validado' && p.validado_por_ia === true), JSON.stringify(pagos.map((p) => p.estado_validacion)));
    assert.deepEqual(await estadosCargos(m), ['pagado', 'pagado', 'pagado']);

    const m2 = await mantenimiento(d.unidadA1, { mes: 8 });
    lectura = lec({ monto: 60 });
    const r2 = await pagarMant(T.prop1, m2);
    await subir(T.prop1, r2.body.pago_id);
    await esperarEvaluaciones();
    assert.ok((await pagosDe(m2)).every((p) => p.estado_validacion === 'por_validar'), 'con un monto distinto queda para revisión manual');
  });
});

describe('compatibilidad: pagos sueltos por cargo', () => {
  it('el endpoint por cargo sigue funcionando y el pago suelto se ve como antes (sin grupo)', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await llamar(base, 'POST', `/api/me/cargos/${m.cargos[0].id}/pagos`, T.prop1, { metodo_pago: 'yape' });
    assert.equal(r.status, 201);
    const pago = await prisma.pago.findUniqueOrThrow({ where: { id: r.body.id } });
    assert.equal(pago.grupo, null);
    assert.equal(pago.grupo_principal, false);
    assert.deepEqual(await estadosCargos(m), ['en_revision', 'pendiente', 'pendiente']);
    // el mantenimiento queda parcial/pendiente de lo demás y el resto aún se puede pagar completo
    const det = await llamar(base, 'GET', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}`, T.prop1);
    assert.equal(det.body.estado, 'parcial');
    assert.equal(det.body.en_revision, '40.00');
    assert.equal(det.body.saldo, '75.00');
    assert.equal(det.body.pagos.length, 1);
    assert.equal(det.body.pagos[0].suelto, true);
    assert.deepEqual(det.body.pagos[0].conceptos, ['Agua']);
    const resto = await pagarMant(T.prop1, m);
    assert.equal(resto.status, 201);
    assert.equal(resto.body.total, '75.00');
    assert.equal(resto.body.cargos, 2);
    // la validación del pago suelto sólo toca ese cargo
    assert.equal((await validar(T.adminA, r.body.id)).status, 200);
    assert.deepEqual(await estadosCargos(m), ['pagado', 'en_revision', 'en_revision']);
  });

  it('GET /api/pagos muestra una fila por pago del mantenimiento (+ los sueltos) con el total del grupo', async () => {
    const m = await mantenimiento(d.unidadA1, { mes: 11 });
    const suelto = await mantenimiento(d.unidadA1, { mes: 12 });
    await pagarMant(T.prop1, m);
    const rs = await llamar(base, 'POST', `/api/me/cargos/${suelto.cargos[0].id}/pagos`, T.prop1, { metodo_pago: 'plin' });
    const lista = await llamar(base, 'GET', '/api/pagos?pageSize=100&estado_validacion=por_validar', T.adminA);
    assert.equal(lista.status, 200);
    const filas = lista.body.items.filter((p: any) => p.recibo?.id === m.reciboId || p.recibo?.id === suelto.reciboId); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(filas.length, 2, 'una fila por mantenimiento pagado + el pago suelto');
    const g = filas.find((p: any) => p.recibo.id === m.reciboId); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(g.mantenimiento.total, '115.00');
    assert.equal(g.mantenimiento.conceptos, 3);
    assert.equal(g.mantenimiento.titulo, 'Mantenimiento de noviembre de 2026 · A-101');
    const s = filas.find((p: any) => p.id === rs.body.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(s.mantenimiento, null);
    // el residente ve lo mismo en «mis pagos»
    const mis = await llamar(base, 'GET', '/api/me/pagos?pageSize=100', T.prop1);
    assert.equal(mis.body.items.filter((p: any) => p.recibo?.id === m.reciboId).length, 1); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('borrar un pago de un mantenimiento borra el grupo entero y reabre los cargos; corregirlo corrige el grupo', async () => {
    const m = await mantenimiento(d.unidadA1);
    await llamar(base, 'POST', `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}/pagos`, T.adminA, { metodo_pago: 'efectivo' });
    const pagos = await pagosDe(m);
    const up = await llamar(base, 'PUT', `/api/pagos/${pagos[1].id}`, T.adminA, { referencia: 'CORREGIDA' });
    assert.equal(up.status, 200);
    assert.ok((await pagosDe(m)).every((p) => p.referencia === 'CORREGIDA'));
    const del = await llamar(base, 'DELETE', `/api/pagos/${pagos[1].id}`, T.adminA);
    assert.equal(del.status, 204);
    assert.equal((await pagosDe(m)).length, 0);
    assert.deepEqual(await estadosCargos(m), ['pendiente', 'pendiente', 'pendiente']);
  });
});

describe('administración: periodo agrupado por block y recibos de departamento', () => {
  let c2: { id: number; empresa_id: number | null };
  let b1: { id: number }, b2: { id: number };
  let b2Id = 0;
  let rec: Mant[];
  let reciboId: number;

  before(async () => {
    const complejo = await prisma.complejoHabitacional.create({ data: { nombre: 'Condominio Blocks', tipo: 'condominio', empresa_id: d.empresaA.id } });
    c2 = complejo;
    b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: complejo.id } });
    b2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'block', complejo_id: complejo.id } });
    b2Id = b2.id;
    const unidades = [];
    for (const [i, est] of [[1, b1], [2, b1], [3, b1], [4, b2], [5, b2]] as const) {
      unidades.push(await prisma.unidad.create({ data: { codigo: `BL-${i}`, tipo: 'departamento', complejo_id: complejo.id, empresa_id: d.empresaA.id, estructura_id: est.id, propietario_id: d.propietario2.id, estado: 'activa' } }));
    }
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: complejo.id, mes: 10, anio: 2026, fecha_emision: new Date(HOY - 60 * DIA), fecha_vencimiento: new Date(HOY - 20 * DIA), estado: 'emitido' } });
    reciboId = recibo.id;
    const conceptos = [await prisma.concepto.create({ data: { nombre: 'Agua común', empresa_id: d.empresaA.id } }), await prisma.concepto.create({ data: { nombre: 'Luz común', empresa_id: d.empresaA.id } })];
    const rcs = [];
    for (const [i, c] of conceptos.entries()) rcs.push(await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: c.id, monto: 50 + i * 50, orden: i + 1 } }));
    rec = [];
    for (const u of unidades) {
      const cargos = [];
      for (const rc of rcs) cargos.push(await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: u.id, monto: rc.monto, estado_pago: 'pendiente' } }));
      rec.push({ reciboId, unidadId: u.id, cargos: cargos.map((c) => ({ id: c.id, monto: Number(c.monto), nombre: '' })), total: 150 });
    }
    // BL-1 paga completo (validado); BL-4 queda en revisión; BL-2, BL-3 y BL-5 deben (vencido)
    await llamar(base, 'POST', `/api/recibos/${reciboId}/mantenimientos/${unidades[0].id}/pagos`, T.adminA, { metodo_pago: 'efectivo' });
    await llamar(base, 'POST', `/api/me/mantenimientos/${reciboId}/${unidades[3].id}/pagos`, T.prop2, { metodo_pago: 'yape' });
  });

  it('el periodo se agrupa por block con unidades, emitido, cobrado, % y morosos', async () => {
    const r = await llamar(base, 'GET', `/api/recibos/${reciboId}/blocks`, T.adminA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.agrupado, true);
    const [x, y] = r.body.blocks;
    assert.deepEqual([x.nombre, x.unidades, x.emitido, x.cobrado, x.saldo, x.porcentaje, x.morosos], ['Block 1', 3, '450.00', '150.00', '300.00', 33.3, 2]);
    assert.deepEqual([y.nombre, y.unidades, y.emitido, y.cobrado, y.en_revision, y.saldo, y.morosos], ['Block 2', 2, '300.00', '0.00', '150.00', '150.00', 1], 'lo que está en revisión no es moroso');
  });

  it('la lista de departamentos pagina, filtra por block y estado y busca por código', async () => {
    const todos = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?pageSize=2&page=1`, T.adminA);
    assert.equal(todos.body.total, 5);
    assert.equal(todos.body.items.length, 2);
    assert.deepEqual(todos.body.items.map((x: any) => x.unidad.codigo), ['BL-1', 'BL-2']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const p3 = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?pageSize=2&page=3`, T.adminA);
    assert.deepEqual(p3.body.items.map((x: any) => x.unidad.codigo), ['BL-5']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const b = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?estructura_id=${b2.id}`, T.adminA);
    assert.deepEqual(b.body.items.map((x: any) => x.unidad.codigo), ['BL-4', 'BL-5']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const v = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?estado=vencido`, T.adminA);
    assert.deepEqual(v.body.items.map((x: any) => x.unidad.codigo), ['BL-2', 'BL-3', 'BL-5']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const rv = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?estado=en_revision`, T.adminA);
    assert.deepEqual(rv.body.items.map((x: any) => [x.unidad.codigo, x.total, x.en_revision]), [['BL-4', '150.00', '150.00']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const pg = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?estado=pagado`, T.adminA);
    assert.deepEqual(pg.body.items.map((x: any) => x.unidad.codigo), ['BL-1']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const q = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?q=bl-3`, T.adminA);
    assert.deepEqual(q.body.items.map((x: any) => x.unidad.codigo), ['BL-3']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(q.body.items[0].unidad.estructura.nombre, 'Block 1');
    assert.equal(q.body.items[0].propietario.nombre, 'Propietario 2');
  });

  it('el detalle del departamento trae el desglose por concepto y el pago (con comprobante y evaluación completa para la administración)', async () => {
    const r = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos/${rec[3].unidadId}`, T.adminA);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.conceptos.map((c: any) => [c.concepto, c.monto]), [['Agua común', '50.00'], ['Luz común', '100.00']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.estado, 'en_revision');
    assert.equal(r.body.pagos.length, 1);
    assert.equal(r.body.pagos[0].monto, '150.00');
    assert.equal(r.body.unidad.estructura.nombre, 'Block 2');
  });

  it('otra empresa → 404 en blocks, lista y detalle; el residente → 403', async () => {
    for (const ruta of [`/blocks`, `/mantenimientos`, `/mantenimientos/${rec[0].unidadId}`]) {
      assert.equal((await llamar(base, 'GET', `/api/recibos/${reciboId}${ruta}`, T.adminB)).status, 404, ruta);
      assert.equal((await llamar(base, 'GET', `/api/recibos/${reciboId}${ruta}`, T.prop1)).status, 403, ruta);
    }
    assert.equal((await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?estado=nada`, T.adminA)).status, 422);
    assert.equal((await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?orden=hack:asc`, T.adminA)).status, 422);
  });

  it('morosidad: cada unidad trae su block y se filtra por block', async () => {
    const todas = await llamar(base, 'GET', '/api/reportes/morosidad?pageSize=100&q=BL-', T.adminA);
    assert.deepEqual(todas.body.items.map((x: any) => [x.unidad.codigo, x.estructura?.nombre]).sort(), [['BL-2', 'Block 1'], ['BL-3', 'Block 1'], ['BL-5', 'Block 2']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const b2 = await llamar(base, 'GET', `/api/reportes/morosidad?pageSize=100&estructura_id=${b2Id}`, T.adminA);
    assert.deepEqual(b2.body.items.map((x: any) => x.unidad.codigo), ['BL-5']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await llamar(base, 'GET', `/api/reportes/morosidad?estructura_id=${b2Id}`, T.adminB)).body.total, 0, 'otra empresa: nada');
    assert.equal((await llamar(base, 'GET', '/api/reportes/morosidad?estructura_id=abc', T.adminA)).status, 422);
  });

  it('los blocks salen en orden natural (Block 2 antes que Block 10) y las unidades sin block al final', async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Orden natural', tipo: 'condominio', empresa_id: d.empresaA.id } });
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: c.id, mes: 3, anio: 2026, fecha_emision: new Date(HOY - 60 * DIA), fecha_vencimiento: new Date(HOY + 5 * DIA), estado: 'emitido' } });
    const concepto = await prisma.concepto.create({ data: { nombre: 'Agua', empresa_id: d.empresaA.id } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto: 10, orden: 1 } });
    for (const nombre of ['Block 10', 'Block 2', 'Block 1', null]) {
      const est = nombre ? await prisma.estructura.create({ data: { nombre, tipo: 'block', complejo_id: c.id } }) : null;
      const u = await prisma.unidad.create({ data: { codigo: `ON-${nombre ?? 'x'}`, tipo: 'departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id: est?.id, estado: 'activa' } });
      await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: u.id, monto: 10, estado_pago: 'pendiente' } });
    }
    const r = await llamar(base, 'GET', `/api/recibos/${recibo.id}/blocks`, T.adminA);
    assert.deepEqual(r.body.blocks.map((b: { nombre: string }) => b.nombre), ['Block 1', 'Block 2', 'Block 10', 'Sin block']);
    assert.equal(r.body.agrupado, true);
  });

  it('con un solo block, o sin blocks (casas), no se agrupa: va directo a la lista de departamentos', async () => {
    await prisma.unidad.updateMany({ where: { complejo_id: c2.id }, data: { estructura_id: b1.id } });
    let r = await llamar(base, 'GET', `/api/recibos/${reciboId}/blocks`, T.adminA);
    assert.equal(r.body.agrupado, false, 'un solo block');
    assert.equal(r.body.blocks.length, 1);
    await prisma.unidad.updateMany({ where: { complejo_id: c2.id }, data: { estructura_id: null } });
    r = await llamar(base, 'GET', `/api/recibos/${reciboId}/blocks`, T.adminA);
    assert.equal(r.body.agrupado, false, 'sin blocks');
    assert.equal(r.body.blocks[0].nombre, 'Sin block');
    const lista = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos?sin_block=true`, T.adminA);
    assert.equal(lista.body.total, 5);
    assert.equal(lista.body.items[0].unidad.estructura, null);
    // se deja como estaba para las demás pruebas
    await prisma.unidad.updateMany({ where: { codigo: { in: ['BL-1', 'BL-2', 'BL-3'] }, complejo_id: c2.id }, data: { estructura_id: b1.id } });
    await prisma.unidad.updateMany({ where: { codigo: { in: ['BL-4', 'BL-5'] }, complejo_id: c2.id }, data: { estructura_id: b2.id } });
  });

  it('el estado de la lista (SQL) coincide con el de las funciones puras para cada combinación', async () => {
    const hoy = new Date(HOY);
    const filas = (await listarMantenimientos({ reciboId }, { page: 1, pageSize: 50, hoy })).items;
    const recibo = await prisma.recibo.findUniqueOrThrow({ where: { id: reciboId } });
    for (const f of filas) {
      const det = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos/${f.unidad_id}`, T.adminA);
      assert.equal(f.estado, estadoMantenimiento(det.body, recibo.fecha_vencimiento, hoy), f.numero);
      assert.equal(f.estado, det.body.estado);
      assert.deepEqual([f.total, f.cobrado, f.en_revision, f.saldo], [det.body.total, det.body.cobrado, det.body.en_revision, det.body.saldo]);
    }
    // y con cada estado posible sembrado a mano (parcial, pendiente futuro)
    const futuro = await mantenimiento(d.unidadA2, { mes: 1, vence: HOY + 5 * DIA });
    await prisma.reciboConceptoUnidad.update({ where: { id: futuro.cargos[0].id }, data: { estado_pago: 'pagado' } });
    const parcial = (await listarMantenimientos({ reciboId: futuro.reciboId }, { page: 1, pageSize: 5, hoy })).items[0];
    assert.equal(parcial.estado, 'parcial');
    assert.equal(parcial.estado, estadoMantenimiento(sumarCuentas([{ monto: 40, estado_pago: 'pagado' }, { monto: 60, estado_pago: 'pendiente' }, { monto: 15, estado_pago: 'pendiente' }]), new Date(HOY + 5 * DIA), hoy));
  });
});
