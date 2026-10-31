// «Mi historial» (propietario e inquilino): las cuentas de las series, el render de verdad (react-dom/server) con 1 y con 12+ meses, y el cableado
// (menú, rutas, prompt del asistente, BarChart apilado, LineChart). El repo no tiene testing-library: lo visual se fija con markup y con fuente.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import {
  MIN_MESES_GRAFICO, cifras, comparacionUltimoMes, conceptosDelPeriodo, costoPorM3, cuentaMeses, diasCorto, ejeMeses, masSubio, pesoPorConcepto, resumenAcumulado, serieDeConcepto,
  seriesAcumulado, seriesAgua, seriesComparacionBlock, seriesPorConcepto, seriesPuntualidad, tablaConceptos, textoAcumulado, textoComparacion, textoDias, textoPuntualidad,
} from '../src/pages/residente/_parts/historial';
import type { Historial, MesHistorial, ResumenHistorial } from '../src/pages/residente/_parts/historial';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

const P = '../src/pages/residente/_parts/';
let VistaResumen: typeof import('../src/pages/residente/_parts/HistorialGraficos').VistaResumen;
let VistaPorConcepto: typeof import('../src/pages/residente/_parts/HistorialConceptos').VistaPorConcepto;
let VistaAcumulado: typeof import('../src/pages/residente/_parts/HistorialAcumulado').VistaAcumulado;
let VistaAgua: typeof import('../src/pages/residente/_parts/HistorialAguaPuntualidad').VistaAgua;
let VistaPuntualidad: typeof import('../src/pages/residente/_parts/HistorialAguaPuntualidad').VistaPuntualidad;
let FiltrosHistorial: typeof import('../src/pages/residente/_parts/HistorialFiltros').FiltrosHistorial;
let Tabs: typeof import('../src/ui/Misc').Tabs;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ VistaResumen } = await import(`${P}HistorialGraficos`));
  ({ VistaPorConcepto } = await import(`${P}HistorialConceptos`));
  ({ VistaAcumulado } = await import(`${P}HistorialAcumulado`));
  ({ VistaAgua, VistaPuntualidad } = await import(`${P}HistorialAguaPuntualidad`));
  ({ FiltrosHistorial } = await import(`${P}HistorialFiltros`));
  ({ Tabs } = await import('../src/ui/Misc'));
});

const mes = (anio: number, m: number, extra: Partial<MesHistorial> = {}): MesHistorial => ({
  recibo_id: anio * 100 + m, anio, mes: m, unidad: { id: 1, codigo: 'H-1' }, moneda: 'PEN', total: '100.00', por_concepto: [{ concepto: 'Agua', monto: '40.00' }, { concepto: 'Limpieza', monto: '60.00' }],
  pagado: '100.00', saldo: '0.00', estado: 'pagado', fecha_vencimiento: `${anio}-${String(m).padStart(2, '0')}-10`, fecha_pago: null, dias_vs_vencimiento: null, agua_m3: null, agua_promedio_block: null, total_promedio_block: null, ...extra,
});

const resumen = (extra: Partial<ResumenHistorial> = {}): ResumenHistorial => ({
  pagado: '100.00', promedio_mes: '100.00', deuda_actual: '0.00', en_revision: '0.00', meses_a_tiempo: 1, meses_evaluados: 1, meses_en_periodo: 1, agua_promedio_m3: null, ...extra,
});

const datos = (meses: MesHistorial[], extra: Partial<Historial> = {}): Historial => ({
  unidades: [{ id: 1, codigo: 'H-1', estructura: null }], anios: [2026], anio: null, moneda: 'PEN', resumen: resumen({ meses_en_periodo: new Set(meses.map(m => `${m.anio}-${m.mes}`)).size }), meses, ...extra,
});

