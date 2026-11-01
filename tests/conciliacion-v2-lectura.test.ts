// Conciliación v2, parte pura (sin base de datos): elegir la hoja correcta, salidas (cargos y monto con signo), verificación del saldo, cruce con el n.º de
// operación + fecha, «fuera de período» y la pista por nombre. Todo con extractos SINTÉTICOS (fixtures inventados o armados aquí).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { emparejar, type PagoParaCruce } from '../src/server/services/conciliacion/cruce';
import { puntajeNombre, tokensDeNombre } from '../src/server/services/conciliacion/gestion';
import { huellasDe } from '../src/server/services/conciliacion/importar';
import { leerAbonos, leerExtracto, verificarSaldo, type FilaDeSaldo } from '../src/server/services/conciliacion/lectura';

const DIR = path.join(import.meta.dirname, 'fixtures', 'conciliacion');
const abrir = (n: string) => fs.readFileSync(path.join(DIR, n));
const D = (v: string | number) => new Prisma.Decimal(v);
const dia = (d: Date) => d.toISOString().slice(0, 10);
const libro = (hojas: [string, unknown[][]][]) => {
  const wb = XLSX.utils.book_new();
  for (const [n, filas] of hojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), n);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
};

describe('hoja correcta del libro', () => {
  it('el extracto del BCP está en la segunda hoja («accountDetail»): se lee esa y no la primera', () => {
    const r = leerExtracto(abrir('bcp-detalle.xlsx'), 'bcp-detalle.xlsx');
    assert.equal(r.hoja, 'accountDetail');
    assert.equal(r.reconocido, true);
    assert.deepEqual(r.abonos.map((a) => [dia(a.fecha), a.monto.toFixed(2), a.operacion, a.descripcion]), [
      ['2026-10-05', '150.00', '100501', 'YAPE MANUEL CAV'], ['2026-10-06', '150.00', '100502', 'TRAN PEREZ DEMO JUAN'], ['2026-10-07', '1234.56', '100504', 'DEPOSITO VENTANILLA DEMO'],
    ]);
    assert.deepEqual(r.salidas.map((a) => [a.monto.toFixed(2), a.descripcion]), [['80.00', 'PAGO LUZ DEMO'], ['45.50', 'COMISION MANTENIMIENTO']]);
    assert.equal(r.saldo, null, 'sin columna de saldo no se dice nada');
  });
  it('sin un nombre conocido, la primera hoja cuyas columnas se reconocen (no la de portada)', () => {
    const b = libro([['Hoja1', [['Portada'], ['Banco DEMO']]], ['Datos', [['Fecha', 'Descripción', 'Monto'], ['05/10/2026', 'UNO', 10]]], ['Otra', [['Fecha', 'Descripción', 'Monto'], ['06/10/2026', 'DOS', 20]]]]);
    const r = leerExtracto(b, 'libro.xlsx');
    assert.equal(r.hoja, 'Datos');
    assert.deepEqual(r.abonos.map((a) => a.descripcion), ['UNO']);
  });
  it('entre varias hojas reconocidas gana la de nombre de extracto, aunque no sea la primera', () => {
    const cuerpo = (t: string) => [['Fecha', 'Descripción', 'Monto'], ['05/10/2026', t, 10]];
    const r = leerExtracto(libro([['Prueba', cuerpo('PRIMERA')], ['Movimientos', cuerpo('SEGUNDA')]]), 'libro.xlsx');
    assert.equal(r.hoja, 'Movimientos');
    assert.deepEqual(r.abonos.map((a) => a.descripcion), ['SEGUNDA']);
  });
  it('si ninguna se reconoce, se muestran las filas de la de nombre de extracto (o la primera) para elegir columnas', () => {
    const raras = [['Cuándo', 'Qué'], ['x', 'y']];
    assert.equal(leerExtracto(libro([['Portada', [['Hola']]], ['Detalle', raras]]), 'l.xlsx').vista[0]![0], 'Cuándo');
    const solo = leerExtracto(libro([['Portada', [['Hola']]], ['Otra', raras]]), 'l.xlsx');
    assert.equal(solo.reconocido, false);
    assert.equal(solo.vista[0]![0], 'Hola');
  });
  it('un CSV no tiene hojas', () => assert.equal(leerExtracto(abrir('saldo-asc.csv'), 'saldo-asc.csv').hoja, null));
});

