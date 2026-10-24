import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { esTeclaDeActivar, moverTab, porcentaje, vieneDeControlInterno } from '../src/ui/a11y';
// @ts-expect-error — módulo .mjs sin tipos (script de línea de comandos reutilizable)
import { calcular, contraste, oklchASrgb } from '../scripts/contraste.mjs';

describe('Tabs: navegación por teclado (WAI-ARIA)', () => {
  it('flechas mueven una pestaña y dan la vuelta en los extremos', () => {
    assert.equal(moverTab('ArrowRight', 0, 3), 1);
    assert.equal(moverTab('ArrowRight', 2, 3), 0);
    assert.equal(moverTab('ArrowLeft', 1, 3), 0);
    assert.equal(moverTab('ArrowLeft', 0, 3), 2);
  });
  it('Inicio y Fin saltan a los extremos; otras teclas no navegan', () => {
    assert.equal(moverTab('Home', 2, 4), 0);
    assert.equal(moverTab('End', 0, 4), 3);
    assert.equal(moverTab('Tab', 0, 4), null);
    assert.equal(moverTab('Enter', 0, 4), null);
    assert.equal(moverTab('ArrowRight', 0, 0), null);
  });
});

describe('DataTable: fila clicable', () => {
  const fila = { closest: () => null };
  const dentroDe = (selector: string) => ({ closest: (s: string) => (s.includes(selector) ? { es: 'control' } : null) });
  it('un botón o enlace interno NO dispara la fila; la celda sí', () => {
    assert.equal(vieneDeControlInterno(dentroDe('button'), fila), true);
    assert.equal(vieneDeControlInterno(dentroDe('a[href]'), fila), true);
    assert.equal(vieneDeControlInterno({ closest: () => null }, fila), false);
  });
  it('el evento de la propia fila no cuenta como interno', () => {
    assert.equal(vieneDeControlInterno(fila, fila), false);
    assert.equal(vieneDeControlInterno({ closest: () => fila }, fila), false);
  });
  it('sólo Enter y Espacio activan', () => {
    assert.equal(esTeclaDeActivar('Enter'), true);
    assert.equal(esTeclaDeActivar(' '), true);
    assert.equal(esTeclaDeActivar('a'), false);
  });
});

describe('ProgressBar: porcentaje', () => {
  it('acota a 0–100 y tolera valores inválidos', () => {
    assert.equal(porcentaje(50, 200), 25);
    assert.equal(porcentaje(300, 200), 100);
    assert.equal(porcentaje(-5, 100), 0);
    assert.equal(porcentaje(10, 0), 0);
    assert.equal(porcentaje(Number.NaN, 100), 0);
  });
});

describe('Contraste WCAG', () => {
  it('el cálculo coincide con valores de referencia (blanco/negro = 21:1, mismo color = 1:1)', () => {
    const blanco = oklchASrgb(1, 0, 0);
    const negro = oklchASrgb(0, 0, 0);
    assert.ok(Math.abs(contraste(blanco, negro) - 21) < 0.01);
    assert.ok(Math.abs(contraste(blanco, blanco) - 1) < 1e-9);
  });
  it('todos los pares texto/fondo del sistema llegan a 4.5:1, en claro y en oscuro', () => {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const filas = calcular(css) as { tema: string; fg: string; bg: string; razon: number }[];
    assert.ok(filas.length >= 30);
    const malos = filas.filter(f => f.razon < 4.5).map(f => `${f.tema} ${f.fg}/${f.bg} ${f.razon.toFixed(2)}`);
    assert.deepEqual(malos, []);
  });
});
