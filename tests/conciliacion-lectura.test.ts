// Lectura de extractos bancarios: encabezados por sinónimos, fechas y montos como los exportan los bancos, un extracto sintético por banco (más uno raro) y el
// cruce PURO (`emparejar`). Sin base de datos. Todo es inventado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { emparejar, type PagoParaCruce } from '../src/server/services/conciliacion/cruce';
import { huellasDe } from '../src/server/services/conciliacion/importar';
import { leerAbonos, leerCsv, leerExtracto, leerTabla, normalizarOperacion, parsearFecha, parsearMonto, reconocerEncabezados, textoOperacion, MAX_FILAS_EXTRACTO } from '../src/server/services/conciliacion/lectura';

const DIR = path.join(import.meta.dirname, 'fixtures', 'conciliacion');
const abrir = (nombre: string) => fs.readFileSync(path.join(DIR, nombre));
const D = (v: string | number) => new Prisma.Decimal(v);
const dia = (d: Date | null) => d?.toISOString().slice(0, 10);

/** Los abonos que traen TODOS los fixtures (los cargos de la luz y la comisión no entran). */
const ESPERADOS = [
  ['2026-10-05', '150', '100234', 'TRANSF DE DEMO UNO'],
  ['2026-10-06', '150', '100235', 'TRANSF DE DEMO DOS'],
  ['2026-10-07', '1234.56', '100301', 'DEPOSITO VENTANILLA DEMO'],
  ['2026-10-09', '3', null, 'INTERESES GANADOS'],
  ['2026-10-12', '150', '100410', 'TRANSF DE DEMO TRES'],
] as const;

describe('montos', () => {
  const ok = (v: unknown, esperado: string) => assert.equal(parsearMonto(v as never)?.toFixed(2), esperado, String(v));
  it('formatos de los bancos peruanos', () => {
    ok('1,234.56', '1234.56');
    ok('1.234,56', '1234.56');
    ok('S/ 1,234.56', '1234.56');
    ok('S/. 1 234.56', '1234.56');
    ok('USD 1,234.56', '1234.56');
    ok('1234,5', '1234.50');
    ok('1234.5', '1234.50');
    ok('1,234', '1234.00');
    ok('1.234', '1234.00');
    ok('1.234.567,89', '1234567.89');
    ok('1,234,567.89', '1234567.89');
    ok('150', '150.00');
    ok('S/\u00a01,234.56', '1234.56'); // espacio duro, como lo exportan algunos bancos
    ok(150, '150.00');
    ok(1234.56, '1234.56');
  });
  it('negativos con «-», paréntesis, signo al final o menos tipográfico', () => {
    ok('-80.00', '-80.00');
    ok('(80.00)', '-80.00');
    ok('80.00-', '-80.00');
    ok('−80.00', '-80.00');
    ok('S/ -1,234.50', '-1234.50');
    ok('(S/ 1,234.50)', '-1234.50');
    ok(-80, '-80.00');
  });
  it('lo que no es un monto da null (también con más de 2 decimales)', () => {
    for (const v of ['', '   ', '-', 'abc', '1,2,3,4x', '12.345,6789', null, undefined, true]) assert.equal(parsearMonto(v as never), null, String(v));
  });
});

describe('fechas', () => {
  const ok = (v: unknown, esperado: string) => assert.equal(dia(parsearFecha(v as never)), esperado, String(v));
  it('dd/mm/aaaa, dd-mm-aa, dd.mm.aaaa y aaaa-mm-dd (con hora o sin ella)', () => {
    ok('05/10/2026', '2026-10-05');
    ok('5/1/2026', '2026-01-05');
    ok('05-10-26', '2026-10-05');
    ok('05.10.2026', '2026-10-05');
    ok('2026-10-05', '2026-10-05');
    ok('2026/10/05', '2026-10-05');
    ok('05/10/2026 10:32', '2026-10-05');
    ok('05/10/2026 10:32:11', '2026-10-05');
    ok('31/12/99', '1999-12-31');
  });
  it('serial de Excel (número o texto)', () => {
    ok(46_300, '2026-10-05'); // 46300 = 2026-10-05
    ok('46300', '2026-10-05');
    ok(46_300.75, '2026-10-05');
  });
  it('fechas imposibles o que no son fechas dan null', () => {
    for (const v of ['31/02/2026', '32/01/2026', '05/13/2026', 'ayer', '', null, 12, 150.5, 'Total', true]) assert.equal(parsearFecha(v as never), null, String(v));
  });
});

