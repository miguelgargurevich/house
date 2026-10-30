// Consolidado del block en pantalla e impreso: se renderizan los componentes de verdad (react-dom/server) y se mira el HTML; el CSS de impresión se lee
// del archivo; y se comprueba que NINGUNA pantalla de residentes lo conoce (sólo administración y junta).
import './helpers/env';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import type { Consolidado } from '../src/pages/admin/_parts/consolidado/tipos';
import type { DetalleMantenimiento } from '../src/pages/shared/mantenimiento/tipos';
import { letraConsolidadoPt } from '../src/pages/admin/_parts/consolidado/escala';
import { blockCorto } from '../src/pages/admin/_parts/consolidado/formato';

// tsx compila el JSX con `React.createElement`: se deja `React` global y se importan los componentes después.
let HojaConsolidado: typeof import('../src/pages/admin/_parts/consolidado/HojaConsolidado').HojaConsolidado;
let DocumentoBlock: typeof import('../src/pages/admin/_parts/consolidado/DocumentoBlock').DocumentoBlock;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ HojaConsolidado } = await import('../src/pages/admin/_parts/consolidado/HojaConsolidado'));
  ({ DocumentoBlock } = await import('../src/pages/admin/_parts/consolidado/DocumentoBlock'));
});

const CONCEPTOS = ['ADMINISTRACION', 'LUZ AREAS COMUNES DEL CONDOMINIO', 'AGUA DPTO.', 'MULTA PAGO FUERA DE FECHA'];
const fila = (id: number, dpto: string, nombre: string, montos: string[], deuda = '0.00') => {
  const mant = montos.reduce((s, m) => s + Number(m), 0);
  return { unidad_id: id, codigo: `B01-${dpto}`, block: 'Block 1', dpto, propietario: nombre, montos, total_mant: mant.toFixed(2), deuda_acumulada: deuda, total: (mant + Number(deuda)).toFixed(2) };
};
const consolidado = (n = 3): Consolidado => {
  const filas = Array.from({ length: n }, (_, i) => fila(i + 1, String(101 + i), `VECINO PRUEBA ${i + 1}`, ['123.69', '8.55', String(70 + i), i === 1 ? '20.00' : '0.00'], i === 2 ? '60.00' : '0.00'));
  const col = (k: number) => filas.reduce((s, f) => s + Number(f.montos[k]), 0).toFixed(2);
  const totalMant = filas.reduce((s, f) => s + Number(f.total_mant), 0);
  const deuda = filas.reduce((s, f) => s + Number(f.deuda_acumulada), 0);
  return {
    recibo_id: 7, empresa: 'GRUPO PRUEBA SAC', condominio: 'CONDOMINIO LOS OLIVOS', block: 'Block 1', mes: 10, anio: 2026, fecha_vencimiento: '2026-11-02T00:00:00.000Z', moneda: 'PEN',
    conceptos: CONCEPTOS.map((nombre, i) => ({ id: i + 1, nombre, es_recargo: i === 3 })), filas,
    totales: { montos: CONCEPTOS.map((_, k) => col(k)), total_mant: totalMant.toFixed(2), deuda_acumulada: deuda.toFixed(2), total: (totalMant + deuda).toFixed(2) },
  };
};
const html = (c: Consolidado, o: { resaltar?: number; impresion?: boolean } = {}) => renderToStaticMarkup(createElement(HojaConsolidado, { c, ...o }));
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toUpperCase();