describe('salidas (cargos)', () => {
  it('una sola columna con signo: los negativos son salidas (monto en positivo), los positivos abonos', () => {
    const r = leerAbonos([['Fecha', 'Descripción', 'Importe'], ['05/10/2026', 'ENTRA', '150.00'], ['06/10/2026', 'SALE', '-80.00'], ['07/10/2026', 'SALE PAREN', '(20.50)'], ['08/10/2026', 'SALE FINAL', '10.00-']]);
    assert.deepEqual(r.abonos.map((a) => [a.descripcion, a.monto.toFixed(2)]), [['ENTRA', '150.00']]);
    assert.deepEqual(r.salidas.map((a) => [a.descripcion, a.monto.toFixed(2)]), [['SALE', '80.00'], ['SALE PAREN', '20.50'], ['SALE FINAL', '10.00']]);
  });
  it('columnas de cargo y de abono: lo del cargo es una salida, con o sin signo', () => {
    const r = leerAbonos([['Fecha', 'Descripción', 'Débitos', 'Créditos'], ['05/10/2026', 'A', '80.00', ''], ['06/10/2026', 'B', '-45.50', ''], ['07/10/2026', 'C', '', '10.00'], ['08/10/2026', 'D', '', '']]);
    assert.deepEqual(r.salidas.map((a) => a.monto.toFixed(2)), ['80.00', '45.50']);
    assert.deepEqual(r.abonos.map((a) => a.monto.toFixed(2)), ['10.00']);
    assert.equal(r.descartes.sin_monto, 1, 'una fila sin ningún monto no es un movimiento');
  });
  it('la huella de una salida no choca con la de un abono igual (pero la de un abono no cambió)', () => {
    const x = { fecha: new Date('2026-10-05T00:00:00Z'), monto: D(80), descripcion: 'IGUAL', operacion: null };
    assert.notEqual(huellasDe(1, [x])[0], huellasDe(1, [{ ...x, salida: true }])[0]);
    assert.equal(huellasDe(1, [x])[0], huellasDe(1, [{ ...x, salida: false }])[0]);
  });
});

