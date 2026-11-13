import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 2026-11-12, Miguel: «se hace zoom al escribir en un input pero no se regresa a la vista normal». iOS acerca la vista al enfocar un campo
// con letra < 16 px. La regla de `src/index.css` sube los campos a 16 px en pantallas táctiles. Se fija la REGLA, no el comentario.
const css = readFileSync('src/index.css', 'utf8');

test('en pantallas táctiles los campos van a 16 px como mínimo (sin auto-zoom de iOS)', () => {
  const i = css.indexOf('@media (hover: none) and (pointer: coarse) {\n  input:not(');
  assert.ok(i >= 0, 'falta la media query táctil con los campos');
  const regla = css.slice(i, css.indexOf('}', i) + 1);
  assert.match(regla, /textarea,\s*\n\s*select,/);
  assert.ok(regla.includes('font-size: max(16px, 1em) !important;'));
});

test('no se bloquea el zoom con los dedos: el viewport no lleva maximum-scale ni user-scalable=no', () => {
  assert.doesNotMatch(readFileSync('index.html', 'utf8'), /maximum-scale|user-scalable=no/);
});

// 2026-11-13, Miguel con capturas del iPhone: en «Emitir recibo» las fechas se salían del modal y los tres botones del pie se partían mal.
test('las fechas no se salen de su columna en iOS: sin appearance nativa y con min-width 0', () => {
  const i = css.indexOf('input[type="date"],\ninput[type="datetime-local"]');
  assert.ok(i >= 0, 'falta la regla de los campos de fecha');
  const regla = css.slice(i, css.indexOf('}', i) + 1);
  assert.ok(regla.includes('appearance: none;'));
  assert.ok(regla.includes('min-width: 0;'));
});

test('el pie del modal apila los botones a lo ancho en el celular y vuelve a la fila desde sm', () => {
  const modal = readFileSync('src/ui/Modal.tsx', 'utf8');
  const pie = modal.slice(modal.indexOf('<div data-modal-pie=""'), modal.indexOf('{footer}</div>'));
  assert.ok(pie.includes('flex-col-reverse'));
  assert.ok(pie.includes('[&>*]:w-full'));
  assert.ok(pie.includes('sm:flex-row'));
  assert.ok(pie.includes('sm:[&>*]:w-auto'));
});
