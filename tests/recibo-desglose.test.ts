// La calculadora «Calcula cuánto pagarías»: el total al mes (sin «al año»), el desglose por tramos de departamentos y el promedio por departamento.
// Las sumas se comparan contra el MISMO cálculo del servidor (`cotizar`), con y sin tramo, con 1, 15, 20, 21, 60, 61, 100 y 250 departamentos y en
// una moneda sin decimales. Las etiquetas y la nota son funciones puras de `tramo.ts`; el panel de `Recibo.tsx` no se monta en Node porque arrastra
// `src/api.ts` (necesita `import.meta.env` de Vite): su cableado se lee de la fuente, como en el resto de pruebas de pantalla. Nada sale a la red.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { cotizar } from '../src/server/services/comercial/calculo';
import { desglosar, etiquetaDeFila, notaDelMinimo, type FilaDesglose } from '../src/pages/publico/precios/tramo';

interface Caso { nombre: string; moneda: string; impuesto: string; tasa: string; decimales: number; precio: string; minimo: number; tramo_desde: number | null; tramo_precio: string | null }
const PEN_SIN: Caso = { nombre: 'PEN sin tramo', moneda: 'PEN', impuesto: 'IGV', tasa: '0.18', decimales: 2, precio: '3.00', minimo: 20, tramo_desde: null, tramo_precio: null };
const PEN_TRAMO: Caso = { ...PEN_SIN, nombre: 'PEN con tramo', tramo_desde: 61, tramo_precio: '2.00' };
const CLP_TRAMO: Caso = { nombre: 'CLP con tramo', moneda: 'CLP', impuesto: 'IVA', tasa: '0.19', decimales: 0, precio: '1900', minimo: 20, tramo_desde: 61, tramo_precio: '1500' };
const CASOS = [PEN_SIN, PEN_TRAMO, CLP_TRAMO];
const UNIDADES = [1, 15, 20, 21, 60, 61, 100, 250];

/** La cotización del servidor para un condominio de `unidades` departamentos (la misma llamada que hace `cotizacionPublica`). */
function servidor(unidades: number, k: Caso) {
  const plan = { clave: 'pro', precio_por_unidad: k.precio, igv_incluido: false, modulos_incluidos: [], unidades_minimas: k.minimo, tramo_desde: k.tramo_desde, tramo_precio: k.tramo_precio };
  return cotizar({ unidades, plan, modulosSueltos: [], catalogo: [], tasa: k.tasa, moneda: k.moneda, impuestoNombre: k.impuesto });
}
/** El desglose tal como lo arma la calculadora: con el total sin impuesto que dio el servidor. */
function de(n: number, k: Caso) {
  const c = servidor(n, k);
  return desglosar({ unidades: n, cobradas: c.unidades_cobradas, minimo: k.minimo, precio: k.precio, tramo_desde: k.tramo_desde, tramo_precio: k.tramo_precio, total: c.base, decimales: k.decimales });
}
/** Unidades mínimas de la moneda de un monto en texto («60.00» con 2 decimales → 6000). */
const enMinimos = (monto: string, decimales: number) => Math.round(Number(monto) * 10 ** decimales);
/** Formato de prueba (como `dinero`, con «S/» y el número tal cual): sólo para leer las etiquetas. */
const formato = (monto: string, moneda: string) => `${moneda === 'CLP' ? '$' : 'S/'} ${monto}`;
const fila = (f: FilaDesglose) => [f.desde, f.hasta, f.unidades, f.precio, f.monto, f.base];

describe('desglosar: las filas suman EXACTAMENTE el total del servidor', () => {
  for (const k of CASOS) for (const n of UNIDADES) {
    it(`${k.nombre}, ${n} departamentos`, () => {
      const c = servidor(n, k);
      const d = de(n, k);
      assert.equal(d.cuadra, true, 'la suma de las filas cuadra con el total del servidor');
      const suma = d.filas.reduce((s, f) => s + enMinimos(f.monto, k.decimales), 0);
      assert.equal(suma, enMinimos(c.base, k.decimales), 'al centavo (o al peso)');
      // Las filas cubren los departamentos cobrados, sin huecos ni repetidos.
      assert.equal(d.filas[0].desde, 1);
      assert.equal(d.filas.reduce((s, f) => s + f.unidades, 0), c.unidades_cobradas);
      for (let i = 1; i < d.filas.length; i++) assert.equal(d.filas[i].desde, d.filas[i - 1].hasta + 1, 'filas contiguas');
      // Promedio = total ÷ departamentos reales, a la mitad hacia arriba con los decimales de la moneda.
      assert.equal(d.promedio, new Prisma.Decimal(c.base).div(n).toDecimalPlaces(k.decimales, Prisma.Decimal.ROUND_HALF_UP).toFixed(k.decimales), 'promedio');
    });
  }
});