describe('series de los gráficos (funciones puras)', () => {
  it('el eje: «Oct» dentro de un año, «Oct 26» si cruza años; setiembre es «Set»', () => {
    assert.deepEqual(ejeMeses([mes(2026, 9), mes(2026, 10)]).labels, ['Set', 'Oct']);
    assert.deepEqual(ejeMeses([mes(2025, 12), mes(2026, 1)]).labels, ['Dic 25', 'Ene 26']);
    assert.deepEqual(ejeMeses([mes(2026, 3), mes(2026, 3, { unidad: { id: 2, codigo: 'H-2' } })]).labels, ['Mar'], 'dos unidades en el mismo mes = una sola barra');
  });

  it('por concepto: suma las unidades, el concepto más grande primero y un color por concepto', () => {
    const r = seriesPorConcepto([
      mes(2026, 9), mes(2026, 9, { unidad: { id: 2, codigo: 'H-2' }, por_concepto: [{ concepto: 'Agua', monto: '10.50' }] }),
      mes(2026, 10, { por_concepto: [{ concepto: 'Limpieza', monto: '60.00' }, { concepto: 'Mora', monto: '5.00' }] }),
    ]);
    assert.deepEqual(r.labels, ['Set', 'Oct']);
    assert.deepEqual(r.series.map(s => [s.label, s.data, s.categoria]), [['Limpieza', [60, 60], 0], ['Agua', [50.5, 0], 1], ['Mora', [0, 5], 2]]);
  });

  it('con más conceptos que colores, el resto se junta en «Otros conceptos» (gris)', () => {
    const conceptos = Array.from({ length: 10 }, (_, i) => ({ concepto: `C${i}`, monto: String(100 - i * 5) + '.00' }));
    const r = seriesPorConcepto([mes(2026, 10, { por_concepto: conceptos })]);
    assert.equal(r.series.length, 8, '7 colores + Otros');
    const otros = r.series.at(-1)!;
    assert.equal(otros.label, 'Otros conceptos');
    assert.equal(otros.categoria, -1);
    assert.deepEqual(otros.data, [65 + 60 + 55], 'C7 + C8 + C9');
    assert.deepEqual(r.series.slice(0, 7).map(s => s.label), ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
  });

  it('con justo un concepto más que colores (8), el octavo va a «Otros conceptos»: nunca un color repetido o sin leyenda', () => {
    const conceptos = Array.from({ length: 8 }, (_, i) => ({ concepto: `C${i}`, monto: `${80 - i}.00` }));
    const r = seriesPorConcepto([mes(2026, 10, { por_concepto: conceptos })]);
    assert.deepEqual(r.series.map(s => s.label), ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'Otros conceptos']);
    assert.deepEqual(r.series.at(-1)!.data, [73]);
  });

  it('agua: tu consumo y el promedio del block (punteado); sin promedio, el hueco es null; sin lecturas, hayLecturas = false', () => {
    const r = seriesAgua([mes(2026, 9, { agua_m3: '10.000', agua_promedio_block: '20.000' }), mes(2026, 10, { agua_m3: '12.500' })]);
    assert.equal(r.hayLecturas, true);
    assert.deepEqual(r.series.map(s => [s.label, s.data, s.punteada ?? false]), [['Tu consumo', [10, 12.5], false], ['Promedio del block', [20, null], true]]);
    assert.equal(seriesAgua([mes(2026, 10)]).hayLecturas, false);
    assert.deepEqual(seriesAgua([mes(2026, 10)]).series, []);
  });

  it('agua con varias unidades: un par de líneas por unidad con lectura', () => {
    const r = seriesAgua([
      mes(2026, 10, { agua_m3: '10.000' }),
      mes(2026, 10, { unidad: { id: 2, codigo: 'H-2' }, agua_m3: '8.000', agua_promedio_block: '9.000' }),
      mes(2026, 10, { unidad: { id: 3, codigo: 'H-3' } }),
    ]);
    assert.deepEqual(r.series.map(s => s.label), ['Tu consumo · H-1', 'Promedio del block · H-1', 'Tu consumo · H-2', 'Promedio del block · H-2']);
  });

  it('puntualidad: lo anticipado va en «antes» (verde) y lo tardío en «después» (rojo); con varias unidades cuenta la más tardía', () => {
    const r = seriesPuntualidad([
      mes(2026, 8, { dias_vs_vencimiento: -4 }), mes(2026, 9, { dias_vs_vencimiento: 0 }), mes(2026, 10, { dias_vs_vencimiento: 3 }),
      mes(2026, 10, { unidad: { id: 2, codigo: 'H-2' }, dias_vs_vencimiento: -9 }), mes(2026, 11, { estado: 'vencido' }),
    ]);
    assert.deepEqual(r.labels, ['Ago', 'Set', 'Oct', 'Nov']);
    assert.deepEqual(r.series.map(s => [s.label, s.token, s.data]), [
      ['Antes del vencimiento', 'ok', [-4, 0, null, null]],
      ['Después del vencimiento', 'bad', [null, null, 3, null]],
    ]);
    assert.equal(r.hayPagos, true);
    assert.equal(seriesPuntualidad([mes(2026, 11, { estado: 'vencido' })]).hayPagos, false);
  });

  it('textos de días', () => {
    assert.equal(textoDias(-3), '3 días antes');
    assert.equal(textoDias(0), 'el mismo día');
    assert.equal(textoDias(1), '1 día después');
    assert.equal(diasCorto(-5), '5 d antes');
    assert.equal(diasCorto(2), '2 d después');
    assert.equal(diasCorto(0), 'Día del venc.');
  });

  it('las cuatro cifras: pagado, promedio, deuda de hoy (con tono) y puntualidad', () => {
    const al = cifras(resumen({ pagado: '340.00', promedio_mes: '85.00', meses_a_tiempo: 6, meses_evaluados: 6, meses_en_periodo: 6 }), null);
    assert.deepEqual(al.map(c => c.label), ['Pagado', 'Promedio por mes', 'Deuda de hoy', 'Puntualidad']);
    assert.match(String(al[0]!.value), /340\.00/);
    assert.equal(al[0]!.hint, 'En tus 6 meses con recibo');
    assert.deepEqual([al[2]!.tone, al[2]!.hint], ['ok', 'Estás al día']);
    assert.deepEqual([al[3]!.value, al[3]!.tone], ['A tiempo 6 de 6', 'ok']);
    const debe = cifras(resumen({ deuda_actual: '235.00', en_revision: '80.00', meses_a_tiempo: 1, meses_evaluados: 4 }), 2025);
    assert.equal(debe[0]!.hint, 'En 2025');
    assert.deepEqual([debe[2]!.tone, debe[2]!.hint?.replace(/\u00a0/g, ' ')], ['bad', 'Y S/ 80.00 en revisión']); // el formato de moneda usa espacio duro
    assert.equal(debe[3]!.tone, 'warn', 'menos de la mitad a tiempo');
    const sin = cifras(resumen({ meses_a_tiempo: 0, meses_evaluados: 0 }), null);
    assert.deepEqual([sin[3]!.value, sin[3]!.hint], ['—', 'Aún no hay meses para evaluar']);
  });
});

