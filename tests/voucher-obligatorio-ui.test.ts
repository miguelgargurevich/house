// «Revisar pago»: sin voucher el botón «Validar pago» se deshabilita y dice por qué (el servidor igual responde 409). Rechazar sigue disponible.
// El repo no pinta componentes: se fija con la fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const MODAL = readFileSync('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx', 'utf8');
const PAGOS = readFileSync('src/pages/admin/Pagos.tsx', 'utf8');

describe('detalle del pago: validar exige el voucher', () => {
  it('sinVoucher = hay pago y no hay comprobante (el del pago ni el recién adjuntado)', () => {
    assert.match(MODAL, /const comprobante = pago\?\.comprobante \?\? subido;/);
    assert.match(MODAL, /const sinVoucher = pago !== null && !comprobante;/);
  });

  it('«Validar pago» se deshabilita sin voucher y apunta al motivo; «Rechazar» NO depende de sinVoucher', () => {
    const validar = MODAL.split('\n').find((l) => l.includes('Validar pago</Button>'))!;
    assert.match(validar, /disabled=\{enviando !== null \|\| sinVoucher\}/);
    assert.match(validar, /aria-describedby=\{sinVoucher \? 'motivo-sin-voucher' : undefined\}/);
    const rechazar = MODAL.split('\n').find((l) => l.includes('>Rechazar</Button>'))!;
    assert.doesNotMatch(rechazar, /sinVoucher/);
    const confirmar = MODAL.split('\n').find((l) => l.includes('Confirmar rechazo</Button>'))!;
    assert.doesNotMatch(confirmar, /sinVoucher/);
  });

  it('el motivo se ve junto al botón y distingue a quien puede adjuntar (administración) de la junta', () => {
    assert.match(MODAL, /\{sinVoucher && <p id="motivo-sin-voucher"[^>]*>\{motivoSinVoucher\}<\/p>\}/);
    assert.match(MODAL, /puedeAdjuntar \? 'Sin voucher no se puede validar: adjunta el comprobante o rechaza el pago\.' : 'Sin voucher no se puede validar: pídele al vecino que lo suba o rechaza el pago\.'/);
  });

  it('la lista «Por validar» ya marca «Sin comprobante» en cada pago sin voucher', () => {
    assert.match(PAGOS, /pestana === 'por_validar' && \(p\.comprobante \? <VeredictoBadge evaluacion=\{p\.evaluacion\} \/> : <span className="text-xs text-muted">Sin comprobante<\/span>\)/);
  });
});
