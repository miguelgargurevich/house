// Morosidad: clic en una unidad abre el detalle del recibo vencido (uno) o la lista de meses vencidos (varios).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const m = readFileSync('src/pages/admin/Morosidad.tsx', 'utf8');

describe('morosidad: detalle del recibo moroso', () => {
  it('la fila abre el detalle: con un mes directo, con varios la lista de meses', () => {
    assert.match(m, /onRowClick=\{abrir\}/);
    assert.match(m, /if \(m\.recibos\.length === 1\) setDetalle\(/);
    assert.match(m, /<MantenimientoAdminModal reciboId=\{detalle\.reciboId\} unidadId=\{detalle\.unidadId\}/);
    assert.match(m, /header: 'Meses vencidos'/);
  });
});
