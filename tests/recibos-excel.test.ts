import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import XLSX from 'xlsx';
import { cabecerasDeSesion, iniciar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';

/**
 * Caracterización de POST /api/recibos/excel: fija lo que hace HOY con el Excel (parseo con SheetJS) para
 * poder cambiar la versión de `xlsx` sin que cambie el comportamiento.
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

const estadoDelRecibo = async () => {
  const recibos = await prisma.recibo.findMany({ where: { complejo_id: d.complejoA.id, mes: 10, anio: 2026 }, include: { reciboConceptos: { orderBy: { orden: 'asc' }, include: { concepto: true } } } });
  const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo: { complejo_id: d.complejoA.id, mes: 10, anio: 2026 } } }, include: { unidad: true, reciboConcepto: { include: { concepto: true } } } });
  const monto = (unidad: string, concepto: string) => cargos.find((c) => c.unidad?.codigo === unidad && c.reciboConcepto?.concepto?.nombre === concepto)?.monto.toString();
  return { recibos, cargos, monto };
};

describe('POST /api/recibos/excel: lo que crea', () => {
  it('crea el recibo, los conceptos en orden y los cargos por unidad con sus montos exactos', async () => {
    const r = await subir(T.adminA, aXlsx(filasValidas()), d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual({ ...r.body, recibo_id: undefined }, { recibo_id: undefined, mes: 10, anio: 2026, unidades_procesadas: 3, filas_saltadas: 3, conceptos: 3 });

    const { recibos, cargos, monto } = await estadoDelRecibo();
    assert.equal(recibos.length, 1);
    const rec = recibos[0];
    assert.equal(rec.id, r.body.recibo_id);
    assert.equal(rec.estado, 'emitido');
    assert.equal(rec.empresa_id, d.empresaA.id);
    assert.equal(rec.creado_por_id, d.adminA.id);
    assert.equal(rec.descripcion, 'Mantenimiento de 10 de 2026');
    assert.equal(rec.fecha_vencimiento.toISOString(), '2026-11-02T00:00:00.000Z');
    assert.equal(rec.fecha_emision.getTime(), hoyLima().getTime());
    assert.deepEqual(rec.reciboConceptos.map((c) => [c.orden, c.concepto?.nombre, c.monto.toString(), c.es_recargo]), [
      [1, 'ADMINISTRACION', '0', false],
      [2, 'LUZ COMUN', '0', false],
      [3, 'AGUA DPTO.', '0', false],
    ]);

    // 3 unidades × 3 conceptos = 9 cargos: la celda vacía cuenta como 0; el texto no numérico no genera cargo; «7,5» se lee como 7.5.
    assert.equal(cargos.length, 8);
    assert.equal(monto('B.1-101', 'ADMINISTRACION'), '123.69');
    assert.equal(monto('B.1-101', 'LUZ COMUN'), '8.554566210045662');
    assert.equal(monto('B.1-101', 'AGUA DPTO.'), '2.53');
    assert.equal(monto('B.1-102', 'ADMINISTRACION'), '123.69');
    assert.equal(monto('B.1-102', 'LUZ COMUN'), '0');
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
    assert.equal(cargos.length, 8);
    assert.equal(monto('B.1-101', 'ADMINISTRACION'), '200');
  });

  it('un .xls (formato antiguo) da el mismo resultado', async () => {
    const r = await subir(T.adminA, aXlsx(filasValidas(), 'xls'), d.complejoA.id, 'recibos.xls');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual({ ...r.body, recibo_id: undefined }, { recibo_id: undefined, mes: 10, anio: 2026, unidades_procesadas: 3, filas_saltadas: 3, conceptos: 3 });
    const { cargos, monto } = await estadoDelRecibo();
    assert.equal(cargos.length, 8);
    assert.equal(monto('B.1-101', 'ADMINISTRACION'), '123.69');
    assert.equal(monto('B.1-102', 'AGUA DPTO.'), '75.5');
  });

  it('con la estructura llamada «Block 1» (como la siembra seed:libertadores) NO cruza con «B.1»: todas las filas se saltan', async () => {
    await prisma.estructura.update({ where: { id: block1Id }, data: { nombre: 'Block 1' } });
    try {
      const r = await subir(T.adminA, aXlsx(filasValidas()), d.complejoA.id);
      assert.equal(r.status, 201, r.texto);
      assert.equal(r.body.unidades_procesadas, 0);
      assert.equal(r.body.filas_saltadas, 6);
    } finally {
      await prisma.estructura.update({ where: { id: block1Id }, data: { nombre: 'B.1' } });
    }
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
  it('hoy se rechaza con 422: su fila «MES ⏎ Octubre» (sin «:» ni «;») no la reconoce el parseo', async () => {
    const r = await subir(T.adminA, readFileSync('docs/ejemplos/block-1-octubre.xlsx'), d.complejoA.id, 'block-1-octubre.xlsx');
    assert.equal(r.status, 422, r.texto);
    assert.equal(r.body.error, 'No se encontró el mes y año en el Excel');
    assert.deepEqual(r.body.campos, { archivo: 'Formato inválido' });
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