describe('número de operación', () => {
  it('se muestra sin ceros sobrantes ni vacíos y se compara normalizado', () => {
    assert.equal(textoOperacion('  100234 '), '100234');
    assert.equal(textoOperacion(100234), '100234');
    assert.equal(textoOperacion('0000'), null);
    assert.equal(textoOperacion(''), null);
    assert.equal(normalizarOperacion('000123'), '123');
    assert.equal(normalizarOperacion('N° 0001-234'), '1234');
    assert.equal(normalizarOperacion('OP-100234'), normalizarOperacion('100234'));
    assert.equal(normalizarOperacion('AB12'), 'AB12', 'con menos de 4 dígitos se conservan las letras');
    assert.equal(normalizarOperacion('op-100234'), normalizarOperacion('OP 100234'));
    assert.equal(normalizarOperacion('---'), null);
  });
});

describe('detección de encabezados', () => {
  it('sinónimos de cada banco', () => {
    assert.deepEqual(reconocerEncabezados(['Fecha', 'Fecha valuta', 'Descripción operación', 'Monto', 'Saldo', 'Sucursal - agencia', 'Operación - Número']), { fecha: 0, descripcion: 2, abono: 3, cargo: null, operacion: 6 });
    assert.deepEqual(reconocerEncabezados(['Fecha', 'Fecha de proceso', 'Nro. de operación', 'Movimiento', 'Descripción', 'Canal', 'Cargo', 'Abono', 'Saldo contable']), { fecha: 0, descripcion: 4, abono: 7, cargo: 6, operacion: 2 });
    assert.deepEqual(reconocerEncabezados(['F. Operación', 'F. Valor', 'Código', 'N° Doc.', 'Concepto', 'Importe', 'Oficina']), { fecha: 0, descripcion: 4, abono: 5, cargo: null, operacion: 3 });
    assert.deepEqual(reconocerEncabezados(['Fecha Operación', 'Fecha Valor', 'Glosa', 'Nro. Operación', 'Cargos', 'Abonos', 'Saldo']), { fecha: 0, descripcion: 2, abono: 5, cargo: 4, operacion: 3 });
  });
  it('«fecha operación» gana a «fecha valor», aunque venga después; ingresos/créditos/depósitos valen como abono', () => {
    assert.equal(reconocerEncabezados(['Fecha valor', 'Fecha operación', 'Detalle', 'Ingresos'])?.fecha, 1);
    assert.equal(reconocerEncabezados(['Fecha', 'Concepto', 'Crédito', 'Débito'])?.abono, 2);
    assert.equal(reconocerEncabezados(['Fecha', 'Detalle', 'Depósitos', 'Retiros'])?.abono, 2);
  });
  it('un encabezado con más texto se reconoce por lo que contiene', () => {
    assert.deepEqual(reconocerEncabezados(['Fecha de la transacción', 'Descripción del movimiento', 'Monto en soles']), { fecha: 0, descripcion: 1, abono: 2, cargo: null, operacion: null });
  });
  it('sin fecha o sin monto no es un encabezado', () => {
    assert.equal(reconocerEncabezados(['Cuenta', 'Titular', 'Saldo']), null);
    assert.equal(reconocerEncabezados(['Fecha', 'Descripción']), null);
    assert.equal(reconocerEncabezados([]), null);
  });
  it('salta las líneas de título de arriba y los totales del final', () => {
    const r = leerAbonos([['Estado de cuenta'], ['Cuenta 000-1'], [], ['Fecha', 'Descripción', 'Abono'], ['05/10/2026', 'UNO', '10.00'], ['TOTAL', '', '10.00']]);
    assert.equal(r.abonos.length, 1);
    assert.equal(r.descartes.sin_fecha, 1);
  });
});

