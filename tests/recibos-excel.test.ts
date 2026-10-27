import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { cabecerasDeSesion, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { buscarEstructura, codigoEncajaConDpto, leerCabecera, leerConceptos, normalizarTexto, numeroDeTorre, redondearMonto } from '../src/server/lib/excelRecibos';

/**
 * POST /api/recibos/excel: el comportamiento con el Excel (parseo con SheetJS), el Excel real de la administradora
 * (docs/ejemplos/block-1-octubre.xlsx) y las funciones puras de src/server/lib/excelRecibos.ts.
 */

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let block1Id: number;
let T: Record<'adminA' | 'adminB' | 'prop1', string>;

type Celda = string | number | null;
const aXlsx = (filas: Celda[][], bookType: 'xlsx' | 'xls' = 'xlsx'): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Consolidado');
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
};

/** Tres conceptos (las 3 últimas columnas —TOTAL MANT, DEUDA, TOTAL— no cuentan como concepto). */
const filasValidas = (): Celda[][] => [
  [null, 'GRUPO PRUEBA'],
  [null, null, null, 'MES: Octubre 2026', null, null, 'VENCIMIENTO:', null, '02 DE NOVIEMBRE DE 2026'],
  ['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'ADMINISTRACION', 'LUZ COMUN', 'AGUA DPTO.', 'TOTAL MANT', 'DEUDA ACUMULADA', 'TOTAL'],
  ['B.1', 101, 'PEREZ ANA', 123.69, 8.554566210045662, ' 2.53 ', 134.77, 0, 134.77],
  ['B.1', 102, 'RUIZ LUIS', 123.69, null, 75.5, 199.19, 0, 199.19],
  ['B.1', 103, 'SIN DATOS', 100, 'n/a', '7,5', 107.5, 0, 107.5],
  ['B.1', 999, 'NO EXISTE', 1, 1, 1, 3, 0, 3],
  ['B.9', 101, 'BLOCK INEXISTENTE', 1, 1, 1, 3, 0, 3],
  ['TOTALES', null, null, 347.38, 8.55, 85.53, 0, 0, 0],
];

const subir = async (token: string | null, archivo: Buffer | null, complejoId: number | string | null, nombre = 'recibos.xlsx') => {
  const f = new FormData();
  if (complejoId != null) f.append('complejo_id', String(complejoId));
  if (archivo) f.append('archivo', new Blob([new Uint8Array(archivo)]), nombre);
  const r = await fetch(`${base}/api/recibos/excel`, { method: 'POST', headers: cabecerasDeSesion(token), body: f });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, body, texto };
};

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  // El Excel busca la estructura por nombre dentro del condominio y la unidad por el final de su código.
  // OJO: el cruce quita «.» y «-» y compara por «contiene», así que «B.1» → «B1» sólo encaja con una estructura llamada «B.1»/«B1»;
  // no con «Block 1» (el nombre que siembra seed:libertadores): ver el último test del bloque «lo que crea».
  const block1 = await prisma.estructura.create({ data: { nombre: 'B.1', tipo: 'block', complejo_id: d.complejoA.id } });
  block1Id = block1.id;
  for (const n of [101, 102, 103]) {
    await prisma.unidad.create({ data: { codigo: `B.1-${n}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: block1.id, estado: 'activa' } });
  }
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

// Sólo el recibo de la torre B.1: el recibo sembrado de octubre (sin torre, de otras unidades) ya no lo toca el Excel.
const estadoDelRecibo = async () => {
  const recibos = await prisma.recibo.findMany({ where: { complejo_id: d.complejoA.id, estructura_id: block1Id, mes: 10, anio: 2026 }, include: { reciboConceptos: { orderBy: { orden: 'asc' }, include: { concepto: true } } } });
  const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo: { complejo_id: d.complejoA.id, estructura_id: block1Id, mes: 10, anio: 2026 } } }, include: { unidad: true, reciboConcepto: { include: { concepto: true } } } });
  const monto = (unidad: string, concepto: string) => cargos.find((c) => c.unidad?.codigo === unidad && c.reciboConcepto?.concepto?.nombre === concepto)?.monto.toString();
  return { recibos, cargos, monto };
};

describe('POST /api/recibos/excel: lo que crea', () => {
  it('crea el recibo, los conceptos en orden y los cargos por unidad con sus montos exactos', async () => {
    const r = await subir(T.adminA, aXlsx(filasValidas()), d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual({ ...r.body, recibo_id: undefined, recibos: undefined }, {
      recibo_id: undefined, recibos: undefined, mes: 10, anio: 2026, unidades_procesadas: 3, filas_saltadas: 3, conceptos: 3,
      advertencias: ['B.1 Dpto. 999: no existe la unidad; se saltó la fila', 'B.9 Dpto. 101: el condominio no tiene la torre «B.9»; se saltó la fila'],
    });

    const { recibos, cargos, monto } = await estadoDelRecibo();
    assert.equal(recibos.length, 1);
    const rec = recibos[0];
    assert.equal(rec.id, r.body.recibo_id);
    assert.equal(rec.estado, 'emitido');
    assert.equal(rec.empresa_id, d.empresaA.id);
    assert.equal(rec.creado_por_id, d.adminA.id);
    assert.equal(rec.descripcion, 'Mantenimiento de octubre de 2026 · B.1');
    assert.equal(rec.estructura_id, block1Id);
    assert.equal(rec.fecha_vencimiento.toISOString(), '2026-11-02T00:00:00.000Z');
    assert.equal(rec.fecha_emision.getTime(), hoyLima().getTime());
    assert.deepEqual(rec.reciboConceptos.map((c) => [c.orden, c.concepto?.nombre, c.monto.toString(), c.es_recargo]), [
      [1, 'ADMINISTRACION', '0', false],
      [2, 'LUZ COMUN', '0', false],
      [3, 'AGUA DPTO.', '0', false],
    ]);

    // 3 unidades × 3 conceptos = 9 celdas, 7 cargos: la celda vacía vale 0 y un monto 0.00 no genera cargo; el texto no numérico tampoco; «7,5» se lee como 7.5; cada monto se redondea a 2 decimales.
    assert.equal(cargos.length, 7);
    assert.equal(monto('B.1-101', 'ADMINISTRACION'), '123.69');
    assert.equal(monto('B.1-101', 'LUZ COMUN'), '8.55');
    assert.equal(monto('B.1-101', 'AGUA DPTO.'), '2.53');
    assert.equal(monto('B.1-102', 'ADMINISTRACION'), '123.69');
    assert.equal(monto('B.1-102', 'LUZ COMUN'), undefined);
    assert.equal(monto('B.1-102', 'AGUA DPTO.'), '75.5');
    assert.equal(monto('B.1-103', 'ADMINISTRACION'), '100');
    assert.equal(monto('B.1-103', 'LUZ COMUN'), undefined);
    assert.equal(monto('B.1-103', 'AGUA DPTO.'), '7.5');
    assert.ok(cargos.every((c) => c.estado_pago === 'pendiente'));
  });

  it('es idempotente: subir otra vez el mismo mes actualiza el recibo y no duplica cargos', async () => {
    const filas = filasValidas();
    filas[3][3] = 200;
    const r = await subir(T.adminA, aXlsx(filas), d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    const { recibos, cargos, monto } = await estadoDelRecibo();
    assert.equal(recibos.length, 1);
    assert.equal(cargos.length, 7);
    assert.equal(monto('B.1-101', 'ADMINISTRACION'), '200');
  });

  it('un .xls (formato antiguo) da el mismo resultado', async () => {
    const r = await subir(T.adminA, aXlsx(filasValidas(), 'xls'), d.complejoA.id, 'recibos.xls');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual({ ...r.body, recibo_id: undefined, recibos: undefined, advertencias: undefined }, { recibo_id: undefined, recibos: undefined, advertencias: undefined, mes: 10, anio: 2026, unidades_procesadas: 3, filas_saltadas: 3, conceptos: 3 });
    const { cargos, monto } = await estadoDelRecibo();
    assert.equal(cargos.length, 7);
    assert.equal(monto('B.1-101', 'ADMINISTRACION'), '123.69');
    assert.equal(monto('B.1-102', 'AGUA DPTO.'), '75.5');
  });

  it('con la estructura llamada «Block 1» (como la siembra seed:libertadores) «B.1» del Excel sí cruza: es la torre 1', async () => {
    await prisma.estructura.update({ where: { id: block1Id }, data: { nombre: 'Block 1' } });
    try {
      const r = await subir(T.adminA, aXlsx(filasValidas()), d.complejoA.id);
      assert.equal(r.status, 201, r.texto);
      assert.equal(r.body.unidades_procesadas, 3);
      assert.equal(r.body.filas_saltadas, 3);
    } finally {
      await prisma.estructura.update({ where: { id: block1Id }, data: { nombre: 'B.1' } });
    }
  });

  it('avisa (sin abortar) cuando la suma de los conceptos redondeados difiere de TOTAL MANT en más de S/ 0.05', async () => {
    const filas = filasValidas();
    filas[3][6] = 134.82; // la suma es 134.77: difiere 0.05 → todavía dentro de la tolerancia
    filas[4][6] = 199.3; // la suma es 199.19: difiere 0.11 → advertencia
    const r = await subir(T.adminA, aXlsx(filas), d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.advertencias.filter((a: string) => a.includes('TOTAL MANT')), ['B.1 Dpto. 102: la suma de los conceptos (S/ 199.19) no coincide con TOTAL MANT (S/ 199.30)']);
    assert.equal(r.body.unidades_procesadas, 3);
  });

  it('el mes y el vencimiento pueden venir en celdas separadas, y el vencimiento como fecha de Excel', async () => {
    const filas = filasValidas();
    filas[1] = [null, null, null, 'MES', 'Octubre', null, 'VENCIMIENTO:', null, new Date(2026, 10, 5) as unknown as string];
    filas[0] = [null, 'GRUPO PRUEBA', null, 'MANTENIMIENTO DE OCTUBRE 2026'];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas, { cellDates: true }), 'Consolidado');
    const r = await subir(T.adminA, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer, d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    const { recibos } = await estadoDelRecibo();
    assert.equal(recibos[0].fecha_vencimiento.toISOString(), '2026-11-05T00:00:00.000Z');
  });

  it('sin la línea de vencimiento usa el día 1 del mes siguiente', async () => {
    const filas = filasValidas();
    filas[1][6] = null;
    filas[1][8] = null;
    const r = await subir(T.adminA, aXlsx(filas), d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    const { recibos } = await estadoDelRecibo();
    assert.equal(recibos[0].fecha_vencimiento.toISOString(), '2026-11-01T00:00:00.000Z');
  });
});

describe('POST /api/recibos/excel: el ejemplo real de docs/ejemplos', () => {
  const CONCEPTOS = [
    'ADMINISTRACION VRANY', 'LUZ AREAS COMUNES DEL CONDOMINIO', 'LUZ COMUN DEL BLOCK', 'AGUA COMUN DEL CONDOMINIO', 'AGUA DPTO.',
    'FONDO DE CONTINGENCIA DEL BLOCK', 'FONDO DE CONTINGENCIA DEL CONDOMINIO', 'MANTENIMIENTO DE ASCENSOR', 'MANTENIMIENTO DE CISTERNA', 'OTROS',
    'MULTA PAGO FUERA DE FECHA(ULTIMO DIA 2 CADA MES)',
  ];
  let complejoId: number;
  before(async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Los Libertadores', tipo: 'Condominio', empresa_id: d.empresaA.id } });
    complejoId = c.id;
    // Como seed:libertadores: 14 torres «Block 1»…«Block 14»; la 1 tiene 32 departamentos 101…804 (4 por piso, 8 pisos).
    for (const n of [1, 2, 14]) {
      const e = await prisma.estructura.create({ data: { nombre: `Block ${n}`, tipo: 'block', complejo_id: c.id } });
      if (n !== 1) continue;
      for (let piso = 1; piso <= 8; piso++) {
        for (let k = 1; k <= 4; k++) {
          await prisma.unidad.create({ data: { codigo: `B01-${piso}0${k}`, tipo: 'Departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id: e.id, estado: 'activa' } });
        }
      }
    }
  });

  it('crea el recibo de octubre 2026 con vencimiento 2026-11-02, los 11 conceptos normalizados y sus cargos con montos redondeados', async () => {
    const r = await subir(T.adminA, readFileSync('docs/ejemplos/block-1-octubre.xlsx'), complejoId, 'block-1-octubre.xlsx');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual({ ...r.body, recibo_id: undefined, recibos: undefined }, { recibo_id: undefined, recibos: undefined, mes: 10, anio: 2026, unidades_procesadas: 32, filas_saltadas: 1, conceptos: 11, advertencias: [] });

    const rec = await prisma.recibo.findFirstOrThrow({ where: { complejo_id: complejoId, mes: 10, anio: 2026 }, include: { reciboConceptos: { orderBy: { orden: 'asc' }, include: { concepto: true } } } });
    assert.equal(rec.fecha_vencimiento.toISOString(), '2026-11-02T00:00:00.000Z');
    assert.deepEqual(rec.reciboConceptos.map((c) => c.concepto?.nombre), CONCEPTOS);

    const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo_id: rec.id } }, include: { unidad: true, reciboConcepto: { include: { concepto: true } } } });
    // 32 departamentos × 11 conceptos = 352 celdas; las 66 en S/ 0.00 no generan cargo: quedan 286 y ninguno en cero.
    assert.equal(cargos.length, 286);
    assert.ok(cargos.every((c) => c.monto.gt(0)));
    // El concepto del recibo se conserva aunque todas sus celdas sean 0 (los 11 de arriba).
    assert.equal(rec.reciboConceptos.length, 11);
    const monto = (unidad: string, concepto: string) => cargos.find((c) => c.unidad?.codigo === unidad && c.reciboConcepto?.concepto?.nombre === concepto)?.monto.toString();
    assert.equal(monto('B01-101', 'ADMINISTRACION VRANY'), '123.69');
    assert.equal(monto('B01-101', 'LUZ COMUN DEL BLOCK'), '30.25');
    assert.equal(monto('B01-101', 'AGUA COMUN DEL CONDOMINIO'), '2.53');
    assert.equal(monto('B01-101', 'AGUA DPTO.'), '21.83');
    assert.equal(monto('B01-101', 'LUZ AREAS COMUNES DEL CONDOMINIO'), '8.55');
    assert.equal(monto('B01-101', 'FONDO DE CONTINGENCIA DEL CONDOMINIO'), '3');
    assert.equal(monto('B01-501', 'AGUA DPTO.'), '95.48');
    assert.equal(monto('B01-804', 'AGUA DPTO.'), '70.63');
    assert.equal(monto('B01-804', 'MULTA PAGO FUERA DE FECHA(ULTIMO DIA 2 CADA MES)'), undefined);
    const totalDe = (unidad: string) => cargos.filter((c) => c.unidad?.codigo === unidad).reduce((t, c) => t.plus(c.monto), new Prisma.Decimal(0)).toFixed(2);
    assert.equal(totalDe('B01-101'), '223.35');
    assert.equal(totalDe('B01-501'), '297.00');
    assert.equal(totalDe('B01-804'), '272.15');
  });

  it('un departamento que no existe da advertencia y se salta (las demás filas siguen)', async () => {
    await prisma.unidad.deleteMany({ where: { complejo_id: complejoId, codigo: 'B01-804' } });
    const r = await subir(T.adminA, readFileSync('docs/ejemplos/block-1-octubre.xlsx'), complejoId, 'block-1-octubre.xlsx');
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.unidades_procesadas, 31);
    assert.equal(r.body.filas_saltadas, 2);
    assert.deepEqual(r.body.advertencias, ['B.1 Dpto. 804: no existe la unidad; se saltó la fila']);
  });
});

describe('POST /api/recibos/excel: sin cargos en S/ 0.00', () => {
  const real = () => readFileSync('docs/ejemplos/block-1-octubre.xlsx');
  let complejoId: number;
  let reciboId: number;
  const get = (ruta: string) => llamar(base, 'GET', ruta, T.adminA);
  before(async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Sin ceros', tipo: 'Condominio', empresa_id: d.empresaA.id } });
    complejoId = c.id;
    const e = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: c.id } });
    for (let piso = 1; piso <= 8; piso++) {
      for (let k = 1; k <= 4; k++) await prisma.unidad.create({ data: { codigo: `B01-${piso}0${k}`, tipo: 'Departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id: e.id, estado: 'activa' } });
    }
    const r = await subir(T.adminA, real(), complejoId);
    assert.equal(r.status, 201, r.texto);
    reciboId = r.body.recibo_id;
  });

  it('el recibo conserva los 11 conceptos y ningún cargo vale 0 (ni queda «pendiente» por un cero)', async () => {
    assert.equal(await prisma.reciboConcepto.count({ where: { recibo_id: reciboId } }), 11);
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { reciboConcepto: { recibo_id: reciboId } } }), 286);
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { reciboConcepto: { recibo_id: reciboId }, monto: { lte: 0 } } }), 0);
    const det = await get(`/api/recibos/${reciboId}`);
    assert.equal(det.status, 200);
    assert.equal(det.body.conceptos.length, 11);
    assert.equal(det.body.cargos.length, 286);
  });

  it('el detalle de mantenimiento de una unidad con conceptos en 0 responde bien y su total cuadra con TOTAL MANT', async () => {
    const un = await prisma.unidad.findFirstOrThrow({ where: { complejo_id: complejoId, codigo: 'B01-804' } });
    const r = await get(`/api/recibos/${reciboId}/mantenimientos/${un.id}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.total, '272.15');
    assert.equal(r.body.saldo, '272.15');
    assert.equal(r.body.estado, 'pendiente');
    assert.ok(r.body.conceptos.length > 0 && r.body.conceptos.length < 11, 'se omiten los conceptos en 0');
    assert.ok(!r.body.conceptos.some((c: { concepto: string }) => c.concepto.startsWith('MULTA')));
    assert.ok(r.body.conceptos.every((c: { monto: string }) => Number(c.monto) > 0));
    const suma = r.body.conceptos.reduce((t: Prisma.Decimal, c: { monto: string }) => t.plus(c.monto), new Prisma.Decimal(0));
    assert.equal(suma.toFixed(2), '272.15');
  });

  it('cuando todas las unidades pagan lo que debían, el recibo queda «pagado» y ningún mantenimiento queda pendiente', async () => {
    const unidades = await prisma.unidad.findMany({ where: { complejo_id: complejoId }, select: { id: true } });
    for (const un of unidades) {
      const p = await llamar(base, 'POST', `/api/recibos/${reciboId}/mantenimientos/${un.id}/pagos`, T.adminA, { metodo_pago: 'efectivo' });
      assert.equal(p.status, 201, JSON.stringify(p.body));
    }
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { reciboConcepto: { recibo_id: reciboId }, estado_pago: { not: 'pagado' } } }), 0);
    const det = await get(`/api/recibos/${reciboId}?sin_cargos=1`);
    assert.equal(det.body.estado_cobranza, 'pagado');
    assert.equal(det.body.totales.pendiente, '0.00');
    const lista = await get(`/api/recibos/${reciboId}/mantenimientos?pageSize=100`);
    assert.equal(lista.body.total, 32);
    assert.ok(lista.body.items.every((m: { estado: string }) => m.estado === 'pagado'));
  });
});