describe('verificación del saldo', () => {
  it('del más viejo al más nuevo: cuadra, con saldo inicial y final', () => {
    const r = leerExtracto(abrir('saldo-asc.csv'), 'saldo-asc.csv');
    assert.deepEqual([r.abonos.length, r.salidas.length], [3, 2]);
    assert.deepEqual([r.saldo!.inicial.toFixed(2), r.saldo!.final.toFixed(2), r.saldo!.cuadra, r.saldo!.avisos, r.saldo!.orden], ['1000.00', '2262.06', true, [], 'asc']);
  });
  it('del más nuevo al más viejo: cuadra igual y detecta el orden', () => {
    const r = leerExtracto(abrir('saldo-desc.csv'), 'saldo-desc.csv');
    assert.deepEqual([r.saldo!.inicial.toFixed(2), r.saldo!.final.toFixed(2), r.saldo!.cuadra, r.saldo!.avisos, r.saldo!.orden], ['1000.00', '2262.06', true, [], 'desc']);
  });
  it('si falta un movimiento: avisa entre qué filas y que puede faltar un movimiento o estar cortado', () => {
    const r = leerExtracto(abrir('saldo-roto.csv'), 'saldo-roto.csv');
    assert.equal(r.saldo!.cuadra, false);
    assert.deepEqual(r.saldo!.avisos, ['Entre la fila 3 y la 4 el saldo no cuadra: puede faltar un movimiento o el archivo está cortado']);
    assert.deepEqual([r.saldo!.inicial.toFixed(2), r.saldo!.final.toFixed(2)], ['1000.00', '2262.06']);
  });
  it('en un extracto del más nuevo al más viejo con un hueco, el aviso nombra las filas (menor primero)', () => {
    const lineas = fs.readFileSync(path.join(DIR, 'saldo-roto.csv'), 'utf8').split('\r\n');
    const desc = [lineas[0]!, ...lineas.slice(1).reverse()].join('\r\n');
    const r = leerExtracto(Buffer.from(desc), 'x.csv');
    assert.equal(r.saldo!.orden, 'desc');
    assert.equal(r.saldo!.avisos.length, 1);
    assert.match(r.saldo!.avisos[0]!, /^Entre la fila (\d+) y la (\d+) el saldo no cuadra/);
    const [, a, b] = /fila (\d+) y la (\d+)/.exec(r.saldo!.avisos[0]!)!;
    assert.ok(Number(a) < Number(b));
  });
  it('con una columna de monto con signo (BBVA) también verifica', () => {
    const r = leerAbonos([['Fecha', 'Concepto', 'Importe', 'Saldo'], ['05/10/2026', 'A', '100.00', '600.00'], ['06/10/2026', 'B', '-30.00', '570.00'], ['07/10/2026', 'C', '5.50', '575.50']]);
    assert.deepEqual([r.saldo!.inicial.toFixed(2), r.saldo!.final.toFixed(2), r.saldo!.cuadra], ['500.00', '575.50', true]);
  });
  it('un solo centavo de diferencia ya es un tramo que no cuadra (Decimal, no flotantes)', () => {
    const f = (fila: number, mov: string, saldo: string | null): FilaDeSaldo => ({ fila, dia: fila, mov: D(mov), saldo: saldo == null ? null : D(saldo) });
    assert.equal(verificarSaldo([f(2, '0.10', '100.10'), f(3, '0.20', '100.30')])!.cuadra, true, '0.1 + 0.2 sí es 0.3 en Decimal');
    const r = verificarSaldo([f(2, '0.10', '100.10'), f(3, '0.20', '100.29')])!;
    assert.equal(r.cuadra, false);
    assert.equal(r.avisos.length, 1);
  });
  it('una fila sin saldo no corta la cadena: su movimiento se suma hasta la siguiente con saldo', () => {
    const f = (fila: number, mov: string, saldo: string | null): FilaDeSaldo => ({ fila, dia: fila, mov: D(mov), saldo: saldo == null ? null : D(saldo) });
    assert.equal(verificarSaldo([f(2, '10', '110'), f(3, '5', null), f(4, '-3', '112')])!.cuadra, true);
    assert.equal(verificarSaldo([f(2, '10', '110'), f(3, '5', null), f(4, '-3', '113')])!.cuadra, false);
  });
  it('un hueco da UN aviso (se sigue desde el saldo nuevo), no uno por cada fila siguiente', () => {
    const f = (fila: number, mov: string, saldo: string): FilaDeSaldo => ({ fila, dia: fila, mov: D(mov), saldo: D(saldo) });
    const r = verificarSaldo([f(2, '10', '110'), f(3, '10', '120'), f(4, '10', '200'), f(5, '10', '210'), f(6, '10', '220')])!;
    assert.deepEqual(r.avisos, ['Entre la fila 3 y la 4 el saldo no cuadra: puede faltar un movimiento o el archivo está cortado']);
  });
  it('una fila «saldo anterior» (con fecha, sin movimiento) sirve de punto de partida', () => {
    const r = leerAbonos([['Fecha', 'Descripción', 'Monto', 'Saldo'], ['01/10/2026', 'SALDO ANTERIOR', '', '1,000.00'], ['05/10/2026', 'A', '50.00', '1,050.00'], ['06/10/2026', 'B', '-20.00', '1,030.00']]);
    assert.deepEqual([r.saldo!.inicial.toFixed(2), r.saldo!.final.toFixed(2), r.saldo!.cuadra], ['1000.00', '1030.00', true]);
  });
  it('sin columna de saldo no hay verificación', () => {
    assert.equal(leerAbonos([['Fecha', 'Descripción', 'Monto'], ['05/10/2026', 'A', '50.00']]).saldo, null);
    assert.equal(verificarSaldo([]), null);
    assert.equal(verificarSaldo([{ fila: 2, dia: 0, mov: D(5), saldo: null }]), null);
  });
  it('muchos huecos: se muestran los primeros avisos y se cuenta el resto', () => {
    const filas: FilaDeSaldo[] = Array.from({ length: 12 }, (_, i) => ({ fila: i + 2, dia: i, mov: D(10), saldo: D(1000 + i * 25) }));
    const r = verificarSaldo(filas)!;
    assert.equal(r.avisos.length, 6);
    assert.match(r.avisos[5]!, /^Y 6 tramos más/);
  });
});

