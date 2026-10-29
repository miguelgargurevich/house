// «Mi historial» del residente: GET /api/me/historial (+ .xlsx). Alcance, cuentas (pagado, deuda, puntualidad, agua) y el Excel.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { MIN_LECTURAS_PROMEDIO, MIN_UNIDADES_PROMEDIO } from '../src/server/services/historial';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'propH' | 'inqH' | 'propL' | 'propSin' | 'prop2' | 'adminA' | 'propM', string>;
let H1: { id: number };
let H2: { id: number };
let L1: { id: number };

const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);
const MONTO = /^\d+\.\d{2}$/;

interface PagoDe { fecha: string; estado?: 'validado' | 'por_validar'; cargos?: number[] }
let grupo = 0;

/** Un recibo del mes (de complejoA) con sus conceptos para una unidad; con `pago`, paga los cargos indicados (todos por defecto). Devuelve el recibo. */
async function mes(unidad: { id: number }, o: { anio: number; mes: number; vence: string; conceptos: [string, number][]; pago?: PagoDe; recibo?: { id: number } }) {
  const recibo = o.recibo ?? (await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: o.mes, anio: o.anio, fecha_emision: dia('2024-01-01'), fecha_vencimiento: dia(o.vence), estado: 'emitido' } }));
  const g = `hist-${++grupo}`;
  for (const [i, [nombre, monto]] of o.conceptos.entries()) {
    const concepto = await prisma.concepto.create({ data: { nombre, empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, orden: i + 1 } });
    const paga = o.pago && (o.pago.cargos ?? o.conceptos.map((_, j) => j)).includes(i);
    const estadoPago = !paga ? 'pendiente' : o.pago!.estado === 'por_validar' ? 'en_revision' : 'pagado';
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: estadoPago, fecha_pago: estadoPago === 'pagado' ? new Date(o.pago!.fecha) : null } });
    if (paga) await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo.id, monto, fecha_pago: new Date(o.pago!.fecha), estado_validacion: o.pago!.estado ?? 'validado', grupo: g, grupo_principal: i === 0, metodo_pago: 'yape' } });
  }
  return recibo;
}

const lectura = (unidad: { id: number }, reciboId: number, anterior: number, actual: number) =>
  prisma.lecturaAgua.create({ data: { unidad_id: unidad.id, recibo_id: reciboId, fecha_anterior: dia('2025-01-01'), lectura_anterior: anterior, fecha_actual: dia('2025-02-01'), lectura_actual: actual, factor: 2.5 } });