describe('POST /api/recibos/excel: recibo repetido con pagos', () => {
  const real = () => readFileSync('docs/ejemplos/block-1-octubre.xlsx');
  let complejoId: number;
  before(async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Repetido', tipo: 'Condominio', empresa_id: d.empresaA.id } });
    complejoId = c.id;
    const e = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: c.id } });
    for (let piso = 1; piso <= 8; piso++) {
      for (let k = 1; k <= 4; k++) await prisma.unidad.create({ data: { codigo: `B01-${piso}0${k}`, tipo: 'Departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id: e.id, estado: 'activa' } });
    }
  });
  const limpiar = async () => {
    const rcs = await prisma.reciboConcepto.findMany({ where: { recibo: { complejo_id: complejoId } }, select: { id: true } });
    const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { recibo_concepto_id: { in: rcs.map((r) => r.id) } }, select: { id: true } });
    await prisma.pago.deleteMany({ where: { recibo_concepto_unidad_id: { in: cargos.map((c) => c.id) } } });
    await prisma.reciboConceptoUnidad.deleteMany({ where: { recibo_concepto_id: { in: rcs.map((r) => r.id) } } });
    await prisma.reciboConcepto.deleteMany({ where: { recibo: { complejo_id: complejoId } } });
    await prisma.recibo.deleteMany({ where: { complejo_id: complejoId } });
  };
  const foto = async () => {
    const recibos = await prisma.recibo.findMany({ where: { complejo_id: complejoId }, orderBy: { id: 'asc' } });
    const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo: { complejo_id: complejoId } } }, orderBy: { id: 'asc' } });
    const pagos = await prisma.pago.findMany({ where: { reciboConceptoUnidad: { reciboConcepto: { recibo: { complejo_id: complejoId } } } }, orderBy: { id: 'asc' } });
    return { recibos, cargos, pagos };
  };
  const MENSAJE = 'El recibo de octubre de 2026 · Block 1 ya tiene pagos registrados; no se puede reemplazar desde Excel';

  it('con un pago registrado en un cargo → 409 y no cambia nada (mismo recibo, mismos cargos, el pago sigue enlazado)', async () => {
    await limpiar();
    const r1 = await subir(T.adminA, real(), complejoId);
    assert.equal(r1.status, 201, r1.texto);
    const antes = await foto();
    const cargo = antes.cargos.find((c) => c.monto.gt(0))!;
    const pago = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo.id, monto: cargo.monto, usuario_id: d.adminA.id, estado_validacion: 'por_validar' } });

    const r2 = await subir(T.adminA, real(), complejoId);
    assert.equal(r2.status, 409, r2.texto);
    assert.deepEqual(r2.body, { error: MENSAJE });

    const despues = await foto();
    assert.deepEqual(despues.recibos, antes.recibos);
    assert.deepEqual(despues.cargos.map((c) => c.id), antes.cargos.map((c) => c.id));
    assert.deepEqual(despues.pagos.map((p) => [p.id, p.recibo_concepto_unidad_id]), [[pago.id, cargo.id]]);
  });

  it('un cargo con estado_pago «pagado» sin fila de Pago también da 409', async () => {
    await limpiar();
    assert.equal((await subir(T.adminA, real(), complejoId)).status, 201);
    const antes = await foto();
    await prisma.reciboConceptoUnidad.update({ where: { id: antes.cargos[0].id }, data: { estado_pago: 'pagado' } });
    const r = await subir(T.adminA, real(), complejoId);
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.error, MENSAJE);
    const despues = await foto();
    assert.deepEqual(despues.cargos.map((c) => c.id), antes.cargos.map((c) => c.id));
  });

  it('sin pagos se reemplaza como siempre: 201, un solo recibo y cargos nuevos', async () => {
    await limpiar();
    assert.equal((await subir(T.adminA, real(), complejoId)).status, 201);
    const antes = await foto();
    const r = await subir(T.adminA, real(), complejoId);
    assert.equal(r.status, 201, r.texto);
    const despues = await foto();
    assert.equal(despues.recibos.length, 1);
    assert.equal(despues.recibos[0].id, antes.recibos[0].id);
    assert.equal(despues.cargos.length, 286);
    const viejos = new Set(antes.cargos.map((c) => c.id));
    assert.ok(despues.cargos.every((c) => !viejos.has(c.id)));
  });
});

