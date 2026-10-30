// Leer bien el voucher: el visor con zoom, «Ver mi voucher» en el detalle del recibo del vecino y el pie de los modales fijo abajo.
// El repo no pinta componentes, así que se fija con la fuente (verificado además en el navegador a 776 px y 390 px).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const MODAL = fuente('src/ui/Modal.tsx');
const VISTA = fuente('src/pages/shared/ComprobanteVista.tsx');
const VISOR = fuente('src/pages/shared/VisorImagen.tsx');
const DETALLE = fuente('src/pages/residente/_parts/DetalleMantenimientoModal.tsx');

describe('modal: el pie queda fijo abajo', () => {
  it('el diálogo no se desplaza: tope con dvh y overflow oculto; sólo el cuerpo se desplaza', () => {
    assert.match(MODAL, /max-h-\[calc\(100dvh-2rem\)\][^"]*overflow-hidden/);
    assert.doesNotMatch(MODAL, /max-h-\[85vh\]/);
    assert.match(MODAL, /data-modal-cuerpo="" className="min-h-0 flex-1 overflow-y-auto/);
    assert.match(MODAL, /data-modal-pie="" className="flex shrink-0/);
  });
  it('cerrar un modal abierto dentro de otro no cierra el de abajo', () => {
    assert.match(MODAL, /onClose=\{e => \{ if \(e\.target === e\.currentTarget\) onClose\(\); \}\}/);
    assert.match(VISOR, /onClose=\{e => \{ e\.stopPropagation\(\); onClose\(\); \}\}/);
  });
});

describe('voucher: ampliar para leerlo', () => {
  it('la imagen del voucher abre el visor a pantalla completa con «Ampliar»', () => {
    assert.match(VISTA, /import \{ VisorImagen \} from '\.\/VisorImagen';/);
    assert.match(VISTA, /onClick=\{\(\) => setAmpliada\(true\)\}/);
    assert.match(VISTA, />\s*Ampliar\s*</);
    assert.match(VISTA, /<VisorImagen src=\{c\.data\.url\}/);
  });
  it('el visor acerca, aleja y vuelve a ajustar a la pantalla', () => {
    assert.match(VISOR, /export const ZOOMS = \[1, 1\.5, 2, 3, 4\] as const;/);
    for (const b of ['Alejar', 'Acercar', 'Ajustar a la pantalla', 'Cerrar']) assert.match(VISOR, new RegExp(`label="${b}"`));
    assert.match(VISOR, /width: `\$\{zoom \* 100\}%`/);
  });
});

describe('detalle del recibo del vecino: «Ver mi voucher»', () => {
  it('sale sólo si hay un pago con voucher y prefiere el que está en revisión', () => {
    assert.match(DETALLE, /const conVoucher = d \? d\.pagos\.filter\(p => p\.comprobante\) : \[\];/);
    assert.match(DETALLE, /conVoucher\.find\(p => p\.estado_validacion === 'por_validar'\) \?\? conVoucher\[0\] \?\? null/);
    assert.match(DETALLE, /\{ultimo && <Button[\s\S]*?onClick=\{\(\) => verVoucher\(ultimo\.id\)\}>Ver mi voucher<\/Button>\}/);
  });
  it('también se abre tocando el pago en la lista, y muestra el voucher con su visor', () => {
    assert.match(DETALLE, /onVer=\{p => \{ if \(p\.comprobante\) verVoucher\(p\.id\); \}\}/);
    assert.match(DETALLE, /<ComprobanteVista key=\{voucher\.id\} pagoId=\{voucher\.id\}/);
  });
});
