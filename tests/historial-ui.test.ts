// «Mi historial» (propietario e inquilino): las cuentas de las series, el render de verdad (react-dom/server) con 1 y con 12+ meses, y el cableado
// (menú, rutas, prompt del asistente, BarChart apilado, LineChart). El repo no tiene testing-library: lo visual se fija con markup y con fuente.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import { cifras, diasCorto, ejeMeses, seriesAgua, seriesPorConcepto, seriesPuntualidad, textoDias } from '../src/pages/residente/_parts/historial';
import type { Historial, MesHistorial, ResumenHistorial } from '../src/pages/residente/_parts/historial';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

let VistaResumen: typeof import('../src/pages/residente/_parts/HistorialGraficos').VistaResumen;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ VistaResumen } = await import('../src/pages/residente/_parts/HistorialGraficos'));
});

const mes = (anio: number, m: number, extra: Partial<MesHistorial> = {}): MesHistorial => ({
  recibo_id: anio * 100 + m, anio, mes: m, unidad: { id: 1, codigo: 'H-1' }, total: '100.00', por_concepto: [{ concepto: 'Agua', monto: '40.00' }, { concepto: 'Limpieza', monto: '60.00' }],
  pagado: '100.00', saldo: '0.00', estado: 'pagado', fecha_vencimiento: `${anio}-${String(m).padStart(2, '0')}-10`, fecha_pago: null, dias_vs_vencimiento: null, agua_m3: null, agua_promedio_block: null, ...extra,
});

const resumen = (extra: Partial<ResumenHistorial> = {}): ResumenHistorial => ({
  pagado: '100.00', promedio_mes: '100.00', deuda_actual: '0.00', en_revision: '0.00', meses_a_tiempo: 1, meses_evaluados: 1, meses_en_periodo: 1, agua_promedio_m3: null, ...extra,
});

const datos = (meses: MesHistorial[], extra: Partial<Historial> = {}): Historial => ({
  unidades: [{ id: 1, codigo: 'H-1', estructura: null }], anios: [2026], anio: null, resumen: resumen({ meses_en_periodo: new Set(meses.map(m => `${m.anio}-${m.mes}`)).size }), meses, ...extra,
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

const vista = (data: Historial, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(VistaResumen, { data, loading: false, error: null, onRetry: () => undefined, unidad: '', anio: '', setUnidad: () => undefined, setAnio: () => undefined, consulta: '', ...extra }));

describe('render de «Mi historial» (react-dom/server)', () => {
  const unMes = datos([mes(2026, 10, { fecha_pago: '2026-10-08T15:00:00.000Z', dias_vs_vencimiento: -2 })]);
  const docemeses = datos(Array.from({ length: 14 }, (_, i) => mes(2025 + Math.floor((i + 4) / 12), ((i + 4) % 12) + 1, { dias_vs_vencimiento: (i % 5) - 2, agua_m3: String(8 + i), agua_promedio_block: '10.000' })).slice(-12), { anios: [2026, 2025] });

  it('con un solo mes: las cifras, los tres gráficos (con su tabla accesible) y un aviso amable', () => {
    const html = vista(unMes);
    for (const t of ['Pagado', 'Promedio por mes', 'Deuda de hoy', 'Puntualidad', 'Cuánto pagas cada mes', 'Agua', 'Puntualidad']) assert.ok(html.includes(t), `falta «${t}»`);
    assert.equal((html.match(/<canvas/g) ?? []).length, 2, 'dos canvas: por concepto y puntualidad (el agua no tiene lecturas)');
    assert.match(html, /Este es tu primer mes en House/);
    assert.match(html, /Aún no hay lecturas de agua/, 'sin lecturas: estado vacío amable, no un gráfico roto');
    assert.match(html, /<div class="sr-only"><table><caption>Cuánto pagas cada mes, por concepto<\/caption>/, 'la tabla va dentro de un div sr-only: una <table> sr-only no recorta y ensancha la página en el celular');
    assert.match(html, /Descargar Excel/);
  });

  it('con 12 meses: sin aviso de primer mes, los tres canvas y el eje de meses en la tabla accesible', () => {
    const html = vista(docemeses);
    assert.doesNotMatch(html, /primer mes/);
    assert.equal((html.match(/<canvas/g) ?? []).length, 3);
    assert.equal((html.match(/<th scope="row">[A-Z][a-z]+ \d\d<\/th>/g) ?? []).length >= 12, true, 'los meses cruzan años: «Nov 25»…');
    assert.doesNotMatch(html, /Aún no hay lecturas de agua/);
    assert.match(html, /El promedio del block aparece cuando hay al menos 3 lecturas/);
  });

  it('sin meses: estado vacío, ni cifras ni gráficos ni botón de Excel', () => {
    const html = vista(datos([], { unidades: [], anios: [] }));
    assert.match(html, /Aún no tienes recibos/);
    assert.doesNotMatch(html, /<canvas|Descargar Excel|Deuda de hoy/);
  });

  it('el filtro de unidad sólo aparece con más de una; el de periodo, con más de un año', () => {
    assert.doesNotMatch(vista(unMes), /Todas mis unidades|Últimos 12 meses/);
    const html = vista(docemeses, { data: { ...docemeses, unidades: [{ id: 1, codigo: 'H-1', estructura: { id: 1, nombre: 'Block 1' } }, { id: 2, codigo: 'H-2', estructura: null }] } });
    assert.match(html, /Todas mis unidades/);
    assert.match(html, /H-1 · Block 1/);
    assert.match(html, /Últimos 12 meses/);
    assert.match(html, /<option value="2025">2025<\/option>/);
  });

  it('un error al cambiar de filtro se avisa sin esconder lo que ya se veía', () => {
    const html = vista(unMes, { error: 'No se pudo cargar' });
    assert.match(html, /No se pudo cargar/);
    assert.match(html, /Reintentar/);
    assert.match(html, /Cuánto pagas cada mes/);
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
    const g = fuente('src/pages/residente/_parts/HistorialGraficos.tsx');
    assert.ok(g.includes('window.location.assign(`/api/me/historial.xlsx${consulta}`)'));
    const h = fuente('src/pages/residente/_parts/HistorialResidente.tsx');
    assert.ok(h.includes("sp.set('unidad_id', unidad)") && h.includes("sp.set('anio', anio)"));
    assert.ok(h.includes('useResource<Historial>(`/api/me/historial${consulta}`)'));
  });

  it('BarChart: `stacked` apila ambos ejes y suma el total; los usos viejos (token brand/muted) siguen igual', () => {
    const b = fuente('src/ui/BarChart.tsx');
    assert.ok(b.includes('x: { stacked,') && b.includes('y: { stacked,'));
    assert.ok(b.includes('Total: '));
    assert.ok(b.includes('precision: 0'), 'ticks enteros opcionales (puntualidad con un solo mes)');
    assert.ok(fuente('src/pages/residente/_parts/HistorialGraficos.tsx').includes('format={diasCorto} enteros'));
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