describe('desglosar: filas exactas en los casos que Miguel miró', () => {
  it('15 departamentos (menos que el mínimo de 20): una sola fila de precio base, promedio con los 15 reales', () => {
    const d = de(15, PEN_SIN);
    assert.deepEqual(d.filas.map(fila), [[1, 20, 20, '3.00', '60.00', true]]);
    assert.equal(d.promedio, '4.00');
  });

  it('20 departamentos (igual al mínimo): también una sola fila de precio base', () => {
    assert.deepEqual(de(20, PEN_SIN).filas.map(fila), [[1, 20, 20, '3.00', '60.00', true]]);
  });

  it('21 departamentos sin tramo: el precio base de los primeros 20 y el resto a precio normal', () => {
    assert.deepEqual(de(21, PEN_SIN).filas.map(fila), [[1, 20, 20, '3.00', '60.00', true], [21, 21, 1, '3.00', '3.00', false]]);
  });

  it('250 departamentos sin tramo (parejo): 60 + 230 × 3 = 750', () => {
    const d = de(250, PEN_SIN);
    assert.deepEqual(d.filas.map(fila), [[1, 20, 20, '3.00', '60.00', true], [21, 250, 230, '3.00', '690.00', false]]);
    assert.equal(d.promedio, '3.00');
  });

  it('250 departamentos con tramo desde el 61 a 2.00: 60 + 40 × 3 + 190 × 2 = 560', () => {
    const d = de(250, PEN_TRAMO);
    assert.deepEqual(d.filas.map(fila), [[1, 20, 20, '3.00', '60.00', true], [21, 60, 40, '3.00', '120.00', false], [61, 250, 190, '2.00', '380.00', false]]);
    assert.equal(d.promedio, '2.24');
  });

  it('pesos chilenos (sin decimales) con tramo: 20 × 1900 + 40 × 1900 + 40 × 1500 = 174000', () => {
    const d = de(100, CLP_TRAMO);
    assert.deepEqual(d.filas.map(fila), [[1, 20, 20, '1900', '38000', true], [21, 60, 40, '1900', '76000', false], [61, 100, 40, '1500', '60000', false]]);
    assert.equal(d.promedio, '1740');
  });

  it('un tramo desde el 1 o antes no existe: el precio es único (igual que el servidor)', () => {
    const d = de(70, { ...PEN_TRAMO, tramo_desde: 1 });
    assert.equal(d.cuadra, true);
    assert.equal(d.filas.at(-1)!.precio, '3.00');
  });

  it('si el total no cuadra con las filas, cuadra es false (la calculadora no muestra el desglose)', () => {
    assert.equal(desglosar({ unidades: 21, cobradas: 21, minimo: 20, precio: '3.00', tramo_desde: null, tramo_precio: null, total: '63.01', decimales: 2 }).cuadra, false);
  });
});

describe('etiquetas y nota del desglose', () => {
  const etiquetas = (n: number, k: Caso) => de(n, k).filas.map((f) => etiquetaDeFila(f, n, k.minimo, k.moneda, formato));

  it('bajo el mínimo o igual: «Precio base · incluye hasta 20» y la nota con el número del condominio', () => {
    assert.deepEqual(etiquetas(15, PEN_SIN), ['Precio base · incluye hasta 20 departamentos']);
    assert.deepEqual(etiquetas(20, PEN_SIN), ['Precio base · incluye hasta 20 departamentos']);
    assert.equal(notaDelMinimo(15, 20), 'Tu condominio tiene 15: pagas el precio base.');
    assert.equal(notaDelMinimo(20, 20), 'Tu condominio tiene 20: pagas el precio base.');
  });

  it('sobre el mínimo: «Departamentos 1 al 20 · precio base», sin la nota', () => {
    assert.deepEqual(etiquetas(21, PEN_SIN), ['Departamentos 1 al 20 · precio base', 'Departamento 21 · S/ 3.00']);
    assert.equal(notaDelMinimo(21, 20), null);
  });

  it('con tramo: las filas dicen rango, cantidad y precio («40 × S/ 3.00», «190 × S/ 2.00»)', () => {
    assert.deepEqual(etiquetas(250, PEN_TRAMO), ['Departamentos 1 al 20 · precio base', 'Departamentos 21 al 60 · 40 × S/ 3.00', 'Departamentos 61 al 250 · 190 × S/ 2.00']);
  });

  it('sin mínimo la nota no aplica; en pesos el precio sale con el formato de la moneda', () => {
    assert.equal(notaDelMinimo(1, 0), null);
    assert.deepEqual(etiquetas(100, CLP_TRAMO), ['Departamentos 1 al 20 · precio base', 'Departamentos 21 al 60 · 40 × $ 1900', 'Departamentos 61 al 100 · 40 × $ 1500']);
  });
});

describe('el panel de Recibo.tsx: cableado y lo que ya no debe estar', () => {
  const r = readFileSync('src/pages/publico/precios/Recibo.tsx', 'utf8');

  it('el desglose sale de la cotización del servidor (total sin impuesto, tramo del plan) y del catálogo (precio y mínimo)', () => {
    assert.match(r, /desglosar\(\{ unidades: n, cobradas: r\.unidades_cobradas, minimo: plan\.unidades_minimas, precio: plan\.precio_por_unidad \?\? '0', tramo_desde: r\.tramo_desde \?\? null, tramo_precio: r\.tramo_precio \?\? null, total: r\.total_mes \?\? '0', decimales: decimalesDe\(moneda\) \}\)/);
  });

  it('muestra el total al mes con el impuesto del país (sin «+ …» si la tasa es 0) y «Con …» aparte', () => {
    assert.match(r, /al mes\{conImpuesto \? ` \+ \$\{r\.impuesto_nombre\}` : ''\}/);
    assert.match(r, /Con \{r\.impuesto_nombre\}: \{dinero\(r\.total_con_igv_mes, moneda\)\}/);
  });

  it('una fila por tramo, el promedio por departamento, y el desglose sólo si cuadra con el servidor', () => {
    assert.match(r, /\{d\.cuadra && \(/);
    assert.match(r, /\{etiquetaDeFila\(f, n, minimo, moneda, dinero\)\}/);
    assert.match(r, /Promedio por departamento<\/dt>/);
    assert.match(r, /\{nota && <p className="mt-3 text-base">\{nota\}<\/p>\}/);
  });

  it('sin el total anual', () => {
    assert.doesNotMatch(r, /al año|total_anio/);
  });
});
