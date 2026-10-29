// «Pagar mantenimiento» del residente en UN solo panel: monto y el voucher (obligatorio) juntos, un solo envío multipart.
// El pie se renderiza de verdad (react-dom/server); la estructura del panel y el envío se fijan con la fuente (el repo no tiene testing-library
// y `api.ts` usa `import.meta.env`, que Node no tiene, así que el panel completo no se puede importar aquí).
import './helpers/env';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import { FORM_PAGO, puedeEnviar } from '../src/pages/residente/_parts/pago';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const RES = 'src/pages/residente/_parts/';
const modal = () => fuente(`${RES}PagarModal.tsx`);
const panel = () => fuente(`${RES}PagarPanel.tsx`);

let PiePago: typeof import('../src/pages/residente/_parts/PiePago').PiePago;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ PiePago } = await import('../src/pages/residente/_parts/PiePago'));
});

const voucher = () => new File([new Uint8Array([1, 2, 3])], 'voucher.png', { type: 'image/png' });
const pie = (archivo: File | null, enviando = false) => renderToStaticMarkup(createElement(PiePago, { archivo, enviando, onCancelar: () => undefined }));
/** El `<button …>` de «Enviar pago» tal como lo pinta React. */
const botonEnviar = (html: string) => html.split('<button').find((b) => b.includes('Enviar pago')) ?? '';

describe('«Enviar pago»: apagado hasta que haya un voucher válido', () => {
  it('puedeEnviar: sólo con archivo y sin un envío en curso', () => {
    assert.equal(puedeEnviar(null, false), false);
    assert.equal(puedeEnviar(voucher(), false), true);
    assert.equal(puedeEnviar(voucher(), true), false, 'no se envía dos veces');
  });

  it('render: sin archivo el botón está deshabilitado; con archivo se habilita', () => {
    assert.match(botonEnviar(pie(null)), /\sdisabled=""/);
    assert.doesNotMatch(botonEnviar(pie(voucher())), /\sdisabled=""/);
  });

  it('render: mientras se envía queda deshabilitado y ocupado', () => {
    const b = botonEnviar(pie(voucher(), true));
    assert.match(b, /\sdisabled=""/);
    assert.match(b, /aria-busy="true"/);
  });

  it('render: «Cancelar» y «Enviar pago» (submit del formulario del panel); ya no hay «Ya pagué» ni «Confirmar pago»', () => {
    const html = pie(voucher());
    assert.match(html, />Cancelar</);
    assert.match(botonEnviar(html), /type="submit"/);
    assert.match(botonEnviar(html), new RegExp(`form="${FORM_PAGO}"`));
    assert.doesNotMatch(html, /Ya pagué|Confirmar pago|Ver cómo pagar/);
  });
});

describe('un solo panel (adiós a los pasos «como» y «registrar»)', () => {
  it('el modal no tiene pasos: sólo el panel y, tras enviar, el estado «enviado»', () => {
    const s = modal();
    assert.doesNotMatch(s, /setPaso|'como'|'registrar'|useForm/);
    assert.doesNotMatch(s, /Ya pagué|Confirmar pago|Ver cómo pagar|Registrar tu pago/);
    assert.match(s, /title=\{enviado \? 'Pago enviado' : 'Pagar mantenimiento'\}/);
    assert.match(s, /<PanelPago\b/);
    assert.match(s, /<PiePago archivo=\{archivo\} enviando=\{enviando\} onCancelar=\{onClose\} \/>/);
  });

  it('el panel trae, en este orden: el monto con su línea y «Sube tu voucher»', () => {
    const s = panel();
    const orden = ['Monto a pagar', 'vence el {fechaCorta(mant.fecha_vencimiento)}', '>Sube tu voucher<', 'label="Voucher (foto o PDF)"', 'label="¿Cómo pagaste?"', 'label="N.º de operación (opcional)"'].map((t) => s.indexOf(t));
    assert.ok(orden.every((i) => i >= 0), JSON.stringify(orden));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'el orden de arriba a abajo');
    assert.match(s, /mant\.titulo\.split\(' · '\)\[0\]} · \{mant\.unidad\.codigo\}\{mant\.unidad\.estructura\?\.nombre/);
  });

  it('el voucher es obligatorio en el campo (required + aria-required) y los campos van lado a lado desde sm, en una columna en el celular', () => {
    const s = panel();
    assert.match(s, /type="file"[\s\S]*?\brequired\b[\s\S]*?aria-required="true"/);
    assert.match(s, /<form id=\{FORM_PAGO\}[\s\S]*?className="grid gap-4 sm:grid-cols-2"/);
    assert.doesNotMatch(s, /opcional\)"[^\n]*type="file"|Adjuntar comprobante \(opcional\)/);
  });

  it('la cámara sigue sólo en pantallas táctiles', () => {
    assert.match(fuente(`${RES}pago.ts`), /matchMedia\?\.\('\(pointer: coarse\)'\)/);
    assert.match(panel(), /\{p\.conCamara && <div className="mt-2">/);
    assert.match(modal(), /useState\(esTactil\)/);
  });

  it('el panel ya no tiene «Cómo pagar»: ni la sección, ni el componente, ni sus datos (medios, notas, QR); las cuentas siguen en el recibo', () => {
    const s = panel();
    assert.doesNotMatch(s, /Cómo pagar|ComoPagar|medios|notas|QrImagen|Ver QR|Notas de pago/);
    assert.equal(existsSync(`${RES}ComoPagar.tsx`), false, 'el componente se borró');
    assert.doesNotMatch(modal(), /ComoPagar|medios_pago|notas_pago/);
    assert.match(fuente('src/pages/shared/mantenimiento/ReciboImprimible.tsx'), /numero_cuenta/);
  });

  it('bajo el texto de «Sube tu voucher» avisa que también se le manda a la junta del block, con su correo, sólo si el block lo tiene', () => {
    const s = panel();
    assert.match(s, /\{p\.correoVouchers && <p [^>]*>Al enviarlo, también se lo mandamos a la junta del block \(<span [^>]*>\{p\.correoVouchers\}<\/span>\)\.<\/p>\}/);
    assert.ok(s.indexOf('Queda en revisión hasta que se valide.') < s.indexOf('Al enviarlo, también se lo mandamos'), 'debajo del texto');
    assert.ok(s.indexOf('Al enviarlo, también se lo mandamos') < s.indexOf('<form id={FORM_PAGO}'), 'antes del formulario');
    assert.match(modal(), /correoVouchers=\{d\?\.correo_vouchers \?\? null\}/);
  });
});