describe('consolidado en pantalla y en papel: la tabla del Excel', () => {
  it('trae título, MES, VENCIMIENTO, el encabezado en dos filas, una fila por departamento y TOTALES, en ese orden', () => {
    const t = texto(html(consolidado()));
    const orden = [
      'GRUPO PRUEBA SAC', 'MANTENIMIENTO DE OCTUBRE 2026', 'CONDOMINIO LOS OLIVOS · BLOCK 1', 'MES', 'OCTUBRE', 'VENCIMIENTO:', '02 DE NOVIEMBRE DE 2026',
      'BLOCK', 'DPTO.', 'APELLIDOS Y NOMBRES', 'CONCEPTOS POR COBRAR', 'ADMINISTRACION', 'LUZ AREAS COMUNES DEL CONDOMINIO', 'AGUA DPTO.', 'MULTA PAGO FUERA DE FECHA',
      'TOTAL MANT', 'DEUDA ACUMULADA', 'TOTAL', 'B.1', '101', 'VECINO PRUEBA 1', '123.69', '8.55', '70.00', '202.24', '102', 'VECINO PRUEBA 2', '20.00', '103', 'VECINO PRUEBA 3', '60.00', 'TOTALES',
    ];
    let desde = 0;
    for (const x of orden) {
      const i = t.indexOf(x, desde);
      assert.ok(i >= 0, `falta «${x}» (o está fuera de orden) después de la posición ${desde}`);
      desde = i;
    }
  });

  it('el encabezado «Conceptos por cobrar» abarca todas las columnas de conceptos y de totales; BLOCK, Dpto. y Nombres ocupan las dos filas', () => {
    const h = html(consolidado());
    assert.match(h, /<th[^>]*rowspan="2"[^>]*>BLOCK<\/th>/i);
    assert.match(h, /<th[^>]*rowspan="2"[^>]*>Dpto\.<\/th>/i);
    assert.match(h, /<th[^>]*colspan="7"[^>]*>Conceptos por cobrar<\/th>/i, '4 conceptos + TOTAL MANT + DEUDA ACUMULADA + TOTAL');
    assert.equal((h.match(/<th[^>]*scope="col"/g) ?? []).length, 3 + 4 + 3, 'una cabecera por columna');
  });

  it('una celda de monto por concepto en cada fila, con 2 decimales, y la fila de TOTALES suma las columnas', () => {
    const c = consolidado();
    const h = html(c);
    const filas = [...h.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((m) => m[1]!);
    const celdas = (tr: string) => [...tr.matchAll(/<(?:td|th)[^>]*>(.*?)<\/(?:td|th)>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));
    const datos = filas.map(celdas).filter((f) => f[0] === 'B.1');
    assert.equal(datos.length, 3);
    assert.deepEqual(datos[1], ['B.1', '102', 'VECINO PRUEBA 2', '123.69', '8.55', '71.00', '20.00', '223.24', '0.00', '223.24']);
    const totales = filas.map(celdas).find((f) => f[0] === 'TOTALES')!;
    assert.deepEqual(totales.slice(1), [...c.totales.montos, c.totales.total_mant, c.totales.deuda_acumulada, c.totales.total]);
  });

  it('el departamento resaltado (la hoja de SU recibo) sale en negrita y gris; los demás no', () => {
    const h = html(consolidado(), { resaltar: 2, impresion: true });
    const filas = [...h.matchAll(/<tr class="([^"]*)">/g)].map((m) => m[1]!);
    assert.equal(filas.filter((c) => /font-bold/.test(c) && /bg-neutral-200/.test(c)).length >= 1, true);
    const cuerpo = h.slice(h.indexOf('<tbody>'), h.indexOf('</tbody>'));
    const marcadas = [...cuerpo.matchAll(/<tr class="([^"]*)">(.*?)<\/tr>/g)].filter((m) => /font-bold/.test(m[1]!));
    assert.equal(marcadas.length, 1);
    assert.ok(marcadas[0]![2]!.includes('VECINO PRUEBA 2'));
  });

  it('impreso lleva la letra ajustada a la cantidad de filas y columnas fijas; en pantalla no', () => {
    const imp = html(consolidado(56), { impresion: true });
    assert.match(imp, new RegExp(`font-size:${letraConsolidadoPt(56)}pt`));
    assert.match(imp, /<colgroup>/);
    assert.match(imp, /table-fixed/);
    const pant = html(consolidado(56));
    assert.doesNotMatch(pant, /font-size:/);
    assert.doesNotMatch(pant, /<colgroup>/);
    assert.match(pant, /w-max/, 'en pantalla la tabla se ensancha (con scroll horizontal en el contenedor)');
  });

  it('el block se muestra como en el Excel («Block 1» → «B.1»)', () => {
    assert.equal(blockCorto('Block 1'), 'B.1');
    assert.equal(blockCorto('Torre 12'), 'B.12');
    assert.equal(blockCorto('B.3'), 'B.3');
    assert.equal(blockCorto('Norte'), 'Norte');
    assert.equal(blockCorto(null), '');
  });
});

describe('consolidado impreso: una hoja', () => {
  it('la letra se achica con las filas (9 pt hasta donde alcance, nunca menos de 5.5 pt)', () => {
    assert.equal(letraConsolidadoPt(5), 9);
    assert.ok(letraConsolidadoPt(56) < letraConsolidadoPt(30));
    assert.equal(letraConsolidadoPt(500), 5.5);
    for (let n = 1; n < 120; n++) assert.ok(letraConsolidadoPt(n) >= letraConsolidadoPt(n + 1), `no crece con más filas (${n})`);
  });

  it('la letra para cada tamaño de block es la que se midió imprimiendo con Chrome (A4 horizontal, una sola hoja hasta 60 departamentos)', () => {
    // Medido el 29-oct-2026 (Chrome headless → PDF, 11 conceptos, anchos de `HojaConsolidado`): con estas letras de 4 a 60 departamentos salen en UNA hoja;
    // con 9 pt, 36 ya pasaban a una segunda (el encabezado crece con la letra).
    const medido: [number, number][] = [[4, 9], [20, 9], [32, 9], [35, 9], [36, 8.5], [37, 8.5], [38, 8], [40, 7.5], [44, 7], [48, 6.5], [50, 6], [52, 5.5], [56, 5.5], [60, 5.5]];
    for (const [filas, pt] of medido) assert.equal(letraConsolidadoPt(filas), pt, `${filas} departamentos`);
  });

  it('el CSS de impresión pone el consolidado en A4 horizontal con márgenes estrechos y fuerza el salto de página entre recibo y consolidado', () => {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    assert.match(css, /@page consolidado\s*\{\s*size:\s*A4 landscape;\s*margin:\s*8mm;\s*\}/);
    assert.match(css, /#zona-imprimible \.hoja-consolidado\s*\{\s*page:\s*consolidado;\s*\}/);
    assert.match(css, /\.hoja-consolidado:not\(:first-child\)[^{]*\.hoja-recibo:not\(:first-child\)\s*\{\s*break-before:\s*page;\s*\}/);
    assert.match(css, /@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*16mm;\s*\}/, 'el recibo sigue en A4 vertical');
  });
});

const recibo = (id: number, dpto: string): DetalleMantenimiento => ({
  recibo_id: 7, unidad_id: id, numero: `2026-10-B01-${dpto}`, titulo: `Mantenimiento de octubre de 2026 · B01-${dpto}`, mes: 10, anio: 2026,
  fecha_emision: '2026-10-27T00:00:00.000Z', fecha_vencimiento: '2026-11-02T00:00:00.000Z', fecha_corte_agua: null, estado: 'pendiente', moneda: 'PEN',
  total: '202.24', cobrado: '0.00', en_revision: '0.00', saldo: '202.24', deuda_acumulada: '0.00', total_general: '202.24', agua: null, correo_vouchers: null, linea_mora: null,
  condominio: { id: 1, nombre: 'CONDOMINIO LOS OLIVOS', moneda: 'PEN', direccion: null, notas_pago: null, admin_nombre: null, admin_celular: null, admin_correo: null, cabecera_url: null },
  empresa: { id: 1, nombre: 'GRUPO PRUEBA SAC', ruc: null, direccion: null, telefono: null, email: null, logo_url: null },
  unidad: { id: id, codigo: `B01-${dpto}`, estructura: { id: 1, nombre: 'Block 1' } },
  propietario: { id, nombre: `VECINO PRUEBA ${id}` }, inquilino: null,
  conceptos: [{ cargo_id: id, concepto: 'ADMINISTRACION', es_recargo: false, monto: '123.69', cobrado: '0.00', en_revision: '0.00', saldo: '123.69', motivo: null }], pagos: [], medios_pago: [],
});

describe('imprimir recibos del block: recibo y consolidado, uno tras otro', () => {
  const doc = () => renderToStaticMarkup(createElement(DocumentoBlock, { b: { consolidado: consolidado(3), recibos: [recibo(1, '101'), recibo(2, '102'), recibo(3, '103')] } }));

  it('cada departamento: su recibo y, a continuación, el consolidado (por detrás), en el orden de los departamentos', () => {
    const h = doc();
    const marcas = [...h.matchAll(/<section class="hoja-recibo">|<section aria-label="Consolidado del block" class="hoja-consolidado/g)].map((m) => (m[0].includes('hoja-recibo') ? 'recibo' : 'consolidado'));
    assert.deepEqual(marcas, ['recibo', 'consolidado', 'recibo', 'consolidado', 'recibo', 'consolidado']);
    const recibos = [...h.matchAll(/Recibo de mantenimiento (2026-10-B01-\d+)/g)].map((m) => m[1]);
    assert.deepEqual(recibos, ['2026-10-B01-101', '2026-10-B01-102', '2026-10-B01-103']);
  });

  it('el consolidado que sigue a cada recibo resalta el departamento de ese recibo', () => {
    const partes = doc().split('<section aria-label="Consolidado del block"').slice(1);
    assert.equal(partes.length, 3);
    partes.forEach((p, i) => {
      const cuerpo = p.slice(p.indexOf('<tbody>'), p.indexOf('</tbody>'));
      const resaltadas = [...cuerpo.matchAll(/<tr class="([^"]*)">(.*?)<\/tr>/g)].filter((m) => /font-bold/.test(m[1]!));
      assert.equal(resaltadas.length, 1, `hoja ${i + 1}`);
      assert.ok(resaltadas[0]![2]!.includes(`VECINO PRUEBA ${i + 1}`), `la hoja ${i + 1} resalta al vecino ${i + 1}`);
    });
  });

  it('las hojas del consolidado se imprimen (con letra y columnas fijas de impresión)', () => {
    assert.equal((doc().match(/<colgroup>/g) ?? []).length, 3);
  });
});

describe('privacidad: el consolidado es sólo de administración y junta', () => {
  const sinJs = (ruta: string): string[] => {
    const salida: string[] = [];
    for (const nombre of readdirSync(ruta)) {
      const p = join(ruta, nombre);
      if (statSync(p).isDirectory()) salida.push(...sinJs(p));
      else if (/\.(tsx?|css)$/.test(nombre)) salida.push(p);
    }
    return salida;
  };
  const raiz = new URL('../src/', import.meta.url).pathname;

  it('ninguna pantalla de residentes, de personal ni compartida conoce el consolidado', () => {
    for (const carpeta of ['pages/residente', 'pages/propietario', 'pages/inquilino', 'pages/mantenimiento', 'pages/seguridad', 'pages/publico', 'pages/shared']) {
      for (const f of sinJs(join(raiz, carpeta))) assert.doesNotMatch(readFileSync(f, 'utf8'), /consolidado/i, `${f} menciona el consolidado`);
    }
  });

  it('el servidor no lo ofrece en las rutas del residente (`/api/me/*`)', () => {
    assert.doesNotMatch(readFileSync(join(raiz, 'server/routes/me.ts'), 'utf8'), /consolidado/i);
  });

  it('en la pantalla del periodo está la pestaña «Consolidado del block» y el botón «Imprimir recibos del block» (administración)', () => {
    const f = readFileSync(join(raiz, 'pages/admin/PeriodoRecibo.tsx'), 'utf8');
    assert.match(f, /label: 'Consolidado del block'/);
    assert.match(f, /Imprimir recibos del block/);
    assert.match(f, /<ConsolidadoBlock reciboId=\{reciboId\} bloques=\{blocksElegibles\} \/>/);
    assert.match(f, /<ImprimirRecibosBlock reciboId=\{reciboId\} titulo=\{titulo\} bloques=\{blocksElegibles\}/);
  });
});