describe('cruce puro: n.º de operación + fecha', () => {
  const DIA = 86_400_000;
  const T = Date.parse('2026-10-05T00:00:00Z');
  const pago = (id: number, total: string | number, dias = 0, operaciones: string[] = []): PagoParaCruce => ({ id, dia: T + dias * DIA, total: D(total), operaciones });
  const mov = (id: number, monto: string | number, dias = 0, operacion: string | null = null) => ({ id, dia: T + dias * DIA, monto: D(monto), operacion });

  it('misma operación y monto DENTRO de la ventana → conciliado', () => {
    assert.deepEqual(emparejar([mov(1, 150, 0, '100234')], [pago(10, 150, 3, ['100234'])], 3)[0], { movimientoId: 1, estado: 'conciliado', pagoId: 10, candidatos: [], motivo: null });
  });
  it('misma operación y monto en OTRA fecha (fuera de la ventana) → por revisar con el motivo, nunca conciliado', () => {
    const [d] = emparejar([mov(1, 150, 0, '100234')], [pago(10, 150, 7, ['100234'])], 3);
    assert.deepEqual(d, { movimientoId: 1, estado: 'por_revisar', pagoId: null, candidatos: [10], motivo: 'Mismo n.º de operación, otra fecha (05/10 vs 12/10)' });
    assert.equal(emparejar([mov(1, 150, 0, '100234')], [pago(10, 150, -9, ['100234'])], 3)[0]!.estado, 'por_revisar', 'también si el pago es anterior');
  });
  it('el número repetido entre fechas: cada abono toma el pago de SU fecha; el de otro día no se cuela', () => {
    // El mismo número 5044754 el 26-ago con un cliente y el 31-ago con otro, mismo monto (cuotas iguales).
    const r = emparejar([mov(1, 150, 0, '5044754'), mov(2, 150, 5, '5044754')], [pago(10, 150, 0, ['5044754']), pago(11, 150, 5, ['5044754'])], 3);
    assert.deepEqual(r.map((x) => [x.estado, x.pagoId]), [['conciliado', 10], ['conciliado', 11]]);
    // Si del 26 sólo existe el pago (el abono no está en el extracto), el abono del 31 NO lo toma: queda para revisar.
    const solo = emparejar([mov(2, 150, 5, '5044754')], [pago(10, 150, 0, ['5044754'])], 3)[0]!;
    assert.equal(solo.estado, 'por_revisar');
    assert.equal(solo.pagoId, null);
    assert.match(solo.motivo!, /otra fecha \(10\/10 vs 05\/10\)/);
  });
  it('con otra fecha en juego, ni siquiera un único candidato normal en la ventana se concilia solo', () => {
    const [d] = emparejar([mov(1, 150, 0, '100234')], [pago(10, 150, 1), pago(11, 150, 9, ['100234'])], 3);
    assert.equal(d!.estado, 'por_revisar');
    assert.deepEqual(d!.candidatos, [10, 11], 'primero el de la ventana');
    assert.match(d!.motivo!, /otra fecha/);
  });
  it('más lejos que el tope de sugerencia (31 días), ni se sugiere; otro monto tampoco', () => {
    assert.equal(emparejar([mov(1, 150, 0, '100234')], [pago(10, 150, 40, ['100234'])], 3)[0]!.estado, 'sin_pago');
    assert.equal(emparejar([mov(1, 150, 0, '100234')], [pago(10, 160, 7, ['100234'])], 3)[0]!.estado, 'sin_pago');
  });
  it('la ventana por cuenta decide qué es «otra fecha»', () => {
    assert.equal(emparejar([mov(1, 150, 0, '100234')], [pago(10, 150, 7, ['100234'])], 7)[0]!.estado, 'conciliado');
    assert.equal(emparejar([mov(1, 150, 0, '100234')], [pago(10, 150, 7, ['100234'])], 6)[0]!.estado, 'por_revisar');
  });
  it('un pago tomado por otro abono no se sugiere como «otra fecha»', () => {
    const r = emparejar([mov(1, 150, 0, '100234'), mov(2, 150, 9, '100234')], [pago(10, 150, 0, ['100234'])], 3);
    assert.deepEqual(r.map((x) => x.estado), ['conciliado', 'sin_pago']);
  });
});