const historial = (token: string, q = '') => llamar(base, 'GET', `/api/me/historial${q}`, token);
const mesDe = (b: any, anio: number, m: number, codigo: string) => b.meses.find((x: any) => x.anio === anio && x.mes === m && x.unidad.codigo === codigo); // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  const usuario = (nombre: string, email: string, rol: string) => prisma.usuario.create({ data: { nombre, email, rol, password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id } });
  const propH = await usuario('Propietaria Hist', 'prop.h@test.pe', 'propietario');
  const inqH = await usuario('Inquilino Hist', 'inq.h@test.pe', 'inquilino');
  const propL = await usuario('Propietario Largo', 'prop.l@test.pe', 'propietario');
  await usuario('Propietario Sin Unidad', 'prop.sin@test.pe', 'propietario');
  const unidad = (codigo: string, propietario_id: number, extra: Record<string, unknown> = {}) =>
    prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id, estado: 'activa', ...extra } });
  H1 = await unidad('H-1', propH.id, { inquilino_id: inqH.id });
  H2 = await unidad('H-2', propH.id);
  L1 = await unidad('L-1', propL.id);

  // H-1 en 2025. Ene: pagó el día del vencimiento a las 22:00 de Lima (ya es el día siguiente en UTC). Feb: 2 días tarde. May: 5 días antes.
  const ene = await mes(H1, { anio: 2025, mes: 1, vence: '2025-02-10', conceptos: [['Agua', 40], ['Limpieza', 60]], pago: { fecha: '2025-02-11T03:00:00.000Z' } });
  const feb = await mes(H1, { anio: 2025, mes: 2, vence: '2025-03-10', conceptos: [['Agua', 50], ['Limpieza', 60]], pago: { fecha: '2025-03-12T15:00:00.000Z' } });
  const mar = await mes(H1, { anio: 2025, mes: 3, vence: '2025-04-10', conceptos: [['Agua', 30], ['Limpieza', 60], ['Mora', 15]] }); // sin pagar: vencido
  await mes(H1, { anio: 2025, mes: 4, vence: '2025-05-10', conceptos: [['Agua', 20], ['Limpieza', 60]], pago: { fecha: '2025-05-09T15:00:00.000Z', estado: 'por_validar' } }); // en revisión
  await mes(H1, { anio: 2025, mes: 5, vence: '2025-06-10', conceptos: [['Agua', 30], ['Limpieza', 60]], pago: { fecha: '2025-06-05T15:00:00.000Z' } });
  await mes(H1, { anio: 2025, mes: 6, vence: '2025-07-10', conceptos: [['Agua', 40], ['Limpieza', 60]], pago: { fecha: '2025-07-01T15:00:00.000Z', cargos: [0] } }); // pagó sólo el agua
  // H-2: un mes sin pagar, en el mismo recibo de enero.
  await mes(H2, { anio: 2025, mes: 1, vence: '2025-02-10', conceptos: [['Agua', 70]], recibo: ene });

  // Agua: enero tiene 3 lecturas (H-1 10 m³, A-101 20, A-102 30 → promedio 20); febrero sólo 2.
  await lectura(H1, ene.id, 100, 110);
  await lectura(d.unidadA1, ene.id, 200, 220);
  await lectura(d.unidadA2, ene.id, 300, 330);
  await lectura(H1, feb.id, 110, 122.5);
  await lectura(d.unidadA2, feb.id, 330, 337.5);

  // Total del block: los recibos de H-1 traen también cargos de otros departamentos (montos que el residente nunca debe ver).
  //  ene: H-1 100 + H-2 70 + A-101 55.50 + A-102 94.50 → 4 unidades, promedio 80.00 (H-1 y H-2 son del mismo dueño: quedan 2 ajenas).
  //  feb: H-1 110 + A-102 41.25 → sólo 2 unidades: sin promedio.  mar: H-1 105 + A-101 201.75 + A-102 38.25 → justo 3 unidades: promedio 115.00.
  await mes(d.unidadA1, { anio: 2025, mes: 1, vence: '2025-02-10', conceptos: [['Cuota', 55.5]], recibo: ene });
  await mes(d.unidadA2, { anio: 2025, mes: 1, vence: '2025-02-10', conceptos: [['Cuota', 94.5]], recibo: ene });
  await mes(d.unidadA2, { anio: 2025, mes: 2, vence: '2025-03-10', conceptos: [['Cuota', 41.25]], recibo: feb });
  await mes(d.unidadA1, { anio: 2025, mes: 3, vence: '2025-04-10', conceptos: [['Cuota', 201.75]], recibo: mar });
  await mes(d.unidadA2, { anio: 2025, mes: 3, vence: '2025-04-10', conceptos: [['Cuota', 38.25]], recibo: mar });

  // M-1 y M-2 (mismo dueño) en 2023. ene: con A-101 sólo hay 1 unidad ajena → el promedio dejaría ver su monto exacto. feb: con A-101 y A-102, 2 ajenas.
  const propM = await usuario('Propietario Doble', 'prop.m@test.pe', 'propietario');
  const M1 = await unidad('M-1', propM.id);
  const M2 = await unidad('M-2', propM.id);
  const m23ene = await mes(M1, { anio: 2023, mes: 1, vence: '2023-02-10', conceptos: [['Mantenimiento', 50]] });
  await mes(M2, { anio: 2023, mes: 1, vence: '2023-02-10', conceptos: [['Mantenimiento', 30]], recibo: m23ene });
  await mes(d.unidadA1, { anio: 2023, mes: 1, vence: '2023-02-10', conceptos: [['Cuota', 71.4]], recibo: m23ene });
  const m23feb = await mes(M1, { anio: 2023, mes: 2, vence: '2023-03-10', conceptos: [['Mantenimiento', 50]] });
  await mes(M2, { anio: 2023, mes: 2, vence: '2023-03-10', conceptos: [['Mantenimiento', 30]], recibo: m23feb });
  await mes(d.unidadA1, { anio: 2023, mes: 2, vence: '2023-03-10', conceptos: [['Cuota', 71.4]], recibo: m23feb });
  await mes(d.unidadA2, { anio: 2023, mes: 2, vence: '2023-03-10', conceptos: [['Cuota', 88.6]], recibo: m23feb });

  // L-1: 14 meses seguidos (2024-01 a 2025-02), todos sin pagar y de S/ 10.
  for (let i = 0; i < 14; i++) {
    const anio = 2024 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    await mes(L1, { anio, mes: m, vence: `${anio}-${String(m).padStart(2, '0')}-20`, conceptos: [['Mantenimiento', 10]] });
  }

  T = {
    propH: await login(base, 'prop.h@test.pe'), inqH: await login(base, 'inq.h@test.pe'), propL: await login(base, 'prop.l@test.pe'),
    propSin: await login(base, 'prop.sin@test.pe'), prop2: await login(base, 'prop2@test.pe'), propM: await login(base, 'prop.m@test.pe'), adminA: await login(base, 'admin.a@test.pe'),
  };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });

describe('GET /api/me/historial: alcance', () => {
  it('sin sesión → 401; un rol que no es residente → 403', async () => {
    assert.equal((await historial('')).status, 401);
    assert.equal((await historial(T.adminA)).status, 403);
  });

  it('el propietario ve sus dos unidades y sus años; el filtro por unidad deja sólo esa', async () => {
    const r = await historial(T.propH, '?anio=2025');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.unidades.map((u: any) => u.codigo), ['H-1', 'H-2']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(r.body.anios, [2025]);
    const h2 = await historial(T.propH, `?anio=2025&unidad_id=${H2.id}`);
    assert.deepEqual(h2.body.meses.map((m: any) => m.unidad.codigo), ['H-2']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(h2.body.unidades.length, 2, 'el filtro sigue mostrando las unidades para poder cambiar');
  });

  it('una unidad ajena (o inexistente) es 404, también en el Excel', async () => {
    assert.equal((await historial(T.propH, `?unidad_id=${d.unidadA2.id}`)).status, 404);
    assert.equal((await historial(T.prop2, `?unidad_id=${H1.id}`)).status, 404);
    assert.equal((await historial(T.propH, '?unidad_id=999999')).status, 404);
    const x = await fetch(`${base}/api/me/historial.xlsx?unidad_id=${d.unidadA2.id}`, { headers: cabecerasDeSesion(T.propH) });
    assert.equal(x.status, 404);
  });

  it('el inquilino ve SÓLO la unidad que habita (y la otra del dueño es 404)', async () => {
    const r = await historial(T.inqH, '?anio=2025');
    assert.deepEqual(r.body.unidades.map((u: any) => u.codigo), ['H-1']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(r.body.meses.every((m: any) => m.unidad.codigo === 'H-1')); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.resumen.deuda_actual, '165.00', 'sólo lo de H-1: marzo 105 + el saldo de junio 60');
    assert.equal((await historial(T.inqH, `?unidad_id=${H2.id}`)).status, 404);
  });

  it('un propietario sin unidades recibe todo vacío, no un error', async () => {
    const r = await historial(T.propSin);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.unidades, []);
    assert.deepEqual(r.body.meses, []);
    assert.deepEqual(r.body.anios, []);
    assert.equal(r.body.resumen.pagado, '0.00');
    assert.equal(r.body.resumen.deuda_actual, '0.00');
    assert.equal(r.body.resumen.agua_promedio_m3, null);
  });

  it('los parámetros inválidos son 422', async () => {
    assert.equal((await historial(T.propH, '?anio=abc')).status, 422);
    assert.equal((await historial(T.propH, '?anio=1900')).status, 422);
    assert.equal((await historial(T.propH, '?unidad_id=0')).status, 422);
  });
});