describe('un extracto sintético por banco', () => {
  const casos: [string, string][] = [['BCP', 'bcp.xlsx'], ['Interbank', 'interbank.csv'], ['BBVA', 'bbva.xls'], ['Scotiabank', 'scotiabank.xlsx'], ['BanBif', 'banbif.csv']];
  for (const [banco, archivo] of casos) {
    it(`${banco} (${archivo}): reconoce solo las columnas y se queda con los abonos`, () => {
      const r = leerExtracto(abrir(archivo), archivo);
      assert.equal(r.reconocido, true);
      assert.equal(r.abonos.length, ESPERADOS.length);
      r.abonos.forEach((a, i) => {
        const [fecha, monto, op, desc] = ESPERADOS[i]!;
        assert.equal(dia(a.fecha), fecha);
        assert.equal(a.monto.toFixed(2), D(monto).toFixed(2));
        assert.equal(a.operacion, op);
        assert.equal(a.descripcion.normalize('NFD').replace(/[̀-ͯ]/g, ''), desc);
      });
      assert.equal(r.descartes.cargos, 2, 'la luz y la comisión son cargos y no entran');
      assert.ok(r.encabezados.length > 0);
    });
  }
  it('BanBif en Latin-1 conserva las tildes', () => {
    assert.ok(leerExtracto(abrir('banbif.csv'), 'banbif.csv').abonos.some((a) => a.descripcion.includes('DEPÓSITO')));
  });
  it('el extracto «raro» no se reconoce: devuelve las primeras filas para elegir columnas', () => {
    const r = leerExtracto(abrir('raro.xlsx'), 'raro.xlsx');
    assert.equal(r.reconocido, false);
    assert.equal(r.abonos.length, 0);
    assert.deepEqual(r.vista[0], ['Cuándo', 'Qué pasó', 'Plata que entró', 'Plata que salió', 'Clave']);
    assert.ok(r.vista.length >= 5);
  });
  it('con el mapeo elegido a mano, el extracto raro (fechas ISO, serial y texto) se lee igual que los demás', () => {
    const r = leerExtracto(abrir('raro.xlsx'), 'raro.xlsx', { mapeo: { fecha: 0, descripcion: 1, abono: 2, cargo: 3, operacion: 4, fila_inicio: 1 } });
    assert.equal(r.abonos.length, ESPERADOS.length);
    assert.deepEqual(r.abonos.map((a) => [dia(a.fecha), a.monto.toFixed(2), a.operacion]), ESPERADOS.map(([f, m, o]) => [f, D(m).toFixed(2), o]));
  });
  it('un mapeo guardado se usa sólo cuando no se reconoce nada', () => {
    const guardado = { fecha: 0, descripcion: 1, abono: 2, cargo: 3, operacion: 4, fila_inicio: 1 };
    assert.equal(leerExtracto(abrir('raro.xlsx'), 'raro.xlsx', { guardado }).abonos.length, ESPERADOS.length);
    // En un extracto conocido, el guardado (de otro banco) no estorba: manda la detección.
    assert.equal(leerExtracto(abrir('bcp.xlsx'), 'bcp.xlsx', { guardado }).abonos.length, ESPERADOS.length);
  });
  it('un mapeo con columnas fuera de rango no sirve', () => {
    assert.equal(leerExtracto(abrir('raro.xlsx'), 'raro.xlsx', { mapeo: { fecha: 0, descripcion: 1, abono: 99, cargo: null, operacion: null, fila_inicio: 1 } }).reconocido, false);
  });
});

