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