describe('cruce puro: fuera de período', () => {
  const DIA = 86_400_000;
  const T = Date.parse('2026-10-10T00:00:00Z');
  const rango = { desde: T, hasta: T + 10 * DIA };
  const mov = (dias: number) => ({ id: 1, dia: T + dias * DIA, monto: D(77), operacion: null });
  const estado = (dias: number, r: typeof rango | null = rango) => emparejar([mov(dias)], [], 3, r)[0]!.estado;

  it('sin candidatos: dentro del rango de los pagos es «sin pago» (hay trabajo); fuera es «fuera de período»', () => {
    assert.equal(estado(0), 'sin_pago');
    assert.equal(estado(10), 'sin_pago', 'el último día cuenta como dentro');
    assert.equal(estado(5), 'sin_pago');
    assert.equal(estado(-1), 'fuera_periodo');
    assert.equal(estado(11), 'fuera_periodo');
    assert.equal(estado(-90), 'fuera_periodo');
  });
  it('sin pagos registrados no hay rango: nada es «fuera de período»', () => assert.equal(estado(-90, null), 'sin_pago'));
  it('un abono con candidatos no es «fuera de período»', () => {
    assert.equal(emparejar([mov(-1)], [{ id: 5, dia: T - 2 * DIA, total: D(77), operaciones: [] }], 3, rango)[0]!.estado, 'conciliado');
  });
});

describe('pista por nombre', () => {
  it('las palabras de la glosa que pueden ser un nombre: sin tildes, ≥ 3 letras, sin palabras del banco', () => {
    assert.deepEqual(tokensDeNombre('YAPE MANUEL CAV'), ['manuel', 'cav']);
    assert.deepEqual(tokensDeNombre('TRAN. INTERBANCARIA 0001234 PEREZ GÓMEZ JUAN A'), ['perez', 'gomez', 'juan']);
    assert.deepEqual(tokensDeNombre('PAGO LUZ DE 12'), ['luz']);
    assert.deepEqual(tokensDeNombre(''), []);
  });
  it('coincide con el nombre completo, sin tildes ni mayúsculas, o con un apellido abreviado que es el inicio del real', () => {
    assert.equal(puntajeNombre(tokensDeNombre('YAPE MANUEL CAV'), ['Manuel Cavero Soto']), 2);
    assert.equal(puntajeNombre(tokensDeNombre('TRAN PEREZ'), ['Ana Pérez']), 1);
    assert.equal(puntajeNombre(tokensDeNombre('YAPE MANUEL CAV'), ['Propietario 1', null, undefined]), 0);
    assert.equal(puntajeNombre([], ['Manuel']), 0);
    assert.deepEqual(tokensDeNombre('MA JU 1A'), [], 'menos de 3 letras o con números no es un nombre');
  });
});