describe('GET /api/me/historial: los meses', () => {
  it('uno por recibo y unidad, en orden cronológico, con el desglose por concepto y los montos como texto de 2 decimales', async () => {
    const r = await historial(T.propH, '?anio=2025');
    assert.deepEqual(r.body.meses.map((m: any) => `${m.mes}-${m.unidad.codigo}`), ['1-H-1', '1-H-2', '2-H-1', '3-H-1', '4-H-1', '5-H-1', '6-H-1']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const ene = mesDe(r.body, 2025, 1, 'H-1');
    assert.deepEqual(ene.por_concepto, [{ concepto: 'Agua', monto: '40.00' }, { concepto: 'Limpieza', monto: '60.00' }]);
    assert.equal(ene.total, '100.00');
    assert.equal(ene.pagado, '100.00');
    assert.equal(ene.saldo, '0.00');
    assert.equal(ene.estado, 'pagado');
    assert.equal(ene.fecha_vencimiento, '2025-02-10');
    for (const m of r.body.meses) for (const v of [m.total, m.pagado, m.saldo, ...m.por_concepto.map((c: any) => c.monto)]) assert.match(v, MONTO); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const k of ['pagado', 'promedio_mes', 'deuda_actual', 'en_revision']) assert.match(r.body.resumen[k], MONTO, k);
  });

  it('estado, pagado y saldo de cada caso: pagado, vencido, en revisión y pago parcial', async () => {
    const b = (await historial(T.propH, '?anio=2025')).body;
    const mar = mesDe(b, 2025, 3, 'H-1');
    assert.deepEqual([mar.estado, mar.pagado, mar.saldo, mar.total, mar.fecha_pago, mar.dias_vs_vencimiento], ['vencido', '0.00', '105.00', '105.00', null, null]);
    assert.deepEqual(mar.por_concepto.map((c: any) => c.concepto), ['Agua', 'Limpieza', 'Mora']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const abr = mesDe(b, 2025, 4, 'H-1');
    assert.deepEqual([abr.estado, abr.pagado, abr.saldo, abr.fecha_pago], ['en_revision', '0.00', '0.00', null], 'lo que espera validación ni está pagado ni se debe');
    const jun = mesDe(b, 2025, 6, 'H-1');
    assert.deepEqual([jun.estado, jun.pagado, jun.saldo, jun.fecha_pago], ['vencido', '40.00', '60.00', null], 'pagó sólo el agua: el resto sigue vencido');
  });

  it('días contra el vencimiento: el día de Lima, no el de UTC (negativo = antes)', async () => {
    const b = (await historial(T.propH, '?anio=2025')).body;
    assert.equal(mesDe(b, 2025, 1, 'H-1').dias_vs_vencimiento, 0, '22:00 en Lima del día del vencimiento ya es el día siguiente en UTC: sigue siendo a tiempo');
    assert.equal(mesDe(b, 2025, 2, 'H-1').dias_vs_vencimiento, 2);
    assert.equal(mesDe(b, 2025, 5, 'H-1').dias_vs_vencimiento, -5);
    assert.equal(mesDe(b, 2025, 5, 'H-1').fecha_pago, '2025-06-05T15:00:00.000Z');
  });

  it('agua: el consumo propio y el promedio del block (sólo con 3 o más lecturas, para no revelar a un vecino)', async () => {
    assert.equal(MIN_LECTURAS_PROMEDIO, 3);
    const r = await historial(T.propH, '?anio=2025');
    const ene = mesDe(r.body, 2025, 1, 'H-1');
    assert.equal(ene.agua_m3, '10.000');
    assert.equal(ene.agua_promedio_block, '20.000');
    const feb = mesDe(r.body, 2025, 2, 'H-1');
    assert.equal(feb.agua_m3, '12.500');
    assert.equal(feb.agua_promedio_block, null, 'dos lecturas: el promedio dejaría ver el consumo del vecino');
    assert.equal(mesDe(r.body, 2025, 3, 'H-1').agua_m3, null);
    assert.equal(mesDe(r.body, 2025, 3, 'H-1').agua_promedio_block, null);
    assert.ok(!r.texto.includes('30.000') && !r.texto.includes('7.500'), 'el consumo de otro departamento nunca sale');
    assert.equal(r.body.resumen.agua_promedio_m3, '11.250');
  });

  it('total del block: el promedio del total de las unidades del recibo, sólo con las suficientes y nunca con montos de otro', async () => {
    assert.equal(MIN_UNIDADES_PROMEDIO, 3);
    const r = await historial(T.propH, '?anio=2025');
    assert.equal(mesDe(r.body, 2025, 1, 'H-1').total_promedio_block, '80.00', '(100 + 70 + 55.50 + 94.50) ÷ 4');
    assert.equal(mesDe(r.body, 2025, 1, 'H-2').total_promedio_block, '80.00', 'el mismo recibo, el mismo promedio');
    assert.equal(mesDe(r.body, 2025, 2, 'H-1').total_promedio_block, null, 'dos unidades en el recibo: el promedio dejaría ver el monto del vecino');
    assert.equal(mesDe(r.body, 2025, 3, 'H-1').total_promedio_block, '115.00', 'justo el mínimo de unidades: se publica');
    assert.equal(mesDe(r.body, 2025, 4, 'H-1').total_promedio_block, null, 'un recibo donde sólo está la unidad propia');
    for (const m of r.body.meses) assert.ok(m.total_promedio_block === null || MONTO.test(m.total_promedio_block));
    for (const ajeno of ['55.50', '94.50', '41.25', '201.75', '38.25']) assert.ok(!r.texto.includes(ajeno), `el monto de otro departamento (${ajeno}) nunca sale`);
    assert.ok(!r.texto.includes('A-101') && !r.texto.includes('A-102'), 'ni sus códigos');
    assert.deepEqual(Object.keys(mesDe(r.body, 2025, 1, 'H-1')).filter((k) => /unidades|cantidad|n_|count/i.test(k)), [], 'tampoco cuántas unidades hay');
  });

  it('total del block: quien tiene dos unidades en el recibo necesita al menos 2 ajenas (con 1, el promedio revelaría su monto exacto)', async () => {
    const r = await historial(T.propM, '?anio=2023');
    assert.equal(r.status, 200);
    assert.equal(mesDe(r.body, 2023, 1, 'M-1').total_promedio_block, null, '3 unidades pero 2 son suyas: promedio × 3 − lo suyo = el monto de A-101');
    assert.equal(mesDe(r.body, 2023, 1, 'M-2').total_promedio_block, null);
    assert.equal(mesDe(r.body, 2023, 2, 'M-1').total_promedio_block, '60.00', '(50 + 30 + 71.40 + 88.60) ÷ 4');
    assert.ok(!r.texto.includes('71.40') && !r.texto.includes('88.60'));
  });

  it('sin año: los últimos 12 meses con recibo (L-1 tiene 14)', async () => {
    const r = await historial(T.propL);
    assert.equal(r.body.anio, null);
    assert.equal(r.body.meses.length, 12);
    assert.deepEqual([r.body.meses[0].anio, r.body.meses[0].mes], [2024, 3]);
    assert.deepEqual([r.body.meses.at(-1).anio, r.body.meses.at(-1).mes], [2025, 2]);
    assert.deepEqual(r.body.anios, [2025, 2024]);
    const a2025 = await historial(T.propL, '?anio=2025');
    assert.equal(a2025.body.anio, 2025);
    assert.deepEqual(a2025.body.meses.map((m: any) => m.mes), [1, 2]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('GET /api/me/historial: el resumen', () => {
  it('pagado, promedio por mes con pago, deuda, en revisión y puntualidad de 2025', async () => {
    const r = (await historial(T.propH, '?anio=2025')).body.resumen;
    assert.equal(r.pagado, '340.00', 'ene 100 + feb 110 + may 90 + el agua de junio 40');
    assert.equal(r.promedio_mes, '85.00', '340 ÷ los 4 meses en los que pagó algo');
    assert.equal(r.deuda_actual, '235.00', 'marzo 105 + junio 60 + el agua de H-2 70; lo en revisión no es deuda');
    assert.equal(r.en_revision, '80.00');
    assert.equal(r.meses_en_periodo, 6);
    // Evaluados: ene, feb y may (pagados con fecha) + los vencidos mar, jun y H-2 ene. A tiempo: ene (día 0) y may (−5).
    assert.equal(r.meses_evaluados, 6);
    assert.equal(r.meses_a_tiempo, 2);
  });

  it('con el filtro por unidad, las cifras son sólo de esa unidad', async () => {
    const h1 = (await historial(T.propH, `?anio=2025&unidad_id=${H1.id}`)).body.resumen;
    assert.deepEqual([h1.pagado, h1.deuda_actual, h1.meses_evaluados, h1.meses_a_tiempo], ['340.00', '165.00', 5, 2]);
    const h2 = (await historial(T.propH, `?anio=2025&unidad_id=${H2.id}`)).body.resumen;
    assert.deepEqual([h2.pagado, h2.promedio_mes, h2.deuda_actual, h2.meses_evaluados, h2.meses_a_tiempo, h2.agua_promedio_m3], ['0.00', '0.00', '70.00', 1, 0, null]);
  });

  it('la deuda es la de hoy: no cambia con el año elegido', async () => {
    const todo = await historial(T.propL);
    const a2024 = await historial(T.propL, '?anio=2024');
    assert.equal(todo.body.resumen.deuda_actual, '140.00', '14 meses de S/ 10, también los que no se ven');
    assert.equal(a2024.body.resumen.deuda_actual, '140.00');
    assert.equal(a2024.body.resumen.meses_en_periodo, 12);
  });

  it('un año sin recibos devuelve meses vacíos pero la deuda de hoy', async () => {
    const r = (await historial(T.propH, '?anio=2030')).body;
    assert.deepEqual(r.meses, []);
    assert.equal(r.resumen.pagado, '0.00');
    assert.equal(r.resumen.meses_evaluados, 0);
    assert.equal(r.resumen.deuda_actual, '235.00');
  });
});

describe('GET /api/me/historial.xlsx', () => {
  const bajar = async (token: string, q = '') => {
    const r = await fetch(`${base}/api/me/historial.xlsx${q}`, { headers: cabecerasDeSesion(token) });
    return { r, libro: r.status === 200 ? XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' }) : null };
  };

  it('es un libro con las hojas «Resumen» y «Meses» y una fila por mes', async () => {
    const { r, libro } = await bajar(T.propH, '?anio=2025');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /spreadsheetml\.sheet/);
    assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="mi-historial-2025\.xlsx"/);
    assert.deepEqual(libro!.SheetNames, ['Resumen', 'Meses']);
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro!.Sheets.Meses);
    assert.equal(filas.length, 7);
    assert.deepEqual(Object.keys(filas[0]!), ['Mes', 'Unidad', 'Conceptos', 'Total (S/)', 'Pagado (S/)', 'Estado', 'Vence', 'Fecha de pago', 'Días vs vencimiento', 'Agua (m³)']);
    const ene = filas.find((f) => f.Mes === 'Enero de 2025' && f.Unidad === 'H-1')!;
    assert.equal(ene['Conceptos'], 'Agua: S/ 40.00; Limpieza: S/ 60.00');
    assert.deepEqual([ene['Total (S/)'], ene['Pagado (S/)'], ene['Estado'], ene['Fecha de pago'], ene['Días vs vencimiento'], ene['Agua (m³)']], [100, 100, 'Pagado', '10/02/2025', 0, 10]);
    const resumen = Object.fromEntries(XLSX.utils.sheet_to_json<string[]>(libro!.Sheets.Resumen, { header: 1 }).map((f) => [f[0], f[1]]));
    assert.equal(resumen['Deuda de hoy (S/)'], 235);
    assert.equal(resumen['Pagado en el periodo (S/)'], 340);
  });

  it('respeta el filtro de unidad y es 401 sin sesión, 403 para otro rol', async () => {
    const { libro } = await bajar(T.propH, `?anio=2025&unidad_id=${H2.id}`);
    assert.equal(XLSX.utils.sheet_to_json(libro!.Sheets.Meses).length, 1);
    assert.equal((await bajar('')).r.status, 401);
    assert.equal((await bajar(T.adminA)).r.status, 403);
  });
});