describe('comparar con tu block (funciones puras)', () => {
  it('dos líneas: tu total y el promedio del block (punteado); un mes sin promedio es un hueco', () => {
    const r = seriesComparacionBlock([mes(2026, 9, { total: '100.00', total_promedio_block: '80.00' }), mes(2026, 10, { total: '120.00' })]);
    assert.deepEqual(r.labels, ['Set', 'Oct']);
    assert.deepEqual(r.series.map(s => [s.label, s.data, s.punteada ?? false]), [['Tu total', [100, 120], false], ['Promedio del block', [80, null], true]]);
    assert.deepEqual([r.hayPromedio, r.variasUnidades], [true, false]);
  });

  it('sin ningún promedio publicado no hay series (la pantalla explica por qué)', () => {
    const r = seriesComparacionBlock([mes(2026, 10)]);
    assert.deepEqual([r.hayPromedio, r.series], [false, []]);
  });

  it('con dos unidades en el mismo mes no se compara (el promedio es por unidad): variasUnidades', () => {
    const r = seriesComparacionBlock([mes(2026, 10, { total_promedio_block: '80.00' }), mes(2026, 10, { unidad: { id: 2, codigo: 'H-2' }, total_promedio_block: '80.00' })]);
    assert.deepEqual([r.variasUnidades, r.series], [true, []]);
    assert.equal(comparacionUltimoMes([mes(2026, 10, { total_promedio_block: '80.00' }), mes(2026, 10, { unidad: { id: 2, codigo: 'H-2' }, total_promedio_block: '80.00' })]), null);
  });

  it('el último mes con promedio: diferencia en dinero y en %; la frase dice más, menos o igual', () => {
    const c = comparacionUltimoMes([mes(2026, 9, { total: '50.00', total_promedio_block: '60.00' }), mes(2026, 10, { total: '120.00', total_promedio_block: '100.00' }), mes(2026, 11, { total: '90.00' })])!;
    assert.deepEqual([c.mes, c.tuyo, c.promedio, c.diferencia, c.pct], ['octubre', 120, 100, 20, 20], 'noviembre no tiene promedio: se usa octubre');
    const t = (x: typeof c) => textoComparacion(x, 'PEN').replace(/\u00a0/g, ' ');
    assert.equal(t(c), 'Tu mantenimiento de octubre fue S/ 120.00, S/ 20.00 más que el promedio de tu block (S/ 100.00): 20 % más.');
    assert.match(t({ ...c, tuyo: 75, diferencia: -25, pct: -25 }), /S\/ 25\.00 menos que el promedio de tu block \(S\/ 100\.00\): 25 % menos\./);
    assert.equal(t({ ...c, tuyo: 100, diferencia: 0, pct: 0 }), 'Tu mantenimiento de octubre fue S/ 100.00, igual que el promedio de tu block.');
    assert.equal(comparacionUltimoMes([mes(2026, 10)]), null);
  });
});

