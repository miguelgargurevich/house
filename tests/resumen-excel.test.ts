// Ventana de subida del Excel: el resumen tras crear el recibo y la lista de advertencias.
// El repo no tiene testing-library: el render se fija con una prueba de fuente, y la lógica con funciones puras.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resumenSubida, type ResultadoExcel } from '../src/pages/admin/_parts/cobranza/resumenExcel';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

const base: ResultadoExcel = {
  recibo_id: 7, mes: 10, anio: 2026, unidades_procesadas: 32, filas_saltadas: 1, conceptos: 9,
};

describe('resumenSubida: título y línea de conteo', () => {
  it('el título nombra el mes en español y el año', () => {
    assert.equal(resumenSubida(base).titulo, 'Recibo de octubre de 2026 cargado');
  });

  it('plural en departamentos y en filas saltadas', () => {
    assert.equal(resumenSubida(base).linea, '32 departamentos cargados · 1 fila saltada');
    assert.equal(resumenSubida({ ...base, filas_saltadas: 4 }).linea, '32 departamentos cargados · 4 filas saltadas');
  });

  it('singular cuando hay un solo departamento', () => {
    assert.equal(resumenSubida({ ...base, unidades_procesadas: 1, filas_saltadas: 0 }).linea, '1 departamento cargado');
  });

  it('sin filas saltadas, la línea no menciona filas', () => {
    assert.equal(resumenSubida({ ...base, filas_saltadas: 0 }).linea, '32 departamentos cargados');
  });
});

describe('resumenSubida: advertencias', () => {
  it('sin advertencias devuelve lista vacía', () => {
    assert.deepEqual(resumenSubida({ ...base, advertencias: [] }).advertencias, []);
  });

  it('una respuesta vieja, sin el campo, no se rompe: lista vacía', () => {
    assert.deepEqual(resumenSubida(base).advertencias, []);
  });

  it('pasa las advertencias tal cual, incluida la última de «y N advertencias más» (100 + 1)', () => {
    const cien = Array.from({ length: 100 }, (_, i) => `B.1 Dpto. ${i}: no existe la unidad; se saltó la fila`);
    const con = [...cien, '… y 5 advertencias más'];
    const salida = resumenSubida({ ...base, advertencias: con }).advertencias;
    assert.equal(salida.length, 101);
    assert.deepEqual(salida, con);
  });
});

describe('SubirExcelModal: muestra el resumen y las advertencias', () => {
  const modal = fuente('src/pages/admin/_parts/cobranza/SubirExcelModal.tsx');

  it('usa resumenSubida y el tipo compartido', () => {
    assert.ok(modal.includes("import { resumenSubida, type ResultadoExcel } from './resumenExcel'"));
    assert.ok(modal.includes('resumenSubida(resultado)'));
    assert.ok(modal.includes("api<ResultadoExcel>('/api/recibos/excel'"));
  });

  it('con advertencias, un aviso (warn) con el conteo y la lista renderizada', () => {
    assert.ok(modal.includes('resumen.advertencias.length > 0'), 'la rama de aviso');
    assert.ok(modal.includes('<Alert tone="warn">'), 'tono de aviso');
    assert.ok(modal.includes('Revisa estas filas ({resumen.advertencias.length})'), 'el encabezado con el conteo');
    assert.ok(modal.includes('resumen.advertencias.map((a, i) => <li key={i}>{a}</li>)'), 'cada advertencia es un ítem');
    assert.ok(modal.includes('max-h-48 overflow-y-auto'), 'la lista tiene scroll');
  });

  it('sin advertencias, el resumen en verde', () => {
    assert.ok(modal.includes('resumen.advertencias.length === 0'), 'la rama sin advertencias');
    assert.ok(modal.includes('<Card className="sm:col-span-2 bg-ok/5'), 'tarjeta verde');
  });

  it('un error (p. ej. el 409 de recibo con pagos) muestra su texto', () => {
    assert.ok(modal.includes('setError(errorText(e))'), 'el error pasa por errorText');
    assert.ok(modal.includes('{error && <Alert tone="bad">{error}</Alert>}'), 'se pinta en el aviso rojo');
  });
});
