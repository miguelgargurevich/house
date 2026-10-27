// El botón «Adjuntar comprobante» del detalle del pago: el repo no pinta componentes, así que se fija con la fuente
// (quién lo ve, cuándo aparece, qué llama y qué dice según el estado del pago).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const MODAL = fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx');
const COMPROBANTES = fuente('src/pages/shared/comprobantes.ts');
const EVALUACION = fuente('src/pages/shared/evaluacion.tsx');

describe('detalle del pago: adjuntar el comprobante', () => {
  it('sólo quien administra (admin o superadmin) ve el botón: la junta y el residente no', () => {
    assert.match(MODAL, /const puedeAdjuntar = user\?\.rol === 'admin' \|\| user\?\.rol === 'superadmin';/);
    assert.match(MODAL, /\{puedeAdjuntar && \(/);
    assert.match(MODAL, /Adjuntar comprobante<\/Button>/);
  });

  it('el botón vive en la rama SIN comprobante: con voucher no se vuelve a subir desde aquí', () => {
    const rama = MODAL.indexOf('{comprobante ? (');
    const boton = MODAL.indexOf('Adjuntar comprobante</Button>');
    const fin = MODAL.indexOf('{comprobante && (');
    assert.ok(rama > 0 && boton > rama && boton < fin, 'el botón está después de «{comprobante ? (» y antes del panel de la IA');
  });

  it('sube con subirComprobante, valida el tipo y el tamaño en el cliente y sigue la evaluación de la IA', () => {
    assert.match(MODAL, /import \{[^}]*subirComprobante[^}]*\} from '\.\.\/\.\.\/\.\.\/shared\/comprobantes';/);
    assert.match(MODAL, /const error = errorDeArchivo\(archivo\);/);
    assert.match(MODAL, /accept=\{ACCEPT_COMPROBANTE\}/);
    assert.match(MODAL, /setSubido\(await subirComprobante\(pago\.id, archivo\)\);/);
    assert.match(MODAL, /ia\.seguir\(\);/);
    assert.match(MODAL, /onRevisado\(\); \/\/ refresca la lista/);
  });

  it('el estado de la IA se muestra con el mismo panel que el de la revisión (sin pedir otra evaluación)', () => {
    assert.match(MODAL, /\{comprobante && \(\s*<EvaluacionPanel/);
    assert.match(EVALUACION, /const seguir = useCallback\(\(\) => \{ setError\(null\); setEsperando\(true\); setCiclo\(c => c \+ 1\); \}, \[\]\);/);
    assert.match(EVALUACION, /return \{ ev, validadoPorIA, esperando, fase, error, reevaluar, seguir \};/);
    // Al cambiar de pago no debe arrastrarse la marca «validado por la IA» del anterior.
    assert.match(EVALUACION, /setEv\(inicial\); setValidadoPorIA\(false\);/);
  });

  it('el texto depende del estado: ya validado → respaldo; por validar → la IA puede validar o queda en revisión', () => {
    assert.match(MODAL, /El pago ya estaba validado: el voucher queda como respaldo y la IA solo informa lo que leyó\./);
    assert.match(MODAL, /La IA revisó el voucher y validó el pago automáticamente\./);
    assert.match(MODAL, /si no, queda en revisión para que lo revises tú\./);
    // Un pago ya validado no se vuelve a «por validar» porque la IA lo lea: el estado de la vista sale del pago original.
    assert.match(MODAL, /const estadoPago = pago && pago\.estado_validacion === 'por_validar' && ia\.validadoPorIA \? 'validado' : pago\?\.estado_validacion;/);
  });

  it('los errores salen en español: el cliente los valida y el servidor sin permiso (404/403) se dice con sus palabras', () => {
    assert.match(COMPROBANTES, /if \(res\.status === 403 \|\| res\.status === 404\) throw new Error\('No tienes permiso para adjuntar el comprobante a este pago\.'\);/);
    assert.match(COMPROBANTES, /Sube una imagen JPG, PNG o WebP, o un PDF\./);
    assert.match(COMPROBANTES, /el máximo es 2 MB/);
  });
});