describe('POST /api/recibos/excel: entradas inválidas', () => {
  it('sin archivo → 422', async () => {
    const r = await subir(T.adminA, null, d.complejoA.id);
    assert.equal(r.status, 422, r.texto);
    assert.equal(r.body.error, 'Datos inválidos: archivo es obligatorio');
    assert.deepEqual(r.body.campos, { archivo: 'Obligatorio' });
  });

  it('sin complejo_id → 422', async () => {
    const r = await subir(T.adminA, aXlsx(filasValidas()), null);
    assert.equal(r.status, 422, r.texto);
    assert.deepEqual(r.body.campos, { complejo_id: 'Obligatorio' });
  });

  it('un complejo de otra empresa → 422 «no existe o no tienes acceso» (assertRef; no es 404) y no crea nada', async () => {
    const r = await subir(T.adminA, aXlsx(filasValidas()), d.complejoB.id);
    assert.equal(r.status, 422, r.texto);
    assert.deepEqual(r.body.campos, { complejo_id: 'No existe o no tienes acceso' });
    assert.equal(await prisma.recibo.count({ where: { complejo_id: d.complejoB.id, mes: 10, anio: 2026 } }), 0);
  });

  it('un residente → 403', async () => {
    const r = await subir(T.prop1, aXlsx(filasValidas()), d.complejoA.id);
    assert.equal(r.status, 403, r.texto);
  });

  it('un residente que sube un archivo de más de 10 MB recibe 403 (el rol se revisa antes que multer), no 413', async () => {
    const r = await subir(T.prop1, Buffer.alloc(11 * 1024 * 1024, 1), d.complejoA.id);
    assert.equal(r.status, 403, r.texto);
  });

  it('un admin que sube un archivo de más de 10 MB sí recibe el límite de multer (4xx de tamaño)', async () => {
    const r = await subir(T.adminA, Buffer.alloc(11 * 1024 * 1024, 1), d.complejoA.id);
    assert.equal(r.status, 422, r.texto);
    assert.equal(r.body.error, 'El archivo pesa más de 10 MB');
  });

  it('sin sesión → 401', async () => {
    const r = await subir(null, aXlsx(filasValidas()), d.complejoA.id);
    assert.equal(r.status, 401, r.texto);
  });

  it('texto que no es Excel → 422 en español, sin 500 ni stack', async () => {
    const r = await subir(T.adminA, Buffer.from('esto no es un excel, solo texto basura\nlinea 2'), d.complejoA.id, 'basura.xlsx');
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.error, /Excel/);
    assert.doesNotMatch(r.texto, /at .*\.(ts|js):\d+/);
  });

  it('bytes aleatorios → error 4xx controlado, sin 500 ni stack', async () => {
    const bytes = Buffer.alloc(4096);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 17) & 0xff;
    const r = await subir(T.adminA, bytes, d.complejoA.id, 'basura.xlsx');
    assert.ok(r.status >= 400 && r.status < 500, `${r.status} ${r.texto}`);
    assert.equal(typeof r.body?.error, 'string');
    assert.doesNotMatch(r.texto, /at .*\.(ts|js):\d+/);
  });

  it('un ZIP cortado (xlsx corrupto) → 422 en español, no 500 (SheetJS lanza «Unsupported ZIP file»)', async () => {
    const real = aXlsx(filasValidas());
    const r = await subir(T.adminA, real.subarray(0, Math.floor(real.length / 2)), d.complejoA.id);
    assert.equal(r.status, 422, r.texto);
    assert.equal(r.body.error, 'El archivo no es un Excel válido (.xlsx o .xls)');
    assert.deepEqual(r.body.campos, { archivo: 'Archivo inválido' });
  });

  it('un Excel sin la fila BLOCK → 422', async () => {
    const filas = filasValidas();
    filas[2][0] = 'BLOQUE';
    const r = await subir(T.adminA, aXlsx(filas), d.complejoA.id);
    assert.equal(r.status, 422, r.texto);
    assert.equal(r.body.error, 'No se encontró la fila de encabezado (BLOCK)');
  });
});