describe('un solo envío, multipart, con el voucher', () => {
  it('manda los campos y el archivo con registrarPagoConVoucher a la ruta del residente; no hay pago JSON ni segunda subida', () => {
    const s = modal();
    assert.match(s, /registrarPagoConVoucher<ResultadoPagoMantenimiento>\(`\/api\/me\/mantenimientos\/\$\{mant\.recibo_id\}\/\$\{mant\.unidad_id\}\/pagos`, \{ metodo_pago: metodo, \.\.\.\(ref \? \{ referencia: ref \} : \{\}\) \}, archivo\)/);
    assert.equal(s.split('registrarPagoConVoucher<').length - 1, 1, 'una sola llamada');
    assert.doesNotMatch(s, /subirComprobante|json:|api<|api\(/);
  });

  it('sin archivo no envía (aunque se fuerce el submit con Enter)', () => {
    assert.match(modal(), /if \(!mant \|\| !archivo \|\| !puedeEnviar\(archivo, enviando\)\) return;/);
  });

  it('el campo del archivo se llama «voucher» (el servidor lo espera ahí) y el multipart no fija Content-Type', () => {
    const f = fuente('src/pages/shared/comprobantes.ts');
    assert.match(f, /fd\.append\('voucher', archivo, archivo\.name\)/);
    const fn = f.slice(f.indexOf('export async function registrarPagoConVoucher'), f.indexOf('export async function descargarComprobante'));
    assert.doesNotMatch(fn, /Content-Type/i);
  });

  it('el error del servidor sobre el archivo se ve en el campo; el resto, en un aviso; y no se cierra ni se pierde el archivo', () => {
    const s = modal();
    assert.match(s, /e instanceof ErrorDeEnvio && e\.campos\.voucher\) setErrorArchivo\(e\.message\)/);
    assert.match(s, /else toast\.error\(/);
    const f = fuente('src/pages/shared/comprobantes.ts');
    assert.match(f, /export class ErrorDeEnvio extends Error/);
    assert.match(f, /if \(!res\.ok\) throw await errorDe\(res\);/);
  });

  it('el pago enviado se queda en «enviado» con la revisión por IA, y se avisa a la lista (onPagado)', () => {
    const s = modal();
    assert.match(s, /onPagado\(\);[\s\S]*?setPagoEnviado\(pago\.pago_id\)/);
    assert.match(s, /useEvaluacionResidente\(pagoEnviado\)/);
    assert.match(s, /<EstadoEvaluacion estado=\{evaluacion\.estado\} \/>/);
  });
});

describe('el asistente describe el pago en un solo panel', () => {
  it('el prompt ya no habla de «Ya pagué: registrar comprobante»; dice «Enviar pago» y que el voucher es obligatorio', () => {
    const p = fuente('src/config/ai-system-prompt.txt');
    assert.doesNotMatch(p, /Ya pagué/);
    assert.match(p, /Enviar pago/);
    assert.match(p, /voucher[^.]*obligatorio|obligatori[^.]*voucher/i);
  });

  it('el prompt ya no manda al vecino a «Cómo pagar» dentro del panel y dice que House avisa a la junta del block por correo', () => {
    const p = fuente('src/config/ai-system-prompt.txt');
    assert.doesNotMatch(p, /luego «Cómo pagar»|«Ver QR»/);
    assert.match(p, /«Ver detalle» › «Ver \/ imprimir recibo»/);
    assert.match(p, /House le manda tu voucher a la junta por correo[^.]*no hace falta que lo envíes tú/);
  });
});
