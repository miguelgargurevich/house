// Las fotos de voucher se achican ANTES de validarlas, en cada punto donde se elige el archivo (el repo no pinta componentes:
// esto se fija con la fuente). Y mientras se achica, no se puede enviar (si no, un pago opcional saldría sin voucher).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const COMPROBANTES = fuente('src/pages/shared/comprobantes.ts');
const IMAGENES = fuente('src/pages/shared/_parts/imagenes.ts');
const QR = fuente('src/pages/admin/_parts/medios/qr.ts');
const GUIA = fuente('src/app/demo/guia.ts');

/** `antes` debe aparecer en el código antes que `despues`, y ambos deben existir. */
function enOrden(src: string, antes: string | RegExp, despues: string | RegExp, quien: string) {
  const i = typeof antes === 'string' ? src.indexOf(antes) : src.search(antes);
  const j = typeof despues === 'string' ? src.indexOf(despues) : src.search(despues);
  assert.ok(i >= 0, `${quien}: falta ${String(antes)}`);
  assert.ok(j >= 0, `${quien}: falta ${String(despues)}`);
  assert.ok(i < j, `${quien}: ${String(antes)} debe ir antes de ${String(despues)}`);
}

describe('los puntos de elección de voucher achican la foto antes de validarla', () => {
  const PUNTOS: Array<{ ruta: string; preparador: string; validador: string }> = [
    { ruta: 'src/pages/residente/_parts/PagarModal.tsx', preparador: 'prepararComprobante', validador: 'errorDeArchivo' },
    { ruta: 'src/pages/residente/_parts/PagosResidente.tsx', preparador: 'prepararComprobante', validador: 'errorDeArchivo' },
    { ruta: 'src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx', preparador: 'prepararComprobante', validador: 'errorDeArchivo' },
    { ruta: 'src/pages/admin/_parts/cierres/RegistrarLineaModal.tsx', preparador: 'prepararComprobante', validador: 'errorDeArchivo' },
    { ruta: 'src/pages/admin/_parts/cierres/RegistrarMovimientoModal.tsx', preparador: 'prepararComprobante', validador: 'errorDeArchivo' },
    { ruta: 'src/pages/admin/_parts/mantenimientos/FormPagoMantenimiento.tsx', preparador: 'prepararComprobante', validador: 'errorDeArchivo' },
  ];

  for (const { ruta, preparador, validador } of PUNTOS) {
    it(`${ruta}: usa ${preparador} con usePrepararArchivo y lo valida después con ${validador}`, () => {
      const src = fuente(ruta);
      assert.match(src, new RegExp(`usePrepararArchivo\\(${preparador}\\)`));
      assert.match(src, /await preparar\(/);
      enOrden(src, /await preparar\(/, `${validador}(listo)`, ruta);
    });
  }

  it('ImagenEditable (cabecera y logo) achica con prepararImagen antes de errorDeImagen', () => {
    const src = fuente('src/pages/admin/_parts/condominio/ImagenEditable.tsx');
    assert.match(src, /usePrepararArchivo\(prepararImagen\)/);
    enOrden(src, /await preparar\(f\)/, 'errorDeImagen(listo)', 'ImagenEditable');
    assert.match(src, /subirImagen\(ruta, listo\)/);
  });

  it('MedioFormModal (QR) achica con prepararQr antes de errorDeQr', () => {
    const src = fuente('src/pages/admin/_parts/medios/MedioFormModal.tsx');
    assert.match(src, /usePrepararArchivo\(prepararQr\)/);
    enOrden(src, /await preparar\(f\)/, 'errorDeQr(listo)', 'MedioFormModal');
  });

  it('ningún punto valida ni sube el archivo ORIGINAL cuando hay que achicarlo', () => {
    // El archivo que sube cada punto es el que sale de la preparación (`listo`), no el que se eligió (`f`/`archivo`).
    const PAGOS = fuente('src/pages/residente/_parts/PagarModal.tsx');
    assert.match(PAGOS, /errorDeArchivo\(listo\)/);
    assert.match(PAGOS, /setArchivo\(err \? null : listo\)/);
    assert.doesNotMatch(PAGOS, /errorDeArchivo\(f\)/);
    const RESIDENTE = fuente('src/pages/residente/_parts/PagosResidente.tsx');
    assert.match(RESIDENTE, /subirComprobante\(id, listo\)/);
    assert.doesNotMatch(RESIDENTE, /errorDeArchivo\(f\)/);
    const VALIDAR = fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx');
    assert.match(VALIDAR, /subirComprobante\(id, listo\)/);
    const FORM = fuente('src/pages/admin/_parts/mantenimientos/FormPagoMantenimiento.tsx');
    assert.match(FORM, /errorDeArchivo\(listo\)/);
    assert.match(FORM, /setArchivo\(err \? null : listo\)/);
  });
});

describe('mientras se achica la foto no se puede enviar (el voucher puede ser obligatorio u opcional)', () => {
  it('PagarModal: sin archivo no hay envío (puedeEnviar), y el estado de preparación llega al panel', () => {
    const src = fuente('src/pages/residente/_parts/PagarModal.tsx');
    assert.match(src, /const \{ preparando, preparar, cancelar \} = usePrepararArchivo\(prepararComprobante\);/);
    assert.match(src, /setArchivo\(null\);\s*\n\s*setErrorArchivo\(undefined\);/);
    assert.match(src, /preparando=\{preparando\}/);
    const panel = fuente('src/pages/residente/_parts/PagarPanel.tsx');
    assert.match(panel, /\{p\.preparando && <p role="status" className="mt-2 text-sm text-muted">Preparando la foto…<\/p>\}/);
  });

  it('FormPagoMantenimiento: el botón queda apagado y el envío no sale sin voucher mientras se prepara', () => {
    const src = fuente('src/pages/admin/_parts/mantenimientos/FormPagoMantenimiento.tsx');
    assert.match(src, /async function enviar\(v: Form\) \{\s*\n\s*if \(preparando\) return;/);
    assert.match(src, /<Button type="submit" loading=\{isSubmitting\} disabled=\{preparando\}>/);
    assert.match(src, /Preparando la foto…/);
  });

  it('RegistrarLineaModal y RegistrarMovimientoModal: el registro queda apagado y el envío no sale mientras se prepara', () => {
    for (const ruta of ['src/pages/admin/_parts/cierres/RegistrarLineaModal.tsx', 'src/pages/admin/_parts/cierres/RegistrarMovimientoModal.tsx']) {
      const src = fuente(ruta);
      assert.match(src, /disabled=\{!archivo \|\| enviando \|\| preparando\}/, ruta);
      assert.match(src, /async function enviar\(\) \{\s*\n\s*if \(preparando\) return;/, ruta);
      assert.match(src, /Preparando la foto…/, ruta);
    }
  });

  it('MedioFormModal: guardar queda apagado mientras se prepara el QR (si no, el medio se guardaría sin el QR elegido)', () => {
    const src = fuente('src/pages/admin/_parts/medios/MedioFormModal.tsx');
    assert.match(src, /async function guardar\(v: Form\) \{\s*\n\s*if \(preparando\) return;/);
    assert.match(src, /loading=\{isSubmitting\} disabled=\{preparando\}>/);
  });

  it('PagosResidente y ValidarPagoModal: no se puede pedir otro adjunto mientras se prepara', () => {
    assert.match(fuente('src/pages/residente/_parts/PagosResidente.tsx'), /loading=\{subiendo\} disabled=\{preparando\}/);
    assert.match(fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx'), /disabled=\{subiendo \|\| preparando\}/);
  });

  it('ImagenEditable: no se puede elegir otra imagen mientras se prepara', () => {
    assert.match(fuente('src/pages/admin/_parts/condominio/ImagenEditable.tsx'), /disabled=\{preparando\} onClick=\{\(\) => input\.current\?\.click\(\)\}/);
  });

  it('un resultado viejo se descarta: el hook devuelve null si se cerró o si se eligió otro archivo', () => {
    const hook = fuente('src/pages/shared/usePrepararArchivo.ts');
    assert.match(hook, /if \(!vivo\.current \|\| id !== ultimo\.current\) return null;/);
    assert.match(hook, /const cancelar = useCallback\(\(\) => \{\s*\n\s*ultimo\.current\+\+;/);
  });
});

describe('la compresión de cada tipo de archivo', () => {
  it('el módulo nuevo no importa la API ni import.meta.env (se prueba en Node)', () => {
    const src = fuente('src/pages/shared/comprimirImagen.ts');
    assert.doesNotMatch(src, /import\.meta\.env/);
    assert.doesNotMatch(src, /from '\.\.\/\.\.\/api'|from '\.\/api'|from '\.\.\/api'/);
  });

  it('ACCEPT_COMPROBANTE acepta HEIC/HEIF (Safari los convierte), y el servidor sigue recibiendo sólo jpeg/png/webp/pdf', () => {
    assert.match(COMPROBANTES, /export const ACCEPT_COMPROBANTE = 'image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif,application\/pdf,/);
    assert.match(COMPROBANTES, /export const TIPOS_COMPROBANTE = \['image\/jpeg', 'image\/png', 'image\/webp', 'application\/pdf'\];/);
  });

  it('el error de 2 MB: un PDF dice «el máximo es 2 MB»; una imagen que no se pudo achicar dice el mensaje nuevo', () => {
    assert.match(COMPROBANTES, /El archivo pesa \$\{tamanoLegible\(f\.size\)\} y no se pudo achicar; el máximo es 2 MB\. Prueba con una captura de pantalla del voucher\./);
    assert.match(COMPROBANTES, /if \(f\.type === 'application\/pdf'\) return `El archivo pesa \$\{tamanoLegible\(f\.size\)\}; el máximo es 2 MB\.`;/);
  });

  it('el voucher, la cabecera/logo y el QR tienen su preparación (tope y lado propios)', () => {
    assert.match(COMPROBANTES, /comprimirImagen\(f, \{ tope: MAX_COMPROBANTE, ladoMax: LADO_VOUCHER \}\)/);
    assert.match(IMAGENES, /comprimirImagen\(f, \{ tope: MAX_IMAGEN, ladoMax: LADO_VOUCHER, formato: f\.type === 'image\/png' \? 'image\/png' : 'image\/jpeg' \}\)/);
    assert.match(QR, /comprimirImagen\(f, \{ tope: MAX_QR, ladoMax: LADO_VOUCHER, ladoMin: 1000, formato: f\.type === 'image\/png' \? 'image\/png' : 'image\/jpeg' \}\)/);
  });

  it('la guía de la demo ya no exige que la imagen de ejemplo pese menos de 2 MB', () => {
    assert.doesNotMatch(GUIA, /menos de 2 MB/);
    assert.match(GUIA, /sube cualquier foto o imagen de ejemplo\./);
  });
});
