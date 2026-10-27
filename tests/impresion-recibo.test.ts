// Impresión del recibo de mantenimiento y del comprobante: sólo sale #zona-imprimible; lo demás se oculta con display:none
// (no visibility, que dejaba una página en blanco y el recibo cortado). El repo no pinta pantallas en las pruebas: se fija con la fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const css = readFileSync('src/index.css', 'utf8');
const zona = readFileSync('src/pages/shared/mantenimiento/ZonaImprimible.tsx', 'utf8');
const recibo = readFileSync('src/pages/shared/mantenimiento/ReciboImprimible.tsx', 'utf8');
const pagos = readFileSync('src/pages/residente/_parts/PagosResidente.tsx', 'utf8');

// El bloque `@media print { … }` completo (cuenta las llaves).
function bloqueImpresion(src: string): string {
  const inicio = src.indexOf('@media print');
  assert.ok(inicio >= 0, 'falta @media print en index.css');
  let nivel = 0;
  for (let i = src.indexOf('{', inicio); i < src.length; i++) {
    if (src[i] === '{') nivel++;
    if (src[i] === '}' && --nivel === 0) return src.slice(inicio, i + 1);
  }
  throw new Error('bloque @media print sin cerrar');
}

// Cuerpos de las reglas del bloque cuyo selector empieza por la zona imprimible.
function cuerposDeLaZona(bloque: string): string {
  return [...bloque.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => sel.trim().startsWith('#zona-imprimible'))
    .map(([, , cuerpo]) => cuerpo)
    .join('\n');
}

describe('CSS de impresión', () => {
  const bloque = bloqueImpresion(css);

  it('en pantalla la zona está oculta y al imprimir es lo único visible', () => {
    assert.match(css, /#zona-imprimible \{ display: none; \}/);
    assert.match(bloque, /#zona-imprimible \{ display: block !important;/);
  });

  it('lo demás se oculta con display:none y no con visibility', () => {
    assert.match(bloque, /body > \*:not\(#zona-imprimible\) \{ display: none !important; \}/);
    assert.doesNotMatch(bloque, /visibility/);
  });

  it('la zona impresa no tiene alto máximo, scroll ni posición fija o absoluta', () => {
    const cuerpos = cuerposDeLaZona(bloque);
    assert.match(cuerpos, /max-height: none/);
    assert.doesNotMatch(cuerpos, /max-height:(?!\s*none;)/);
    assert.doesNotMatch(cuerpos, /overflow(-[xy])?:(?!\s*visible;)/);
    assert.doesNotMatch(cuerpos, /position:\s*(fixed|absolute)/);
  });

  it('las filas no se parten entre páginas y el encabezado de la tabla se repite', () => {
    assert.match(bloque, /#zona-imprimible tr \{ break-inside: avoid; \}/);
    assert.match(bloque, /#zona-imprimible thead \{ display: table-header-group; \}/);
  });

  it('el papel es A4 vertical con márgenes', () => {
    assert.match(bloque, /@page \{ size: A4 portrait; margin: 16mm; \}/);
  });
});

describe('zona imprimible', () => {
  it('se monta en <body>, fuera de la app, con el id que usa el CSS', () => {
    assert.match(zona, /createPortal\(<div id="zona-imprimible"[^>]*>\{children\}<\/div>, document\.body\)/);
  });
});

describe('recibo de mantenimiento', () => {
  const zonaRecibo = recibo.match(/<ZonaImprimible>([\s\S]*?)<\/ZonaImprimible>/)?.[1] ?? '';
  const articulo = recibo.slice(recibo.indexOf('function ReciboArticulo'), recibo.indexOf('/** «Recibo de mantenimiento» imprimible'));

  it('la zona imprimible lleva el recibo completo', () => {
    assert.match(zonaRecibo, /<ReciboArticulo d=\{d\} \/>/);
  });

  it('el recibo impreso incluye todos los conceptos, el total y los medios de pago', () => {
    assert.match(articulo, /d\.conceptos\.map\(/);
    assert.match(articulo, /soles\(d\.total\)/);
    assert.match(articulo, /Saldo por pagar/);
    assert.match(articulo, /d\.medios_pago\.map\(/);
  });

  it('ya no usa su propio <style> con visibility ni el id viejo', () => {
    assert.doesNotMatch(recibo, /PRINT_CSS|<style>|visibility|recibo-imprimible/);
  });
});

describe('comprobante del residente', () => {
  const zonaPago = pagos.match(/<ZonaImprimible>([\s\S]*?)<\/ZonaImprimible>/)?.[1] ?? '';
  const funcion = pagos.slice(pagos.indexOf('function comprobante('), pagos.indexOf('const columns'));

  it('la zona imprimible lleva el comprobante completo con su título', () => {
    assert.match(zonaPago, /Comprobante de pago · House/);
    assert.match(zonaPago, /\{comprobante\(ver\)\}/);
  });

  it('el comprobante muestra el monto, los datos del pago y la nota de estado', () => {
    assert.match(funcion, /soles\(montoPago\(p\)\)/);
    assert.match(funcion, /<DefinitionList/);
    assert.match(funcion, /Pago validado automáticamente por la inteligencia artificial/);
  });

  it('ya no usa su propio <style> con visibility ni el id viejo', () => {
    assert.doesNotMatch(pagos, /PRINT_CSS|<style>|visibility|id="comprobante"/);
  });
});