describe('archivos inválidos y topes', () => {
  it('vacío o que no es un extracto: 422', () => {
    assert.throws(() => leerTabla(Buffer.alloc(0), 'a.xlsx'), /vacío/);
    assert.throws(() => leerTabla(Buffer.from([0, 1, 2, 3, 250, 251, 0, 9]), 'a.xlsx'), /no es un Excel ni un CSV válido/);
    assert.throws(() => leerTabla(Buffer.from([0, 1, 2, 3, 250, 251, 0, 9]), 'a.csv'), /no es un Excel ni un CSV válido/);
  });
  it('un «.xls» que en realidad es una tabla HTML o un CSV (como exportan algunos bancos) se lee', () => {
    const html = '<html><body><table><tr><td>Fecha</td><td>Descripción</td><td>Abono</td></tr><tr><td>05/10/2026</td><td>UNO</td><td>10.00</td></tr></table></body></html>';
    assert.equal(leerExtracto(Buffer.from(html), 'movimientos.xls').abonos.length, 1);
    assert.equal(leerExtracto(Buffer.from('Fecha;Descripción;Abono\n05/10/2026;UNO;10,00'), 'movimientos.xls').abonos.length, 1);
  });
  it('más de 5000 filas: 422', () => {
    const filas = ['Fecha,Abono', ...Array.from({ length: MAX_FILAS_EXTRACTO + 100 }, () => '05/10/2026,10.00')].join('\n');
    assert.throws(() => leerTabla(Buffer.from(filas), 'a.csv'), /más de 5000 filas/);
  });
  it('justo en el tope se lee', () => {
    const filas = ['Fecha,Abono', ...Array.from({ length: MAX_FILAS_EXTRACTO }, () => '05/10/2026,10.00')].join('\n');
    assert.equal(leerExtracto(Buffer.from(filas), 'a.csv').abonos.length, MAX_FILAS_EXTRACTO);
  });
  it('un CSV con BOM (UTF-8 de Excel) se lee igual', () => {
    assert.equal(leerExtracto(Buffer.from('\ufeffFecha;Descripción;Abono\n05/10/2026;UNO;10,00'), 'a.csv').abonos.length, 1);
  });
  it('un CSV con comillas, separador «;» o tabulador se parte bien', () => {
    assert.deepEqual(leerCsv('a;b;"c;d"\n1;2;3', 100), [['a', 'b', 'c;d'], ['1', '2', '3']]);
    assert.deepEqual(leerCsv('a\tb\n1\t"2\n3"', 100), [['a', 'b'], ['1', '2\n3']]);
    assert.deepEqual(leerCsv('"di ""hola""",x', 100), [['di "hola"', 'x']]);
  });
});

describe('huella para no duplicar', () => {
  const a = (extra: Partial<{ fecha: Date; monto: Prisma.Decimal; descripcion: string; operacion: string | null }> = {}) => ({ fecha: new Date('2026-10-05T00:00:00Z'), monto: D(150), descripcion: 'TRANSF UNO', operacion: '100234', ...extra });
  it('es estable: el mismo extracto da las mismas huellas', () => assert.deepEqual(huellasDe(1, [a(), a({ monto: D(80) })]), huellasDe(1, [a(), a({ monto: D(80) })])));
  it('cambia con la cuenta, la fecha, el monto, la operación o la descripción', () => {
    const base = huellasDe(1, [a()])[0];
    assert.notEqual(huellasDe(2, [a()])[0], base);
    assert.notEqual(huellasDe(1, [a({ fecha: new Date('2026-10-06T00:00:00Z') })])[0], base);
    assert.notEqual(huellasDe(1, [a({ monto: D('150.01') })])[0], base);
    assert.notEqual(huellasDe(1, [a({ operacion: '100235' })])[0], base);
    assert.notEqual(huellasDe(1, [a({ descripcion: 'TRANSF DOS' })])[0], base);
  });
  it('mayúsculas, tildes y ceros a la izquierda no la cambian', () => {
    assert.equal(huellasDe(1, [a({ descripcion: 'transf  uno', operacion: '0100234' })])[0], huellasDe(1, [a()])[0]);
  });
  it('dos abonos idénticos el mismo día son dos huellas distintas', () => {
    const [x, y] = huellasDe(1, [a({ operacion: null }), a({ operacion: null })]);
    assert.notEqual(x, y);
  });
});

