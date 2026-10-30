// Pantallas de «Revisar morosos», «Quitar la multa» y el aviso del pago. El repo no pinta componentes en Node: se prueba la lógica pura
// (`morosos.ts`) y se comprueba la fuente (qué piden a la API, qué botones hay, quién los ve).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { errorMotivoMulta, fechaDeCorreccion, filtrarUnidades, motivoRevisar, multaQuitable, resumenVista } from '../src/pages/admin/_parts/cobranza/morosos';
import type { UnidadMora, VistaMora } from '../src/pages/admin/_parts/cobranza/morosos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const REVISAR = f('src/pages/admin/_parts/cobranza/RevisarMorosos.tsx');
const EMITIR = f('src/pages/admin/_parts/cobranza/EmitirReciboModal.tsx');
const EXCEL = f('src/pages/admin/_parts/cobranza/SubirExcelModal.tsx');
const QUITAR = f('src/pages/admin/_parts/cobranza/QuitarMultaModal.tsx');
const VALIDAR = f('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx');
const MANT = f('src/pages/admin/_parts/mantenimientos/MantenimientoAdminModal.tsx');
const PAGOS = f('src/pages/admin/Pagos.tsx');

const unidad = (codigo: string, extra: Partial<UnidadMora> = {}): UnidadMora => ({ unidad_id: 1, codigo, estado: 'a_tiempo', deuda: '100.00', pagos: [], revisar: false, ...extra });
const pago = (origen: string, estado = 'validado') => ({ id: 1, monto: '100.00', fecha_pago: '2026-10-01T15:00:00.000Z', dia: '2026-10-01', fecha_origen: origen as never, estado_validacion: estado as never });
const vista = (extra: Partial<VistaMora> = {}): VistaMora => ({ complejo_id: 1, mes: 10, anio: 2026, aplica: true, monto: '20.00', torres: [], resumen: { a_tiempo: 5, tarde: 3, sin_deuda: 1, revisar: 2 }, ...extra });

describe('morosos.ts: lógica de la revisión', () => {
  it('«sólo para revisar» deja los marcados; sin el filtro, todos', () => {
    const us = [unidad('A', { revisar: true }), unidad('B'), unidad('C', { revisar: true })];
    assert.deepEqual(filtrarUnidades(us, true).map(u => u.codigo), ['A', 'C']);
    assert.deepEqual(filtrarUnidades(us, false).map(u => u.codigo), ['A', 'B', 'C']);
  });

  it('dice por qué hay que revisar: fecha inválida, no leída, declarada o pago por validar', () => {
    assert.equal(motivoRevisar(unidad('A')), null);
    assert.match(motivoRevisar(unidad('A', { revisar: true, pagos: [pago('invalida')] }))!, /no se aplicó/);
    assert.match(motivoRevisar(unidad('A', { revisar: true, pagos: [pago('no_leida')] }))!, /No se pudo leer/);
    assert.match(motivoRevisar(unidad('A', { revisar: true, pagos: [pago('declarada')] }))!, /no viene del voucher/);
    assert.match(motivoRevisar(unidad('A', { revisar: true, pagos: [pago('voucher', 'por_validar')] }))!, /sigue por validar/);
  });

  it('el resumen dice cuántos tendrán multa y cuántos revisar; sin mora automática, lo avisa', () => {
    assert.equal(resumenVista(vista()), '3 departamentos tendrán multa · 2 para revisar');
    assert.equal(resumenVista(vista({ resumen: { a_tiempo: 1, tarde: 1, sin_deuda: 0, revisar: 0 } })), '1 departamento tendrá multa');
    assert.equal(resumenVista(vista({ resumen: { a_tiempo: 1, tarde: 0, sin_deuda: 0, revisar: 0 } })), 'Nadie tendrá multa');
    assert.match(resumenVista(vista({ aplica: false })), /no cobra mora automática/);
  });

  it('la fecha corregida se guarda al mediodía UTC (ninguna zona horaria la corre de día)', () => {
    assert.equal(fechaDeCorreccion('2026-10-01'), '2026-10-01T12:00:00Z');
  });

  it('la multa por quitar es la línea de multa/mora sin nada cobrado ni en revisión', () => {
    const c = (concepto: string, monto: string, cobrado = '0.00', en_revision = '0.00') => ({ cargo_id: 1, concepto, monto, cobrado, en_revision });
    assert.equal(multaQuitable([c('Mantenimiento', '100.00'), c('Multa por pago fuera de fecha', '20.00')])?.monto, '20.00');
    assert.equal(multaQuitable([c('MULTA PAGO FUERA DE FECHA(ULTIMO DIA 2 CADA MES)', '35.00')])?.monto, '35.00');
    assert.equal(multaQuitable([c('Mora', '10.00')])?.monto, '10.00');
    assert.equal(multaQuitable([c('Mantenimiento', '100.00')]), null);
    assert.equal(multaQuitable([c('Multa por pago fuera de fecha', '20.00', '20.00')]), null, 'pagada');
    assert.equal(multaQuitable([c('Multa por pago fuera de fecha', '20.00', '0.00', '20.00')]), null, 'en revisión');
    assert.equal(multaQuitable([c('Multa por pago fuera de fecha', '0.00')]), null, 'ya quitada (0.00)');
  });

  it('el motivo exige de 5 a 300 caracteres (sin contar espacios de los lados)', () => {
    assert.ok(errorMotivoMulta('abcd'));
    assert.ok(errorMotivoMulta('   abc   '));
    assert.equal(errorMotivoMulta('abcde'), undefined);
    assert.ok(errorMotivoMulta('x'.repeat(301)));
  });
});