describe('por concepto (funciones puras)', () => {
  const tres = [
    mes(2026, 8, { por_concepto: [{ concepto: 'Agua', monto: '30.00' }, { concepto: 'Limpieza', monto: '60.00' }] }),
    mes(2026, 9, { por_concepto: [{ concepto: 'Agua', monto: '40.00' }, { concepto: 'Limpieza', monto: '60.00' }, { concepto: 'Mora', monto: '5.00' }] }),
    mes(2026, 10, { por_concepto: [{ concepto: 'Agua', monto: '70.00' }, { concepto: 'Limpieza', monto: '60.00' }] }),
  ];

  it('los conceptos del periodo, el que más pesa primero', () => {
    assert.deepEqual(conceptosDelPeriodo(tres), ['Limpieza', 'Agua', 'Mora']);
    assert.deepEqual(conceptosDelPeriodo([]), []);
  });

  it('la línea de un concepto: su monto mes a mes; el mes que no lo trae es 0 (ese mes no pagaste nada de él)', () => {
    assert.deepEqual(serieDeConcepto(tres, 'Mora'), { labels: ['Ago', 'Set', 'Oct'], series: [{ label: 'Mora', data: [0, 5, 0], token: 'brand' }] });
    assert.deepEqual(serieDeConcepto(tres, 'Agua').series[0]!.data, [30, 40, 70]);
  });

  it('con dos unidades en el mismo mes, los montos del concepto se suman', () => {
    const r = serieDeConcepto([tres[2]!, mes(2026, 10, { unidad: { id: 2, codigo: 'H-2' }, por_concepto: [{ concepto: 'Agua', monto: '12.50' }] })], 'Agua');
    assert.deepEqual(r.series[0]!.data, [82.5]);
  });

  it('la tabla concepto × meses: totales por mes y del periodo', () => {
    const t = tablaConceptos(tres);
    assert.deepEqual(t.labels, ['Ago', 'Set', 'Oct']);
    assert.deepEqual(t.filas.map(f => [f.concepto, f.montos, f.total]), [['Limpieza', [60, 60, 60], 180], ['Agua', [30, 40, 70], 140], ['Mora', [0, 5, 0], 5]]);
    assert.deepEqual([t.totales, t.totalGeneral], [[90, 105, 130], 325]);
  });

  it('cuánto pesa cada concepto: % del total con un decimal, de mayor a menor', () => {
    const p = pesoPorConcepto(tres);
    assert.deepEqual(p.map(x => [x.concepto, x.monto, x.pct]), [['Limpieza', 180, 55.4], ['Agua', 140, 43.1], ['Mora', 5, 1.5]]);
    assert.deepEqual(pesoPorConcepto([mes(2026, 10, { por_concepto: [{ concepto: 'Agua', monto: '100.00' }, { concepto: 'Descuento', monto: '-20.00' }] })]).map(x => [x.concepto, x.pct]), [['Agua', 100]], 'un descuento no es «peso» ni resta del 100 %');
    assert.deepEqual(pesoPorConcepto([]), []);
    assert.deepEqual(pesoPorConcepto([mes(2026, 10, { por_concepto: [{ concepto: 'Agua', monto: '0.00' }] })]), [], 'sin nada que repartir no hay % (nada de dividir entre cero)');
  });

  it('el que más subió: la mayor diferencia en dinero entre su último y su primer mes con monto', () => {
    const r = masSubio(tres)!;
    assert.deepEqual([r.concepto, r.desde, r.hasta, r.diferencia, r.pct], ['Agua', { mes: 'Ago', monto: 30 }, { mes: 'Oct', monto: 70 }, 40, 133]);
  });

  it('el que más subió: usa el primer y el último mes CON monto (los ceros no cuentan) y no premia el %', () => {
    const r = masSubio([
      mes(2026, 7, { por_concepto: [{ concepto: 'Mora', monto: '1.00' }, { concepto: 'Agua', monto: '100.00' }] }),
      mes(2026, 8, { por_concepto: [{ concepto: 'Agua', monto: '100.00' }] }),
      mes(2026, 9, { por_concepto: [{ concepto: 'Mora', monto: '9.00' }, { concepto: 'Agua', monto: '130.00' }] }),
      mes(2026, 10, { por_concepto: [{ concepto: 'Agua', monto: '130.00' }] }),
    ])!;
    assert.deepEqual([r.concepto, r.desde.mes, r.hasta.mes, r.diferencia], ['Agua', 'Jul', 'Oct', 30], 'Mora subió 800 % pero sólo 8 soles: gana Agua');
  });

  it('el que más subió: sin dos meses, con un concepto en un solo mes, o si nada subió → null', () => {
    assert.equal(masSubio([tres[2]!]), null, 'un solo mes');
    assert.equal(masSubio([mes(2026, 9, { por_concepto: [{ concepto: 'Mora', monto: '5.00' }] }), mes(2026, 10, { por_concepto: [{ concepto: 'Agua', monto: '5.00' }] })]), null, 'ningún concepto aparece en dos meses');
    assert.equal(masSubio([mes(2026, 9), mes(2026, 10, { por_concepto: [{ concepto: 'Agua', monto: '10.00' }, { concepto: 'Limpieza', monto: '20.00' }] })]), null, 'todo bajó');
    assert.equal(MIN_MESES_GRAFICO, 2);
    assert.equal(cuentaMeses([mes(2026, 10), mes(2026, 10, { unidad: { id: 2, codigo: 'H-2' } })]), 1, 'dos unidades en el mismo mes = un mes');
  });
});