describe('excelRecibos: funciones puras', () => {
  it('numeroDeTorre: «B.1», «B1», «B-1», «BLOCK 1», «Block 1», «TORRE 1», «T1», «1» y el número 1 son la torre 1', () => {
    for (const v of ['B.1', 'B1', 'B-1', 'BLOCK 1', 'Block 1', 'TORRE 1', 'T1', '1', 1, ' b.1 ', 'Block\n1']) assert.equal(numeroDeTorre(v), 1, String(v));
    assert.equal(numeroDeTorre('Block 14'), 14);
    assert.equal(numeroDeTorre('B.14'), 14);
    assert.equal(numeroDeTorre('B01'), 1);
  });

  it('numeroDeTorre: lo que no es una torre da null', () => {
    for (const v of ['TOTALES', '', null, 'Piso 1', 'Estacionamiento', 'B.1A']) assert.equal(numeroDeTorre(v), null, String(v));
  });

  it('buscarEstructura: sólo si hay UNA con ese número', () => {
    const e = [{ nombre: 'Block 1' }, { nombre: 'Block 2' }, { nombre: 'Jardín' }, { nombre: 'T2' }];
    assert.equal(buscarEstructura(e, 1).estructura?.nombre, 'Block 1');
    assert.equal(buscarEstructura(e, 2).motivo, 'varias');
    assert.equal(buscarEstructura(e, 9).motivo, 'ninguna');
  });

  it('codigoEncajaConDpto compara el último tramo del código, no el sufijo («B.1-1101» no es el 101)', () => {
    assert.equal(codigoEncajaConDpto('B.1-101', '101'), true);
    assert.equal(codigoEncajaConDpto('B01-0101', '101'), true);
    assert.equal(codigoEncajaConDpto('101', '101'), true);
    assert.equal(codigoEncajaConDpto('B.1-1101', '101'), false);
    assert.equal(codigoEncajaConDpto(null, '101'), false);
  });

  it('redondearMonto: 2 decimales, half-up, como string', () => {
    assert.equal(redondearMonto(8.554566210045662), '8.55');
    assert.equal(redondearMonto(30.246875), '30.25');
    assert.equal(redondearMonto(1.005), '1.01');
    assert.equal(redondearMonto(2.5315068493150683), '2.53');
    assert.equal(redondearMonto(0), '0.00');
    assert.equal(redondearMonto(123.69), '123.69');
  });

  it('normalizarTexto colapsa espacios y saltos de línea', () => {
    assert.equal(normalizarTexto('FONDO DE \nCONTINGENCIA   DEL CONDOMINIO '), 'FONDO DE CONTINGENCIA DEL CONDOMINIO');
  });

  describe('leerCabecera', () => {
    it('«MES: Octubre 2026» en una celda', () => {
      assert.deepEqual(leerCabecera([[null, null, 'MES: Octubre 2026']]), { mes: 10, anio: 2026, vencimiento: null });
    });
    it('«MES;Octubre» y el año del título «… DE OCTUBRE 2026»', () => {
      const c = leerCabecera([['', 'GRUPO', '', 'MANTENIMIENTO DE OCTUBRE 2026'], ['', '', 'MES;Octubre']]);
      assert.deepEqual(c, { mes: 10, anio: 2026, vencimiento: null });
    });
    it('«MES» con el mes en la SIGUIENTE celda no vacía', () => {
      const c = leerCabecera([['', 'GRUPO VRANY', '', 'MANTENIMIENTO DE OCTUBRE 2026'], ['', '', '', 'MES', '', '', 'Octubre', '', 'VENCIMIENTO:', '', '02 DE NOVIEMBRE DE 2026']]);
      assert.deepEqual(c, { mes: 10, anio: 2026, vencimiento: new Date(Date.UTC(2026, 10, 2)) });
    });
    it('«MES ⏎ Octubre» en una sola celda', () => {
      assert.equal(leerCabecera([['MES\nOctubre', '', '']]).mes, 10);
    });
    it('sin año en el título, el año sale del vencimiento', () => {
      const c = leerCabecera([['', '', 'MES', 'Diciembre', 'VENCIMIENTO:', '', '05 DE ENERO DE 2027']]);
      assert.deepEqual(c, { mes: 12, anio: 2027, vencimiento: new Date(Date.UTC(2027, 0, 5)) });
    });
    it('el vencimiento puede ser una fecha de Excel (la siguiente celda no vacía)', () => {
      const c = leerCabecera([['MES', 'Octubre 2026', 'VENCIMIENTO:', '', new Date(2026, 10, 2)]]);
      assert.equal(c.vencimiento?.toISOString(), '2026-11-02T00:00:00.000Z');
    });
    it('sin mes → null', () => {
      assert.deepEqual(leerCabecera([['GRUPO', 'MESA DIRECTIVA'], ['', '2026']]), { mes: null, anio: null, vencimiento: null });
    });
  });

  describe('leerConceptos', () => {
    const nombres = ['ADMINISTRACION VRANY ', 'LUZ AREAS COMUNES', 'FONDO DE \nCONTINGENCIA', 'TOTAL MANT', 'DEUDA ACUMULADA', 'TOTAL'];
    it('encabezado en dos filas: los nombres están en la fila siguiente a «BLOCK / Dpto.»', () => {
      const datos = [['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'Conceptos por cobrar', '', ''], ['', '', '', ...nombres], ['B.1', 101, 'X', 1, 2, 3, 6, 0, 6]];
      const c = leerConceptos(datos, 0);
      assert.equal(c.primeraFilaDatos, 2);
      assert.deepEqual(c.conceptos, [{ indice: 3, nombre: 'ADMINISTRACION VRANY' }, { indice: 4, nombre: 'LUZ AREAS COMUNES' }, { indice: 5, nombre: 'FONDO DE CONTINGENCIA' }]);
      assert.equal(c.columnaTotalMant, 6);
    });
    it('encabezado en una fila: los nombres están en la misma fila que BLOCK / Dpto.', () => {
      const datos = [['BLOCK', 'Dpto.', 'Apellidos y Nombres', ...nombres], ['B.1', 101, 'X', 1, 2, 3, 6, 0, 6]];
      const c = leerConceptos(datos, 0);
      assert.equal(c.primeraFilaDatos, 1);
      assert.equal(c.conceptos.length, 3);
    });
    it('TOTAL MANT, DEUDA ACUMULADA y TOTAL no son conceptos aunque vengan con otras mayúsculas o espacios', () => {
      const c = leerConceptos([['BLOCK', 'Dpto.', 'Nombre', 'OTROS', ' total  mant ', 'Deuda\nAcumulada', 'Total']], 0);
      assert.deepEqual(c.conceptos.map((x) => x.nombre), ['OTROS']);
    });
    it('un nombre repetido se usa una sola vez', () => {
      const c = leerConceptos([['BLOCK', 'Dpto.', 'Nombre', 'OTROS', 'OTROS ']], 0);
      assert.equal(c.conceptos.length, 1);
      assert.deepEqual(c.duplicados, ['OTROS']);
    });
  });
});

describe('POST /api/recibos/excel: condominio sin torres', () => {
  it('busca la unidad sólo por el número de departamento', async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Sin torres', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    for (const n of [101, 102]) await prisma.unidad.create({ data: { codigo: `D-${n}`, tipo: 'Departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estado: 'activa' } });
    const filas = filasValidas().slice(0, 5); // B.1 101, B.1 102
    filas[3][1] = '101'; // el departamento también puede venir como texto
    const r = await subir(T.adminA, aXlsx(filas), c.id);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.unidades_procesadas, 2);
    assert.deepEqual(r.body.advertencias, []);
  });
});
