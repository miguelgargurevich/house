// Estado de cuenta (EECC) de un departamento: GET /api/estado-cuenta/unidades/:id (+ estado-cuenta.xlsx).
// Cuadre exacto con «Mi historial» y Morosidad, pagos parciales / rechazados / por validar, mora, rangos, cambio de propietario, permisos (404 sin filtrar) y Excel.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'propE' | 'inqE' | 'propOtro' | 'propSin' | 'juntaB1' | 'juntaCentral' | 'adminA' | 'adminB' | 'superadmin' | 'segA' | 'prop1' | 'propX' | 'propY', string>;
let B1: { id: number };
let B2: { id: number };
let E1: { id: number }; // la unidad «con de todo» (Block 1)
let E2: { id: number }; // otro dueño (Block 2)
let E4: { id: number }; // sin pagos parciales: se compara con Morosidad (Block 1)
let E5: { id: number }; // 14 meses sin pagar (Block 1)
let E6: { id: number }; // cambia de propietario

const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);
const MONTO = /^\d+\.\d{2}$/;

interface PagoDe { fecha: string; estado?: 'validado' | 'por_validar' | 'rechazado'; cargos?: number[]; monto?: number; referencia?: string }
let grupo = 0;

/** Un recibo del mes para una unidad (de complejoA): `pago` paga los cargos indicados (todos por defecto). `monto` = pago parcial (sólo en el primer cargo pagado). */
async function mes(unidad: { id: number }, o: { anio: number; mes: number; vence?: string; conceptos: [string, number][]; pago?: PagoDe; recibo?: { id: number } }) {
  const vence = o.vence ?? `${o.anio}-${String(o.mes).padStart(2, '0')}-20`;
  const recibo = o.recibo ?? (await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: o.mes, anio: o.anio, fecha_emision: dia('2020-01-01'), fecha_vencimiento: dia(vence), estado: 'emitido' } }));
  const g = `eecc-${++grupo}`;
  let primero = true;
  for (const [i, [nombre, monto]] of o.conceptos.entries()) {
    const concepto = await prisma.concepto.create({ data: { nombre, empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, orden: i + 1 } });
    const paga = o.pago && (o.pago.cargos ?? o.conceptos.map((_, j) => j)).includes(i);
    const estadoPago = !paga ? 'pendiente' : o.pago!.estado === 'por_validar' ? 'en_revision' : o.pago!.estado === 'rechazado' || o.pago!.monto !== undefined ? 'pendiente' : 'pagado';
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: estadoPago, fecha_pago: estadoPago === 'pagado' ? new Date(o.pago!.fecha) : null } });
    if (paga) {
      await prisma.pago.create({
        data: {
          recibo_concepto_unidad_id: cargo.id, monto: o.pago!.monto !== undefined ? o.pago!.monto : monto, fecha_pago: new Date(o.pago!.fecha), estado_validacion: o.pago!.estado ?? 'validado',
          grupo: o.pago!.monto !== undefined ? null : g, grupo_principal: primero, metodo_pago: 'yape', referencia: primero ? o.pago!.referencia : undefined,
        },
      });
      primero = false;
    }
  }
  return recibo;
}