describe('acumulado, agua y puntualidad (funciones puras)', () => {
  const tresMeses = [
    mes(2026, 8, { total: '100.00', pagado: '100.00', saldo: '0.00' }),
    mes(2026, 9, { total: '110.00', pagado: '40.00', saldo: '30.00', estado: 'vencido' }), // 40 pagado, 30 por pagar, 40 en revisión
    mes(2026, 10, { total: '90.00', pagado: '0.00', saldo: '90.00', estado: 'pendiente' }),
  ];

  it('acumulado: dos líneas que suben (lo que te cobraron y lo que pagaste)', () => {
    const r = seriesAcumulado(tresMeses);
    assert.deepEqual(r.labels, ['Ago', 'Set', 'Oct']);
    assert.deepEqual(r.series.map(s => [s.label, s.data]), [['Lo que te cobraron', [100, 210, 300]], ['Lo que pagaste', [100, 140, 140]]]);
  });

  it('el resumen del acumulado: la distancia es lo pendiente y de ella lo que ya está en revisión', () => {
    assert.deepEqual(resumenAcumulado(tresMeses), { cobrado: 300, pagado: 140, pendiente: 160, enRevision: 40 });
    const t = (r: ReturnType<typeof resumenAcumulado>) => textoAcumulado(r, 'PEN').replace(/\u00a0/g, ' ');
    assert.equal(t(resumenAcumulado(tresMeses)), 'Te cobraron S/ 300.00 y pagaste S/ 140.00. La diferencia, S/ 160.00, sigue pendiente (S/ 40.00 ya lo enviaste y espera validación).');
    assert.equal(t({ cobrado: 300, pagado: 100, pendiente: 200, enRevision: 0 }), 'Te cobraron S/ 300.00 y pagaste S/ 100.00. La diferencia, S/ 200.00, sigue pendiente.');
    assert.equal(t(resumenAcumulado([mes(2026, 10)])), 'Pagaste todo lo que te cobraron en el periodo: S/ 100.00.');
  });

  it('costo por m³: el concepto «Agua» ÷ tus m³, por mes y en el periodo; sin lectura o con 0 m³ el mes no cuenta', () => {
    const r = costoPorM3([
      mes(2026, 8, { agua_m3: '8.000' }),
      mes(2026, 9, { agua_m3: '10.000', por_concepto: [{ concepto: 'Consumo de agua potable', monto: '75.00' }, { concepto: 'Limpieza', monto: '60.00' }] }),
      mes(2026, 10), mes(2026, 11, { agua_m3: '0.000' }),
    ]);
    assert.deepEqual(r.series[0]!.data, [5, 7.5, null, null]);
    assert.equal(r.promedio, 6.39, '(40 + 75) ÷ (8 + 10)');
    assert.equal(r.hayDatos, true);
  });

  it('costo por m³: si ningún concepto o varios dicen «agua» no se adivina → sin datos', () => {
    const dos = [{ concepto: 'Agua', monto: '40.00' }, { concepto: 'Agua de riego', monto: '10.00' }];
    for (const por_concepto of [dos, [{ concepto: 'Limpieza', monto: '60.00' }], [{ concepto: 'Aguinaldo', monto: '60.00' }]]) {
      const r = costoPorM3([mes(2026, 10, { agua_m3: '8.000', por_concepto })]);
      assert.deepEqual([r.hayDatos, r.promedio, r.series[0]!.data], [false, null, [null]]);
    }
  });

  it('puntualidad: la frase con «meses a tiempo de evaluados»', () => {
    assert.equal(textoPuntualidad({ meses_a_tiempo: 5, meses_evaluados: 6 }), 'Pagaste a tiempo 5 de 6 meses.');
    assert.equal(textoPuntualidad({ meses_a_tiempo: 1, meses_evaluados: 1 }), 'Pagaste a tiempo 1 de 1 mes.');
    assert.equal(textoPuntualidad({ meses_a_tiempo: 0, meses_evaluados: 0 }), null);
  });
});

const render = (componente: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(componente as React.FunctionComponent<Record<string, unknown>>, props));
const canvas = (html: string) => (html.match(/<canvas/g) ?? []).length;
const sinEspacioDuro = (html: string) => html.replace(/\u00a0/g, ' ');