describe('cruce (puro)', () => {
  const DIA = 86_400_000;
  const T = Date.parse('2026-10-05T00:00:00Z');
  const pago = (id: number, total: string | number, dias = 0, operaciones: string[] = []): PagoParaCruce => ({ id, dia: T + dias * DIA, total: D(total), operaciones });
  const mov = (id: number, monto: string | number, dias = 0, operacion: string | null = null) => ({ id, dia: T + dias * DIA, monto: D(monto), operacion });
  const una = (movs: ReturnType<typeof mov>[], pagos: PagoParaCruce[], ventana = 3) => emparejar(movs, pagos, ventana);

  it('un solo candidato → conciliado', () => assert.deepEqual(una([mov(1, 150)], [pago(10, 150, 1)])[0], { movimientoId: 1, estado: 'conciliado', pagoId: 10, candidatos: [] }));
  it('varios candidatos → por revisar, el más cercano primero', () => {
    const [d] = una([mov(1, 150)], [pago(10, 150, 3), pago(11, 150, 0), pago(12, 150, -1)]);
    assert.equal(d!.estado, 'por_revisar');
    assert.deepEqual(d!.candidatos, [11, 12, 10]);
  });
  it('ninguno → sin pago', () => assert.equal(una([mov(1, 150)], [pago(10, 80)])[0]!.estado, 'sin_pago'));
  it('el monto se compara al centavo', () => assert.equal(una([mov(1, '150.00')], [pago(10, '150.01')])[0]!.estado, 'sin_pago'));
  it('el monto de un grupo es su total', () => assert.equal(una([mov(1, 300)], [pago(10, 300)])[0]!.estado, 'conciliado'));
  it('la ventana: ±3 días entran, 4 no; con ventana 0 sólo el mismo día', () => {
    assert.equal(una([mov(1, 150)], [pago(10, 150, 3)])[0]!.estado, 'conciliado');
    assert.equal(una([mov(1, 150)], [pago(10, 150, -3)])[0]!.estado, 'conciliado');
    assert.equal(una([mov(1, 150)], [pago(10, 150, 4)])[0]!.estado, 'sin_pago');
    assert.equal(una([mov(1, 150)], [pago(10, 150, 1)], 0)[0]!.estado, 'sin_pago');
    assert.equal(una([mov(1, 150)], [pago(10, 150, 0)], 0)[0]!.estado, 'conciliado');
  });
  it('el número de operación gana entre varios pagos del mismo monto', () => {
    const [d] = una([mov(1, 150, 0, '100234')], [pago(10, 150, 0), pago(11, 150, 2, ['100234']), pago(12, 150, 0)]);
    assert.deepEqual(d, { movimientoId: 1, estado: 'conciliado', pagoId: 11, candidatos: [] });
  });
  it('la operación igual no exige la ventana (con el mismo monto), pero sí el monto', () => {
    assert.equal(una([mov(1, 150, 0, '100234')], [pago(10, 150, 9, ['100234'])])[0]!.estado, 'conciliado');
    assert.equal(una([mov(1, 150, 0, '100234')], [pago(10, 160, 0, ['100234'])])[0]!.estado, 'sin_pago');
  });
  it('una operación demasiado corta no es señal', () => {
    const [d] = una([mov(1, 150, 0, '12')], [pago(10, 150, 0, ['12']), pago(11, 150, 1)]);
    assert.equal(d!.estado, 'por_revisar');
  });
  it('dos abonos y un solo pago: ninguno se concilia solo (se lo disputan)', () => {
    const r = una([mov(1, 150), mov(2, 150)], [pago(10, 150)]);
    assert.deepEqual(r.map((x) => x.estado), ['por_revisar', 'por_revisar']);
  });
  it('dos abonos y dos pagos iguales: por revisar los dos; con operaciones distintas, cada uno el suyo', () => {
    assert.deepEqual(una([mov(1, 150), mov(2, 150)], [pago(10, 150), pago(11, 150)]).map((x) => x.estado), ['por_revisar', 'por_revisar']);
    const r = una([mov(1, 150, 0, '100001'), mov(2, 150, 0, '100002')], [pago(10, 150, 0, ['100002']), pago(11, 150, 0, ['100001'])]);
    assert.deepEqual(r.map((x) => [x.estado, x.pagoId]), [['conciliado', 11], ['conciliado', 10]]);
  });
  it('un pago tomado por operación no queda como candidato de otro abono', () => {
    const r = una([mov(1, 150, 0, '100001'), mov(2, 150)], [pago(10, 150, 0, ['100001']), pago(11, 150)]);
    assert.deepEqual(r.map((x) => [x.estado, x.pagoId]), [['conciliado', 10], ['conciliado', 11]]);
  });
});