describe('pantallas: Revisar morosos', () => {
  it('lee la vista del recibo o, con el Excel, la pide por POST sin crear nada; recarga al corregir una fecha', () => {
    assert.match(REVISAR, /`\/api\/recibos\/vista-mora\?\$\{q\}`/);
    assert.match(REVISAR, /api<VistaMora>\('\/api\/recibos\/excel\/vista-mora', \{ method: 'POST', body: fd \}\)/);
    assert.match(REVISAR, /`\/api\/pagos\/\$\{pago\.id\}`, \{ method: 'PUT', json: \{ fecha_pago: fechaDeCorreccion\(dia\) \} \}/);
    assert.match(REVISAR, /onCorregida=\{\(\) => void cargar\(\)\}/);
  });

  it('tiene el filtro «Sólo para revisar», la marca «Revisar» y el botón «Corregir fecha»', () => {
    assert.match(REVISAR, /Sólo para revisar/);
    assert.match(REVISAR, /<Badge tone="warn">Revisar<\/Badge>/);
    assert.match(REVISAR, />Corregir fecha</);
  });

  it('«Emitir recibo» y «Subir Excel» tienen el paso «Revisar morosos» (opcional: emitir/subir siguen disponibles)', () => {
    assert.match(EMITIR, /<RevisarMorosos fuente=\{\{ tipo: 'recibo', complejoId: complejoElegido, estructuraId: torreElegida, mes: mesElegido, anio: anioElegido \}\}/);
    assert.match(EMITIR, />Revisar morosos<\/Button>/);
    assert.match(EMITIR, />Emitir recibo<\/Button>/);
    assert.match(EXCEL, /<RevisarMorosos fuente=\{\{ tipo: 'excel', complejoId, archivo \}\}/);
    assert.match(EXCEL, />Revisar morosos<\/Button>/);
    assert.match(EXCEL, /Subir Excel y crear recibos/);
  });
});

describe('pantallas: Quitar la multa y el aviso', () => {
  it('el diálogo pide el motivo y llama al endpoint con él', () => {
    assert.match(QUITAR, /`\/api\/recibos\/\$\{reciboId\}\/mantenimientos\/\$\{unidadId\}\/quitar-multa`, \{ method: 'POST', json: \{ motivo: motivo\.trim\(\) \} \}/);
    assert.match(QUITAR, /errorMotivoMulta\(motivo\)/);
  });

  it('el detalle del mantenimiento tiene «Quitar la multa» sólo para la administración y sólo si la multa se puede quitar', () => {
    assert.match(MANT, /puedeValidar\(user\) \? multaQuitable\(d\.conceptos\) : null/);
    assert.match(MANT, />Quitar la multa<\/Button>/);
    assert.match(MANT, /<QuitarMultaModal reciboId=\{reciboId\} unidadId=\{unidadId\}/);
  });

  it('el pago muestra el aviso con «Quitar la multa» (sólo la administración; la junta lo lee) y la lista de «Por validar» lo marca', () => {
    assert.match(VALIDAR, /pago\.aviso_multa && !multaQuitada/);
    assert.match(VALIDAR, /\{pago\.aviso_multa\.texto\}/);
    assert.match(VALIDAR, /validador\s*\? <Button size="sm" variant="secondary" className="mt-2" onClick=\{\(\) => setQuitandoMulta\(true\)\}>Quitar la multa<\/Button>/);
    assert.match(VALIDAR, /La administración puede quitarla\./);
    assert.match(MANT, /aviso_multa: p\.aviso_multa/);
    assert.match(PAGOS, /\{p\.aviso_multa && <Badge tone="warn">Multa por quitar<\/Badge>\}/);
  });
});
