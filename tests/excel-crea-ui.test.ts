// Ventana de subida del Excel cuando faltan blocks o departamentos: el aviso con lo que se crearía y los dos botones, y el resumen de lo creado.
// El repo no tiene testing-library: el render se fija con una prueba de fuente, y la lógica con funciones puras (como resumen-excel.test.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resumenSubida, textoCreado, type CreadoDeExcel, type ResultadoExcel } from '../src/pages/admin/_parts/cobranza/resumenExcel';

const modal = readFileSync('src/pages/admin/_parts/cobranza/SubirExcelModal.tsx', 'utf8');

const creado = (blocks: CreadoDeExcel['blocks']): CreadoDeExcel => ({
  blocks,
  totales: { blocks: blocks.filter(b => b.nuevo).length, pisos: blocks.reduce((s, b) => s + b.pisos, 0), unidades: blocks.reduce((s, b) => s + b.unidades.length, 0), propietarios: blocks.reduce((s, b) => s + b.propietarios, 0) },
});
const base: ResultadoExcel = { recibo_id: 7, mes: 10, anio: 2026, unidades_procesadas: 32, filas_saltadas: 0, conceptos: 9 };

describe('textoCreado / resumenSubida: lo que se creó', () => {
  it('un block nuevo: «Se crearon 1 block (Block 2), 8 pisos, 32 departamentos y 32 propietarios (sin correo ni acceso).»', () => {
    const codigos = Array.from({ length: 32 }, (_, i) => `B02-${i}`);
    assert.equal(
      textoCreado(creado([{ nombre: 'Block 2', nuevo: true, pisos: 8, unidades: codigos, propietarios: 32 }])),
      'Se crearon 1 block (Block 2), 8 pisos, 32 departamentos y 32 propietarios (sin correo ni acceso).',
    );
  });

  it('sólo departamentos en un block que ya existe: no habla de blocks nuevos; singular en 1 departamento', () => {
    assert.equal(
      textoCreado(creado([{ nombre: 'Block 1', nuevo: false, pisos: 0, unidades: ['B01-105'], propietarios: 1 }])),
      'Se crearon 1 departamento y 1 propietario (sin correo ni acceso).',
    );
  });

  it('sin propietarios (filas sin nombre) no los menciona; varios blocks los nombra', () => {
    assert.equal(
      textoCreado(creado([
        { nombre: 'Block 2', nuevo: true, pisos: 1, unidades: ['B02-101'], propietarios: 0 },
        { nombre: 'Block 3', nuevo: true, pisos: 1, unidades: ['B03-101'], propietarios: 0 },
      ])),
      'Se crearon 2 blocks (Block 2, Block 3), 2 pisos y 2 departamentos.',
    );
  });

  it('resumenSubida trae el texto sólo si el servidor creó algo; una respuesta sin `creado` da null', () => {
    assert.equal(resumenSubida(base).creado, null);
    assert.equal(resumenSubida({ ...base, creado: creado([{ nombre: 'Block 2', nuevo: true, pisos: 1, unidades: ['B02-101'], propietarios: 1 }]) }).creado, 'Se crearon 1 block (Block 2), 1 piso, 1 departamento y 1 propietario (sin correo ni acceso).');
  });
});

describe('SubirExcelModal: faltan blocks o departamentos', () => {
  it('reconoce el 409 FALTAN_UNIDADES por su código y muestra el texto del servidor (no lo trata como error rojo)', () => {
    assert.ok(modal.includes("e instanceof ApiError && e.code === 'FALTAN_UNIDADES'"));
    assert.ok(modal.includes('setFaltan(e.message)'));
    assert.ok(modal.includes('<p className="mt-1">{faltan}</p>'));
    assert.ok(modal.includes('Todavía no se creó nada'));
  });

  it('«Crear y cargar el recibo» reenvía el mismo Excel con crear_faltantes=true; «Cargar sin crear», con false', () => {
    assert.ok(modal.includes("if (faltantes) fd.append('crear_faltantes', faltantes)"));
    assert.ok(modal.includes("onClick={() => void subir(undefined, 'true')}"));
    assert.ok(modal.includes("onClick={() => void subir(undefined, 'false')}"));
    assert.ok(modal.includes('Crear y cargar el recibo'));
    assert.ok(modal.includes('Cargar sin crear'));
  });

  it('la primera subida NO manda crear_faltantes (así el servidor sólo avisa) y cambiar de archivo o de condominio descarta el aviso', () => {
    assert.ok(!/fd\.append\('crear_faltantes', '/.test(modal), 'nunca se manda un valor fijo');
    assert.ok(modal.includes('const subir = async (e?: React.FormEvent, faltantes?:'));
    assert.ok(/setArchivo\(f\);\s*setError\(null\);\s*setFaltan\(null\);/.test(modal));
    assert.ok(modal.includes('setComplejoId(e.target.value); setFaltan(null);'));
  });

  it('muestra lo que se creó tras confirmar', () => {
    assert.ok(modal.includes('resumen?.creado'));
    assert.ok(modal.includes('{resumen.creado}'));
  });
});