const eecc = (token: string, id: number, q = '') => llamar(base, 'GET', `/api/estado-cuenta/unidades/${id}${q}`, token);
const fila = (b: any, periodo: string) => b.filas.find((f: any) => f.periodo === periodo); // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  B1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  B2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  const usuario = (nombre: string, email: string, rol: string, extra: Record<string, unknown> = {}) =>
    prisma.usuario.create({ data: { nombre, email, rol, password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, ...extra } });
  const propE = await usuario('Elena Dueña', 'prop.e@test.pe', 'propietario');
  const inqE = await usuario('Iván Inquilino', 'inq.e@test.pe', 'inquilino');
  const propOtro = await usuario('Otto Otro', 'prop.otro@test.pe', 'propietario');
  await usuario('Sin Unidad', 'prop.sin@test.pe', 'propietario');
  await usuario('Junta Block 1', 'junta.b1@test.pe', 'propietario', { cargo_junta: 'presidente', estructura_id: B1.id });
  await usuario('Junta Central', 'junta.c@test.pe', 'propietario', { cargo_junta: 'tesorero', estructura_id: null });
  const propX = await usuario('Xavier Viejo', 'prop.x@test.pe', 'propietario');
  await usuario('Yolanda Nueva', 'prop.y@test.pe', 'propietario');
  const unidad = (codigo: string, propietario_id: number, estructura_id: number, extra: Record<string, unknown> = {}) =>
    prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id, propietario_id, estado: 'activa', ...extra } });
  E1 = await unidad('E-1', propE.id, B1.id, { inquilino_id: inqE.id });
  E2 = await unidad('E-2', propOtro.id, B2.id);
  const propF = await usuario('Fernanda Cuatro', 'prop.f@test.pe', 'propietario');
  E4 = await unidad('E-4', propF.id, B1.id);
  E5 = await unidad('E-5', propF.id, B1.id);
  E6 = await unidad('E-6', propX.id, B1.id);

  // E-1: 2025-01 pagado completo (voucher con n.º de operación) · 02 pago parcial · 03 por validar con mora · 04 pago rechazado · 05 y 06 sin pagar.
  //  Antes del rango «normal»: 2024-11 y 2024-12 sin pagar (saldo anterior si se pide desde 2025-01).
  await mes(E1, { anio: 2024, mes: 11, conceptos: [['Mantenimiento', 100]] });
  await mes(E1, { anio: 2024, mes: 12, conceptos: [['Mantenimiento', 100], ['Agua', 20]] });
  await mes(E1, { anio: 2025, mes: 1, conceptos: [['Mantenimiento', 100], ['Agua', 50]], pago: { fecha: '2025-01-18T17:00:00.000Z', referencia: 'OP-0001' } });
  await mes(E1, { anio: 2025, mes: 2, conceptos: [['Mantenimiento', 100], ['Agua', 50]], pago: { fecha: '2025-02-25T17:00:00.000Z', cargos: [0], monto: 60 } });
  await mes(E1, { anio: 2025, mes: 3, conceptos: [['Mantenimiento', 100], ['Agua', 50], ['Multa por pago fuera de fecha', 20]], pago: { fecha: '2025-03-15T17:00:00.000Z', estado: 'por_validar', referencia: 'OP-0003' } });
  await mes(E1, { anio: 2025, mes: 4, conceptos: [['Mantenimiento', 100], ['Agua', 50]], pago: { fecha: '2025-04-10T17:00:00.000Z', estado: 'rechazado', referencia: 'OP-0004' } });
  await mes(E1, { anio: 2025, mes: 5, conceptos: [['Mantenimiento', 100], ['Agua', 50]] });
  await mes(E1, { anio: 2025, mes: 6, conceptos: [['Mantenimiento', 100], ['Agua', 50]] });

  // E-2 (otro dueño, Block 2): un mes sin pagar.
  await mes(E2, { anio: 2025, mes: 1, conceptos: [['Mantenimiento', 80]] });
  // E-4: sin pagos parciales; pagado, en revisión, rechazado (queda vencido), mora y dos vencidos.
  await mes(E4, { anio: 2025, mes: 1, conceptos: [['Mantenimiento', 90]], pago: { fecha: '2025-01-10T17:00:00.000Z' } });
  await mes(E4, { anio: 2025, mes: 2, conceptos: [['Mantenimiento', 90], ['Mora', 25]], pago: { fecha: '2025-02-10T17:00:00.000Z', estado: 'por_validar' } });
  await mes(E4, { anio: 2025, mes: 3, conceptos: [['Mantenimiento', 90]], pago: { fecha: '2025-03-10T17:00:00.000Z', estado: 'rechazado' } });
  await mes(E4, { anio: 2025, mes: 4, conceptos: [['Mantenimiento', 90], ['Mora', 25]] });
  // E-5: 14 meses seguidos (2024-01 a 2025-02) sin pagar, de S/ 10.
  for (let i = 0; i < 14; i++) await mes(E5, { anio: 2024 + Math.floor(i / 12), mes: (i % 12) + 1, conceptos: [['Mantenimiento', 10]] });
  // E-6: deuda del dueño anterior (Xavier); luego la unidad cambia de dueño.
  await mes(E6, { anio: 2025, mes: 1, conceptos: [['Mantenimiento', 70]], pago: { fecha: '2025-01-12T17:00:00.000Z' } });
  await mes(E6, { anio: 2025, mes: 2, conceptos: [['Mantenimiento', 70]] });

  T = {
    propE: await login(base, 'prop.e@test.pe'), inqE: await login(base, 'inq.e@test.pe'), propOtro: await login(base, 'prop.otro@test.pe'), propSin: await login(base, 'prop.sin@test.pe'),
    juntaB1: await login(base, 'junta.b1@test.pe'), juntaCentral: await login(base, 'junta.c@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    superadmin: await login(base, 'super@test.pe'), segA: await login(base, 'seg.a@test.pe'), prop1: await login(base, 'prop1@test.pe'), propX: await login(base, 'prop.x@test.pe'), propY: await login(base, 'prop.y@test.pe'),
  };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });

describe('cuenta corriente: cargos, pagos, mora y saldo acumulado', () => {
  it('cabecera: condominio, block, departamento, propietario e inquilino por nombre, corte y sin datos de contacto', async () => {
    const r = await eecc(T.adminA, E1.id);
    assert.equal(r.status, 200);
    const b = r.body;
    assert.equal(b.unidad.codigo, 'E-1');
    assert.equal(b.estructura.nombre, 'Block 1');
    assert.equal(b.condominio.nombre, 'Complejo A');
    assert.equal(b.administradora, 'Empresa A');
    assert.equal(b.propietario, 'Elena Dueña');
    assert.equal(b.inquilino, 'Iván Inquilino');
    assert.equal(b.moneda, 'PEN');
    assert.match(b.fecha_corte, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(b.fecha_corte, new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10), 'hoy en Lima');
    assert.doesNotMatch(r.texto, /@test\.pe|password|telefono|celular/i, 'nunca correos ni teléfonos');
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  });

  it('una fila por recibo, cronológica, con el saldo ACUMULADO fila a fila', async () => {
    const b = (await eecc(T.adminA, E1.id)).body;
    assert.deepEqual(b.filas.map((f: any) => f.periodo), ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']); // eslint-disable-line @typescript-eslint/no-explicit-any
    // cargo − pagado − en revisión = saldo; acumulado = suma corrida (nov 100, dic 120, ene 0, feb 90, mar 0, abr 150, may 150, jun 150).
    assert.deepEqual(b.filas.map((f: any) => f.saldo), ['100.00', '120.00', '0.00', '90.00', '0.00', '150.00', '150.00', '150.00']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(b.filas.map((f: any) => f.saldo_acumulado), ['100.00', '220.00', '220.00', '310.00', '310.00', '460.00', '610.00', '760.00']); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const f of b.filas) {
      for (const k of ['cargo', 'mora', 'pagado', 'en_revision', 'saldo', 'saldo_acumulado']) assert.match(f[k], MONTO, `${f.periodo}.${k} es un monto de texto`);
    }
    assert.equal(b.totales.saldo_deudor, b.filas.at(-1).saldo_acumulado, 'el saldo deudor es el acumulado de la última fila');
  });

  it('el pago completo muestra fecha del voucher, n.º de operación, monto y estado (un voucher = una línea)', async () => {
    const f = fila((await eecc(T.adminA, E1.id)).body, '2025-01');
    assert.equal(f.cargo, '150.00');
    assert.equal(f.pagado, '150.00');
    assert.equal(f.estado, 'pagado');
    assert.deepEqual(f.pagos.map((p: any) => ({ fecha: p.fecha, operacion: p.operacion, monto: p.monto, estado: p.estado })), [{ fecha: '2025-01-18', operacion: 'OP-0001', monto: '150.00', estado: 'validado' }]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(f.por_concepto.map((c: any) => [c.concepto, c.monto]), [['Mantenimiento', '100.00'], ['Agua', '50.00']]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('pago parcial: lo pagado resta, el resto queda como saldo y el mes sigue vencido', async () => {
    const f = fila((await eecc(T.adminA, E1.id)).body, '2025-02');
    assert.equal(f.cargo, '150.00');
    assert.equal(f.pagado, '60.00');
    assert.equal(f.saldo, '90.00');
    assert.equal(f.estado, 'vencido');
    assert.deepEqual(f.pagos.map((p: any) => [p.monto, p.estado]), [['60.00', 'validado']]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('por validar: se muestra pero no es deuda ni está cobrado (va en «en revisión»); la mora viene dentro del cargo y desglosada', async () => {
    const b = (await eecc(T.adminA, E1.id)).body;
    const f = fila(b, '2025-03');
    assert.equal(f.cargo, '170.00');
    assert.equal(f.mora, '20.00');
    assert.ok(f.por_concepto.find((c: any) => c.es_mora && c.monto === '20.00'), 'la multa se marca como mora'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(f.pagado, '0.00');
    assert.equal(f.en_revision, '170.00');
    assert.equal(f.saldo, '0.00');
    assert.equal(f.estado, 'en_revision');
    assert.deepEqual(f.pagos.map((p: any) => [p.operacion, p.monto, p.estado]), [['OP-0003', '170.00', 'por_validar']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(b.totales.mora, '20.00');
  });

  it('pago RECHAZADO: se ve en la lista como «rechazado» pero NO suma en ninguna cifra', async () => {
    const b = (await eecc(T.adminA, E1.id)).body;
    const f = fila(b, '2025-04');
    assert.deepEqual(f.pagos.map((p: any) => [p.operacion, p.monto, p.estado]), [['OP-0004', '150.00', 'rechazado']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(f.pagado, '0.00');
    assert.equal(f.en_revision, '0.00');
    assert.equal(f.saldo, '150.00');
    assert.equal(f.estado, 'vencido');
    assert.equal(b.totales.pagos_rechazados, 1);
    assert.equal(b.totales.pagado, '210.00', 'ene 150 + feb 60: ni el rechazado ni el que espera validación');
  });

  it('totales: cargado, pagado, en revisión, saldo deudor y meses vencidos', async () => {
    const t = (await eecc(T.adminA, E1.id)).body.totales;
    assert.deepEqual(t, {
      cargado: '1140.00', mora: '20.00', pagado: '210.00', en_revision: '170.00', saldo_anterior: '0.00', saldo_deudor: '760.00',
      meses_vencidos: 6, deuda_vencida: '760.00', pagos_rechazados: 1, pagos_anulados: 0,
    });
  });

  it('un cargo pagado SIN pagos (dato anterior al flujo de pagos) cuadra con una línea «sin detalle»', async () => {
    const U = await prisma.unidad.create({ data: { codigo: 'E-LEG', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: B1.id, propietario_id: (await prisma.usuario.findFirstOrThrow({ where: { email: 'prop.f@test.pe' } })).id } });
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 3, anio: 2019, fecha_emision: dia('2019-03-01'), fecha_vencimiento: dia('2019-03-20') } });
    const c = await prisma.concepto.create({ data: { nombre: 'Cuota', empresa_id: d.empresaA.id } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: c.id, monto: 45, orden: 1 } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: U.id, monto: 45, estado_pago: 'pagado', fecha_pago: new Date('2019-03-15T17:00:00.000Z') } });
    const f = (await eecc(T.adminA, U.id)).body.filas[0];
    assert.equal(f.pagado, '45.00');
    assert.deepEqual(f.pagos.map((p: any) => [p.fecha, p.monto, p.estado, p.sin_detalle]), [['2019-03-15', '45.00', 'validado', true]]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('cuadra EXACTO con «Mi historial» y con Morosidad', () => {
  it('mismos números que «Mi historial»: por mes (total, pagado, saldo, estado) y deuda de hoy', async () => {
    const h = (await llamar(base, 'GET', `/api/me/historial?unidad_id=${E1.id}`, T.propE)).body;
    const e = (await eecc(T.propE, E1.id)).body;
    assert.equal(h.meses.length, e.filas.length);
    for (const m of h.meses) {
      const f = fila(e, `${m.anio}-${String(m.mes).padStart(2, '0')}`);
      assert.deepEqual([f.cargo, f.pagado, f.saldo, f.estado], [m.total, m.pagado, m.saldo, m.estado], `mes ${m.anio}-${m.mes}`);
    }
    assert.equal(e.totales.pagado, h.resumen.pagado);
    assert.equal(e.totales.saldo_deudor, h.resumen.deuda_actual);
    assert.equal(e.totales.en_revision, h.resumen.en_revision);
  });

  it('mismos números que Morosidad (admin): deuda vencida y meses vencidos de la unidad', async () => {
    const m = (await llamar(base, 'GET', '/api/reportes/morosidad?pageSize=100', T.adminA)).body;
    const e = (await eecc(T.adminA, E4.id)).body;
    const filaM = m.items.find((x: any) => x.unidad.id === E4.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(filaM, 'E-4 es morosa');
    assert.equal(e.totales.deuda_vencida, filaM.deuda_total);
    assert.equal(e.totales.meses_vencidos, filaM.recibos.length);
    assert.equal(e.totales.deuda_vencida, '205.00', 'mar 90 (su pago fue rechazado) + abr 115 (con mora); feb está en revisión y no es deuda');
  });
});

describe('Morosidad descuenta los abonos parciales validados', () => {
  it('la unidad con un abono parcial (E-1, feb: 60 sobre 100) da la misma deuda vencida en Morosidad que en el estado de cuenta', async () => {
    const m = (await llamar(base, 'GET', '/api/reportes/morosidad?pageSize=100', T.adminA)).body;
    const e = (await eecc(T.adminA, E1.id, '?desde=2024-11&hasta=2025-06')).body;
    const filaM = m.items.find((x: any) => x.unidad.id === E1.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(filaM, 'E-1 es morosa');
    assert.equal(filaM.deuda_total, e.totales.deuda_vencida);
    const feb = filaM.recibos.find((r: any) => r.anio === 2025 && r.mes === 2); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(feb.deuda, '90.00', 'feb: 150 − 60 validados');
  });
});

describe('rango de meses', () => {
  it('desde/hasta recortan las filas y el saldo anterior arrastra lo adeudado antes', async () => {
    const b = (await eecc(T.adminA, E1.id, '?desde=2025-02&hasta=2025-04')).body;
    assert.deepEqual(b.filas.map((f: any) => f.periodo), ['2025-02', '2025-03', '2025-04']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(b.desde, '2025-02');
    assert.equal(b.hasta, '2025-04');
    assert.equal(b.totales.saldo_anterior, '220.00', 'nov 100 + dic 120 (enero quedó en 0)');
    assert.deepEqual(b.filas.map((f: any) => f.saldo_acumulado), ['310.00', '310.00', '460.00']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(b.totales.saldo_deudor, '460.00');
    assert.equal(b.totales.cargado, '470.00');
    assert.equal(b.totales.pagado, '60.00');
    assert.equal(b.totales.meses_vencidos, 4, 'nov, dic, feb y abr hasta el cierre del rango');
  });

  it('sin rango: los últimos 12 meses con recibo, y el saldo anterior trae lo de antes', async () => {
    const b = (await eecc(T.adminA, E5.id)).body;
    assert.equal(b.filas.length, 12);
    assert.equal(b.desde, '2024-03');
    assert.equal(b.hasta, '2025-02');
    assert.equal(b.totales.saldo_anterior, '20.00');
    assert.equal(b.totales.saldo_deudor, '140.00');
    assert.equal(b.filas[0].saldo_acumulado, '30.00');
  });

  it('un rango sin recibos devuelve filas vacías y el saldo anterior, no un error', async () => {
    const b = (await eecc(T.adminA, E1.id, '?desde=2030-01&hasta=2030-12')).body;
    assert.deepEqual(b.filas, []);
    assert.equal(b.desde, null);
    const c = (await eecc(T.adminA, E1.id, '?desde=2020-01&hasta=2020-12')).body;
    assert.deepEqual([c.filas.length, c.totales.saldo_deudor], [0, '0.00']);
  });

  it('un rango inválido es 422 con el campo', async () => {
    for (const q of ['?desde=2025-13', '?desde=2025', '?hasta=abc', '?desde=1999-01', '?desde=2025-05&hasta=2025-01']) {
      const r = await eecc(T.adminA, E1.id, q);
      assert.equal(r.status, 422, q);
      assert.ok(r.body.campos, q);
    }
  });
});

describe('cambio de propietario', () => {
  it('la cuenta es de la UNIDAD: el nuevo dueño ve el historial completo, con su nombre; el dueño anterior ya no la ve (404)', async () => {
    assert.equal((await eecc(T.propX, E6.id)).status, 200, 'antes del traspaso');
    const nuevo = await prisma.usuario.findFirstOrThrow({ where: { email: 'prop.y@test.pe' } });
    await prisma.unidad.update({ where: { id: E6.id }, data: { propietario_id: nuevo.id } });
    const b = (await eecc(T.propY, E6.id)).body;
    assert.equal(b.propietario, 'Yolanda Nueva');
    assert.deepEqual(b.filas.map((f: any) => f.periodo), ['2025-01', '2025-02']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(b.totales.saldo_deudor, '70.00');
    assert.equal((await eecc(T.propX, E6.id)).status, 404);
  });
});

describe('permisos: ajeno → 404 sin filtrar existencia', () => {
  const noExiste = async (token: string, id: number) => {
    const r = await eecc(token, id);
    const x = await eecc(token, 999_999);
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, x.body, 'misma respuesta que una unidad que no existe');
    const e = await fetch(`${base}/api/estado-cuenta/unidades/${id}/estado-cuenta.xlsx`, { headers: cabecerasDeSesion(token) });
    assert.equal(e.status, 404);
  };

  it('admin: cualquier unidad de su empresa; la de otra empresa es 404 (y al revés)', async () => {
    assert.equal((await eecc(T.adminA, E2.id)).status, 200);
    assert.equal((await eecc(T.adminA, d.unidadA1.id)).status, 200);
    await noExiste(T.adminA, d.unidadB1.id);
    await noExiste(T.adminB, E1.id);
    assert.equal((await eecc(T.adminB, d.unidadB1.id)).status, 200);
  });

  it('superadmin ve cualquiera', async () => {
    assert.equal((await eecc(T.superadmin, E1.id)).status, 200);
    assert.equal((await eecc(T.superadmin, d.unidadB1.id)).status, 200);
  });

  it('residente: sólo SUS unidades (propietario o inquilino); otra unidad, aun del mismo condominio, es 404', async () => {
    assert.equal((await eecc(T.propE, E1.id)).status, 200);
    assert.equal((await eecc(T.inqE, E1.id)).status, 200, 'el inquilino ve la unidad que habita');
    await noExiste(T.propE, E2.id);
    await noExiste(T.inqE, E4.id);
    await noExiste(T.propOtro, E1.id);
    await noExiste(T.propSin, E1.id);
    await noExiste(T.prop1, E2.id);
  });

  it('junta de un block: las unidades de SU block (de otros dueños) sí; las de otro block, 404', async () => {
    assert.equal((await eecc(T.juntaB1, E1.id)).status, 200);
    assert.equal((await eecc(T.juntaB1, E4.id)).status, 200);
    await noExiste(T.juntaB1, E2.id); // Block 2
    await noExiste(T.juntaB1, d.unidadB1.id); // otro condominio
  });

  it('junta central (sin block): todos los blocks de su condominio, pero no otro condominio', async () => {
    assert.equal((await eecc(T.juntaCentral, E1.id)).status, 200);
    assert.equal((await eecc(T.juntaCentral, E2.id)).status, 200);
    await noExiste(T.juntaCentral, d.unidadB1.id);
  });

  it('personal que no es admin (seguridad) → 403; sin sesión → 401', async () => {
    assert.equal((await eecc(T.segA, E1.id)).status, 403);
    assert.equal((await llamar(base, 'GET', `/api/estado-cuenta/unidades/${E1.id}`, null)).status, 401);
  });

  it('el id debe ser un número positivo (422)', async () => {
    assert.equal((await eecc(T.adminA, 0)).status, 422);
    assert.equal((await llamar(base, 'GET', '/api/estado-cuenta/unidades/abc', T.adminA)).status, 422);
  });
});

describe('Excel: las mismas cifras que la pantalla', () => {
  const bajar = async (token: string, id: number, q = '') => {
    const r = await fetch(`${base}/api/estado-cuenta/unidades/${id}/estado-cuenta.xlsx${q}`, { headers: cabecerasDeSesion(token) });
    return { r, libro: r.status === 200 ? XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' }) : null };
  };

  it('hojas «Resumen», «Cuenta corriente» y «Pagos»; una fila por recibo con los mismos montos y el saldo acumulado', async () => {
    const { r, libro } = await bajar(T.adminA, E1.id);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /spreadsheetml\.sheet/);
    assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="estado-cuenta-E-1\.xlsx"/);
    assert.deepEqual(libro!.SheetNames, ['Resumen', 'Cuenta corriente', 'Pagos']);
    const json = (await eecc(T.adminA, E1.id)).body;
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro!.Sheets['Cuenta corriente']);
    const meses = filas.filter((f) => f.Mes !== 'Total');
    assert.equal(meses.length, json.filas.length);
    for (const [i, f] of json.filas.entries()) {
      assert.equal(meses[i]!['Cargo (S/)'], Number(f.cargo));
      assert.equal(meses[i]!['Pagado (S/)'], Number(f.pagado));
      assert.equal(meses[i]!['En revisión (S/)'], Number(f.en_revision));
      assert.equal(meses[i]!['Saldo del mes (S/)'], Number(f.saldo));
      assert.equal(meses[i]!['Saldo acumulado (S/)'], Number(f.saldo_acumulado));
    }
    const total = filas.find((f) => f.Mes === 'Total')!;
    assert.equal(total['Cargo (S/)'], Number(json.totales.cargado));
    assert.equal(total['Pagado (S/)'], Number(json.totales.pagado));
    assert.equal(total['Saldo acumulado (S/)'], Number(json.totales.saldo_deudor));
    const resumen = Object.fromEntries(XLSX.utils.sheet_to_json<unknown[]>(libro!.Sheets.Resumen, { header: 1 }).map((x) => [x[0], x[1]]));
    assert.equal(resumen['Saldo deudor (S/)'], Number(json.totales.saldo_deudor));
    assert.equal(resumen['Departamento'], 'E-1');
    assert.equal(resumen['Propietario'], 'Elena Dueña');
  });

  it('«Pagos»: con n.º de operación y estado; el rechazado va marcado «no suma»', async () => {
    const { libro } = await bajar(T.propE, E1.id);
    const pagos = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro!.Sheets.Pagos);
    assert.deepEqual(pagos.map((p) => [p['N.º de operación'] || '', p['Monto (S/)'], p.Estado]), [
      ['OP-0001', 150, 'Validado'], ['', 60, 'Validado'], ['OP-0003', 170, 'Por validar'], ['OP-0004', 150, 'Rechazado (no suma)'],
    ]);
    const validados = pagos.filter((p) => p.Estado === 'Validado').reduce((a, p) => a + Number(p['Monto (S/)']), 0);
    assert.equal(validados, 210, 'lo validado de «Pagos» es el «Total pagado» del resumen');
  });

  it('respeta el rango y el saldo anterior', async () => {
    const { libro } = await bajar(T.adminA, E1.id, '?desde=2025-02&hasta=2025-04');
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro!.Sheets['Cuenta corriente']);
    assert.deepEqual(filas.map((f) => f.Mes), ['Saldo anterior', 'Febrero 2025', 'Marzo 2025', 'Abril 2025', 'Total']);
    assert.equal(filas[0]!['Saldo acumulado (S/)'], 220);
    assert.equal(filas[3]!['Saldo acumulado (S/)'], 460);
  });

  it('un rango inválido es 422 también en el Excel', async () => {
    const { r } = await bajar(T.adminA, E1.id, '?desde=2025-05&hasta=2025-01');
    assert.equal(r.status, 422);
  });
});
