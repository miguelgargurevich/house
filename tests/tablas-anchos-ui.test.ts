// Anchos de las tablas: las columnas se muestran según el ancho del CONTENEDOR de la tabla (no de la ventana, que con la barra lateral y
// el asistente abiertos sobrestima lo que hay) y el contenido usa el ancho de la ventana hasta 1600 px. Tests de fuente, como el resto de la UI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const css = fuente('src/index.css');
const tabla = fuente('src/ui/DataTable.tsx');

// Cada hideBelow oculta su columna por debajo de este ancho de contenedor.
const UMBRALES = { sm: 480, md: 640, lg: 800, xl: 960 } as const;

describe('ancho de las tablas', () => {
  it('cada hideBelow oculta su columna por debajo de su umbral de contenedor (480/640/800/960 px)', () => {
    for (const [nivel, px] of Object.entries(UMBRALES)) {
      assert.match(tabla, new RegExp(`${nivel}: 'col-desde-${nivel}'`), `DataTable mapea ${nivel} a col-desde-${nivel}`);
      assert.match(css, new RegExp(`@container \\(max-width: ${px - 1}px\\) \\{ \\.col-desde-${nivel} \\{ display: none; \\} \\}`), `index.css oculta col-desde-${nivel} bajo ${px} px`);
    }
  });

  it('las columnas no dependen de la ventana: nada de table-cell ni de prefijos sm:/md:/lg:/xl: en las celdas', () => {
    assert.doesNotMatch(tabla, /table-cell|\b(sm|md|lg|xl):(px-|hidden|table)/);
  });

  it('la tabla es el contenedor (container-type) para que sus @container lean su propio ancho', () => {
    assert.match(tabla, /<div className="tabla-contenedor">/);
    assert.match(css, /\.tabla-contenedor \{ container-type: inline-size; \}/);
  });

  it('el relleno de las celdas se afloja con el contenedor (0.75 → 1 → 1.25 rem en 640 y 960 px) y las celdas parten textos largos', () => {
    assert.match(css, /\.tabla-celda \{ padding-inline: 0\.75rem; overflow-wrap: anywhere; \}/);
    assert.match(css, /@container \(min-width: 640px\) \{ \.tabla-celda \{ padding-inline: 1rem; \} \}/);
    assert.match(css, /@container \(min-width: 960px\) \{ \.tabla-celda \{ padding-inline: 1\.25rem; \} \}/);
  });

  it('el contenido usa el ancho de la ventana hasta 1600 px (antes max-w-6xl, 1152 px)', () => {
    const shell = fuente('src/app/Shell.tsx');
    assert.match(shell, /<main id="contenido" className="mx-auto w-full max-w-\[1600px\] px-4 py-6 lg:px-8 lg:py-8">/);
    assert.doesNotMatch(shell, /<main id="contenido"[^>]*max-w-6xl/);
  });
});