describe('render de las pestañas de «Mi historial» (react-dom/server)', () => {
  const unMes = datos([mes(2026, 10, { fecha_pago: '2026-10-08T15:00:00.000Z', dias_vs_vencimiento: -2 })]);
  const docemeses = datos(Array.from({ length: 14 }, (_, i) => mes(2025 + Math.floor((i + 4) / 12), ((i + 4) % 12) + 1, { dias_vs_vencimiento: (i % 5) - 2, agua_m3: String(8 + i), agua_promedio_block: '10.000', total_promedio_block: '90.00' })).slice(-12), { anios: [2026, 2025] });
  const con = (d: Historial, f: (m: MesHistorial, i: number) => Partial<MesHistorial>): Historial => ({ ...d, meses: d.meses.map((m, i) => ({ ...m, ...f(m, i) })) });

  it('Resumen con un solo mes: las cifras, el gráfico del total (con su tabla accesible), el aviso amable y SIN agua ni puntualidad', () => {
    const html = render(VistaResumen, { data: unMes });
    for (const t of ['Pagado', 'Promedio por mes', 'Deuda de hoy', 'Puntualidad', 'Cuánto pagas cada mes']) assert.ok(html.includes(t), `falta «${t}»`);
    assert.equal(canvas(html), 1, 'un canvas: el del total (la comparación no tiene promedio ni mes para una línea)');
    assert.match(html, /Este es tu primer mes en Torre/);
    assert.match(html, /<div class="sr-only"><table><caption>Cuánto pagas cada mes, por concepto<\/caption>/, 'la tabla va dentro de un div sr-only: una <table> sr-only no recorta y ensancha la página en el celular');
    assert.doesNotMatch(html, /Aún no hay lecturas de agua|Aún no hay pagos para medir|Descargar Excel/, 'agua y puntualidad tienen su pestaña; los filtros y el Excel, los suyos');
  });

  it('Resumen: sin promedio publicado explica por qué (sin cifras de otros); con promedio y un mes, la frase sin gráfico; con 12 meses, la línea', () => {
    assert.match(render(VistaResumen, { data: unMes }), /Aún no hay un promedio para comparar/);
    const conPromedio = con(unMes, () => ({ total: '120.00', total_promedio_block: '100.00' }));
    const uno = sinEspacioDuro(render(VistaResumen, { data: conPromedio }));
    assert.match(uno, /Tu mantenimiento de octubre fue S\/ 120\.00, S\/ 20\.00 más que el promedio de tu block \(S\/ 100\.00\): 20 % más\./);
    assert.equal(canvas(uno), 1, 'con un solo mes no hay línea de evolución');
    const doce = render(VistaResumen, { data: docemeses });
    assert.equal(canvas(doce), 2, 'total apilado + tú contra el block');
    assert.doesNotMatch(doce, /primer mes/);
    assert.match(doce, /<caption>Tu total de cada mes contra el promedio del block<\/caption>/);
  });

  it('Resumen con dos unidades en el mismo mes: pide elegir una unidad (el promedio es por unidad)', () => {
    const dos = datos([mes(2026, 10, { total_promedio_block: '80.00' }), mes(2026, 10, { unidad: { id: 2, codigo: 'H-2' }, total_promedio_block: '80.00' })]);
    assert.match(render(VistaResumen, { data: dos }), /Elige una unidad para comparar/);
  });

  it('Por concepto con un solo mes: aviso de «aún no hay meses suficientes» (no una línea vacía), el peso en % y la tabla; sin «el que más subió»', () => {
    const html = render(VistaPorConcepto, { data: unMes });
    assert.match(html, /Aún no hay meses suficientes/);
    assert.equal(canvas(html), 0);
    assert.match(html, /Cuánto pesa cada concepto/);
    assert.match(html, /Limpieza[\s\S]*60 %/);
    assert.match(html, /<option value="Limpieza" selected="">Limpieza<\/option><option value="Agua">Agua<\/option>/, 'el selector: el concepto que más pesa, elegido');
    assert.match(html, /<caption class="sr-only">Monto de cada concepto en cada mes del periodo<\/caption>/);
    assert.doesNotMatch(html, /El que más subió|Ningún concepto subió/);
  });

  it('Por concepto con varios meses: la línea, el que más subió y la tabla concepto × meses', () => {
    const subiendo = con(docemeses, (_, i) => ({ por_concepto: [{ concepto: 'Agua', monto: String(30 + i * 2) + '.00' }, { concepto: 'Limpieza', monto: '60.00' }] }));
    const html = sinEspacioDuro(render(VistaPorConcepto, { data: subiendo }));
    assert.equal(canvas(html), 1);
    assert.match(html, /El que más subió: Agua\./);
    assert.match(html, /Pasó de S\/ 30\.00 en Jul 25 a S\/ 52\.00 en Jun 26 \(\+S\/ 22\.00, \+73 %\)\./);
    assert.equal((html.match(/<th scope="col"[^>]*>[A-Z][a-z]+ \d\d<\/th>/g) ?? []).length, 12, 'una columna por mes');
    assert.match(html, /<th scope="row"[^>]*>Total<\/th>/);
    const igual = sinEspacioDuro(render(VistaPorConcepto, { data: con(docemeses, () => ({ por_concepto: [{ concepto: 'Agua', monto: '40.00' }] })) }));
    assert.match(igual, /Ningún concepto subió/);
  });

  it('Acumulado: la frase de lo pendiente, el aviso con un mes y el total por concepto; con varios meses, las dos líneas', () => {
    const uno = sinEspacioDuro(render(VistaAcumulado, { data: con(unMes, () => ({ total: '100.00', pagado: '60.00', saldo: '40.00' })) }));
    assert.match(uno, /Te cobraron S\/ 100\.00 y pagaste S\/ 60\.00\. La diferencia, S\/ 40\.00, sigue pendiente\./);
    assert.match(uno, /Aún no hay meses suficientes/);
    assert.match(uno, /Total del periodo por concepto/);
    assert.equal(canvas(uno), 0);
    const doce = render(VistaAcumulado, { data: docemeses });
    assert.equal(canvas(doce), 1);
    assert.match(doce, /<caption>Lo que te cobraron y lo que pagaste, acumulado mes a mes<\/caption>/);
  });

  it('Agua: la línea contra el promedio, el costo por m³ si se puede calcular y, si no, un estado vacío honesto', () => {
    const sinLecturas = render(VistaAgua, { data: unMes });
    assert.match(sinLecturas, /Aún no hay lecturas de agua/);
    assert.doesNotMatch(sinLecturas, /Costo por m³/);
    const uno = sinEspacioDuro(render(VistaAgua, { data: con(unMes, () => ({ agua_m3: '8.000', agua_promedio_block: '10.000' })) }));
    assert.match(uno, /pagaste en promedio <strong[^>]*>S\/ 5\.00<\/strong> por cada m³/, '40 ÷ 8');
    assert.equal(canvas(uno), 1, 'con un mes no hay línea del costo');
    const sinConcepto = render(VistaAgua, { data: con(unMes, () => ({ agua_m3: '8.000', por_concepto: [{ concepto: 'Limpieza', monto: '60.00' }] })) });
    assert.match(sinConcepto, /No se puede calcular todavía/);
    const doce = render(VistaAgua, { data: docemeses });
    assert.equal(canvas(doce), 2);
    assert.match(doce, /El promedio del block aparece cuando hay al menos 3 lecturas/);
  });

  it('Puntualidad: el gráfico de días con su tabla y «a tiempo de evaluados»; sin pagos, el estado vacío', () => {
    const uno = render(VistaPuntualidad, { data: datos(unMes.meses, { resumen: resumen({ meses_a_tiempo: 1, meses_evaluados: 1 }) }) });
    assert.match(uno, /Pagaste a tiempo 1 de 1 mes\./);
    assert.equal(canvas(uno), 1);
    assert.match(uno, /<caption>Días antes o después del vencimiento en que pagaste cada mes<\/caption>/);
    assert.match(render(VistaPuntualidad, { data: datos([mes(2026, 10, { estado: 'vencido' })]) }), /Aún no hay pagos para medir/);
  });

  it('con unidades en monedas distintas, las pestañas de dinero piden elegir una unidad en vez de sumar monedas', () => {
    const dos = datos(unMes.meses, { moneda: null, resumen: resumen({ pagado: null, promedio_mes: null, deuda_actual: null, en_revision: null, por_moneda: { PEN: { pagado: '10.00', promedio_mes: '10.00', deuda_actual: '0.00', en_revision: '0.00' }, USD: { pagado: '5.00', promedio_mes: '5.00', deuda_actual: '0.00', en_revision: '0.00' } } }) });
    for (const V of [VistaResumen, VistaPorConcepto, VistaAcumulado]) assert.match(render(V, { data: dos }), /monedas distintas/);
    assert.equal(canvas(render(VistaResumen, { data: dos })), 0);
  });

  it('los filtros: la unidad sólo con más de una; el periodo, con más de un año; el Excel, con meses', () => {
    const f = (data: Historial, extra: Record<string, unknown> = {}) => render(FiltrosHistorial, { data, unidad: '', anio: '', setUnidad: () => undefined, setAnio: () => undefined, consulta: '', error: null, onRetry: () => undefined, ...extra });
    assert.doesNotMatch(f(unMes), /Todas mis unidades|Últimos 12 meses/);
    assert.match(f(unMes), /Descargar Excel/);
    const html = f({ ...docemeses, unidades: [{ id: 1, codigo: 'H-1', estructura: { id: 1, nombre: 'Block 1' } }, { id: 2, codigo: 'H-2', estructura: null }] });
    assert.match(html, /Todas mis unidades/);
    assert.match(html, /H-1 · Block 1/);
    assert.match(html, /Últimos 12 meses/);
    assert.match(html, /<option value="2025">2025<\/option>/);
    assert.equal(f(datos([], { unidades: [], anios: [] })), '', 'sin meses ni filtros: nada que mostrar');
    assert.doesNotMatch(f(datos([], { unidades: [], anios: [] }), { error: null }), /Descargar Excel/);
  });

  it('un error al cambiar de filtro se avisa con «Reintentar»', () => {
    const html = render(FiltrosHistorial, { data: unMes, unidad: '', anio: '', setUnidad: () => undefined, setAnio: () => undefined, consulta: '', error: 'No se pudo cargar', onRetry: () => undefined });
    assert.match(html, /No se pudo cargar/);
    assert.match(html, /Reintentar/);
  });

  it('la pantalla: seis pestañas en orden (Pagos al final) y la barra se desplaza en el celular en vez de ensanchar la página', () => {
    // `HistorialResidente` importa `api.ts` (necesita `import.meta.env` de Vite): el orden se lee de la fuente y la barra se renderiza de verdad.
    const h = fuente('src/pages/residente/_parts/HistorialResidente.tsx');
    const ids = [...h.slice(h.indexOf('const VISTAS'), h.indexOf('export function')).matchAll(/\{ id: '(\w+)', label: '([^']+)'/g)].map(m => m[2]);
    assert.deepEqual(ids, ['Resumen', 'Por concepto', 'Acumulado', 'Agua', 'Puntualidad']);
    assert.ok(h.includes("{ id: 'pagos', label: 'Pagos' }") && h.indexOf("{ id: 'pagos', label: 'Pagos' }") > h.indexOf('...VISTAS.map'), 'Pagos va después de los gráficos');
    const barra = render(Tabs, { value: 'resumen', onChange: () => undefined, items: ids.map(l => ({ id: l, label: l! })), idBase: 'historial' });
    assert.match(barra, /role="tablist"[^>]*class="[^"]*max-w-full[^"]*overflow-x-auto/);
    assert.equal((barra.match(/shrink-0 whitespace-nowrap/g) ?? []).length, 5, 'ninguna pestaña se parte en dos líneas ni se encoge');
  });
});

describe('cableado: menú, rutas, gráficos y prompt', () => {
  it('el menú de propietario e inquilino dice «Mi historial» en las mismas rutas', () => {
    const nav = fuente('src/app/nav.ts');
    assert.ok(nav.includes("{ to: '/propietario/pagos', label: 'Mi historial', icon: ChartBarIcon }"));
    assert.ok(nav.includes("{ to: '/inquilino/pagos', label: 'Mi historial', icon: ChartBarIcon }"));
    assert.ok(!nav.includes("label: 'Mis pagos'"));
  });

  it('las dos rutas /pagos muestran HistorialResidente; la tabla de pagos sigue en la pestaña «Pagos»', () => {
    for (const rol of ['propietario', 'inquilino']) {
      const p = fuente(`src/pages/${rol}/Pagos.tsx`);
      assert.ok(p.includes('<HistorialResidente />') && !p.includes('PagosResidente'), rol);
    }
    const h = fuente('src/pages/residente/_parts/HistorialResidente.tsx');
    assert.ok(h.includes('<PagosResidente />'));
    assert.ok(h.includes("{ id: 'pagos', label: 'Pagos' }"));
    assert.ok(h.includes('<PageHeader title="Mi historial"'));
    assert.ok(!fuente('src/pages/residente/_parts/PagosResidente.tsx').includes('<PageHeader'), 'un solo título por pantalla');
  });

  it('el Excel se baja con los mismos filtros que se ven', () => {
    const g = fuente('src/pages/residente/_parts/HistorialFiltros.tsx');
    assert.ok(g.includes('window.location.assign(`/api/me/historial.xlsx${consulta}`)'));
    const h = fuente('src/pages/residente/_parts/HistorialResidente.tsx');
    assert.ok(h.includes("sp.set('unidad_id', unidad)") && h.includes("sp.set('anio', anio)"));
    assert.equal(h.split('useResource<Historial>(').length - 1, 1, 'una sola llamada a la API para todas las pestañas');
    assert.ok(h.includes('useResource<Historial>(`/api/me/historial${consulta}`)'));
    for (const f of ['HistorialGraficos', 'HistorialConceptos', 'HistorialAcumulado', 'HistorialAguaPuntualidad']) assert.ok(!fuente(`src/pages/residente/_parts/${f}.tsx`).includes('useResource'), `${f} no pide datos: recibe la respuesta compartida`);
  });

  it('BarChart: `stacked` apila ambos ejes y suma el total; los usos viejos (token brand/muted) siguen igual', () => {
    const b = fuente('src/ui/BarChart.tsx');
    assert.ok(b.includes('x: { stacked,') && b.includes('y: { stacked,'));
    assert.ok(b.includes('Total: '));
    assert.ok(b.includes('precision: 0'), 'ticks enteros opcionales (puntualidad con un solo mes)');
    assert.ok(fuente('src/pages/residente/_parts/HistorialAguaPuntualidad.tsx').includes('format={diasCorto} enteros'));
    assert.ok(b.includes("s.token === 'brand' ? color('brand')") && b.includes("color('line')"), 'brand y muted como antes');
    for (const f of ['src/pages/admin/Dashboard.tsx', 'src/pages/superadmin/Dashboard.tsx']) {
      assert.ok(/token: '(brand|muted)'/.test(fuente(f)), `${f} sigue pasando token`);
    }
    assert.ok(fuente('src/ui/index.ts').includes("export * from './LineChart'"));
  });

  it('LineChart: línea con puntos visibles (un solo mes), huecos sin caer a cero y redibujo al cambiar de tema', () => {
    const l = fuente('src/ui/LineChart.tsx');
    assert.ok(l.includes("type: 'line'") && l.includes('pointRadius: 4') && l.includes('spanGaps: false'));
    assert.ok(l.includes('new MutationObserver(draw)'));
    assert.ok(l.includes('borderDash: s.punteada'));
  });

  it('la paleta de categorías cambia con el tema (claro 0.55 / oscuro 0.74) y tiene gris para «Otros»', () => {
    const t = fuente('src/ui/chartTema.ts');
    assert.ok(t.includes('oscuro ? 0.74 : 0.55'));
    assert.ok(t.includes('CATEGORIA_OTROS = -1'));
  });

  it('el asistente y el formato de WhatsApp nombran «Mi historial», no «Mis pagos»', () => {
    const prompt = fuente('src/config/ai-system-prompt.txt');
    assert.ok(prompt.includes('[Mi historial](/propietario/pagos)') && prompt.includes('[Mi historial](/inquilino/pagos)'));
    assert.ok(!prompt.includes('[Mis pagos]'));
    assert.ok(fuente('src/server/services/canales/formato.ts').includes('[Mi historial](/propietario/pagos)'));
  });
});
