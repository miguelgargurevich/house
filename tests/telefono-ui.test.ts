// TelefonoInput: el render de verdad (react-dom/server) con Perú por defecto, un valor de otro país, un dato viejo sin «+» y el error de un fijo;
// y el cableado: cada formulario de teléfono usa el componente (no el texto libre de antes). El repo no tiene testing-library: lo interactivo
// (escribir, elegir país) se fija con la lógica pura de `src/lib/telefono.ts`, que el componente llama.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import { desglosarTelefono, formatoNacional, paisesTelefono, valorTelefono } from '../src/lib/telefono';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

let TelefonoInput: typeof import('../src/ui/TelefonoInput').TelefonoInput;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ TelefonoInput } = await import('../src/ui/TelefonoInput'));
});

const pintar = (props: Partial<Parameters<typeof TelefonoInput>[0]> = {}) =>
  renderToStaticMarkup(createElement(TelefonoInput, { label: 'Teléfono', value: '', onChange: () => undefined, ...props } as never));

/** El `<option selected>` que quedó marcado en el selector de país. */
const paisMarcado = (html: string) => /<option value="([A-Z]{2})"[^>]*selected=""/.exec(html)?.[1];
const numero = (html: string) => /<input[^>]*value="([^"]*)"/.exec(html)?.[1];

describe('TelefonoInput: lo que se ve', () => {
  it('sin valor: Perú por defecto, con la etiqueta, el selector y el campo de teléfono', () => {
    const html = pintar({ label: 'Celular de la administración' });
    assert.equal(paisMarcado(html), 'PE');
    assert.match(html, /<label[^>]*>Celular de la administración<\/label>/);
    assert.match(html, /aria-label="País del teléfono"/);
    assert.match(html, /<input[^>]*type="tel"/);
    assert.match(html, /<input[^>]*inputMode="tel"|<input[^>]*inputmode="tel"/);
  });

  it('un valor guardado con «+» elige su país y muestra el número con el espaciado de ese país', () => {
    const html = pintar({ value: '+56 9 6123 4567' });
    assert.equal(paisMarcado(html), 'CL');
    assert.equal(numero(html), '9 6123 4567');
  });

  it('un dato viejo sin «+» (como 987654321) se lee como Perú', () => {
    const html = pintar({ value: '987654321' });
    assert.equal(paisMarcado(html), 'PE');
    assert.equal(numero(html), '987 654 321');
  });

  it('el selector trae los países de Latinoamérica, España y EE. UU. primero, con bandera y prefijo', () => {
    const html = pintar();
    assert.match(html, /<optgroup label="Más usados">/);
    assert.match(html, /<optgroup label="Otros países">/);
    assert.match(html, /<option value="PE"[^>]*>🇵🇪 Perú \+51<\/option>/);
    assert.match(html, /<option value="US"[^>]*>🇺🇸 Estados Unidos \+1<\/option>/);
    assert.match(html, /<option value="ES"[^>]*>🇪🇸 España \+34<\/option>/);
    const { prioritarios, resto } = paisesTelefono();
    const codigos = prioritarios.map((p) => p.codigo);
    for (const c of ['PE', 'CL', 'AR', 'MX', 'CO', 'ES', 'US']) assert.ok(codigos.includes(c as never), c);
    assert.ok(!codigos.includes('FR' as never), 'Francia va en el resto');
    assert.ok(resto.length > 150, 'el resto del mundo también está');
  });

  it('un error (del servidor o de este campo) se muestra y queda ligado al campo para el lector de pantalla', () => {
    const html = pintar({ error: 'Teléfono inválido para el país elegido', value: '+51 9876' });
    assert.match(html, /Teléfono inválido para el país elegido/);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /aria-describedby="[^"]+"/);
  });

  it('una pista se ve como texto de ayuda', () => {
    assert.match(pintar({ hint: 'Opcional. Ejemplo: 987 654 321.' }), /Opcional\. Ejemplo: 987 654 321\./);
  });
});

describe('lógica del campo (la que llama el componente): escribir, pegar y elegir país', () => {
  it('escribir con el país elegido arma el valor internacional; un valor parcial no pierde los dígitos', () => {
    assert.equal(valorTelefono('CL', '961234567'), '+56 9 6123 4567');
    assert.equal(valorTelefono('PE', '98765'), '+51 98765');
    assert.equal(valorTelefono('PE', ''), '');
  });

  it('pegar un número con «+» cambia el país al del prefijo', () => {
    assert.deepEqual(desglosarTelefono('+52 55 1234 5678'), { pais: 'MX', nacional: '5512345678' });
    assert.deepEqual(desglosarTelefono('+1 415 555 2671'), { pais: 'US', nacional: '4155552671' });
  });

  it('un número a medias con «+» también elige el país (lo que se va escribiendo)', () => {
    assert.deepEqual(desglosarTelefono('+56 9 1'), { pais: 'CL', nacional: '91' });
    assert.deepEqual(desglosarTelefono('+1 415'), { pais: 'US', nacional: '415' });
  });

  it('elegir otro país conserva los dígitos (se reescribe con el espaciado del nuevo país)', () => {
    const { nacional } = desglosarTelefono('+56 9 6123 4567');
    assert.equal(formatoNacional('ES', nacional), '961 23 45 67');
    assert.equal(valorTelefono('ES', nacional), '+34 961 23 45 67');
  });
});

describe('cableado: los formularios de teléfono usan TelefonoInput', () => {
  const pares: [string, RegExp[]][] = [
    ['src/pages/publico/Registro.tsx', [/<TelefonoInput label="Celular"[\s\S]*? required \/>/, /import \{[^}]*\bTelefonoInput\b[^}]*\} from '\.\.\/\.\.\/ui'/]],
    ['src/pages/shared/_parts/AvisosPerfil.tsx', [/<TelefonoInput[\s\S]*label="Tu celular"[\s\S]*soloCelular/, /parsearCelular\(c\)/]],
    ['src/pages/admin/Configuracion.tsx', [/<TelefonoInput label="Teléfono"/, /control, formState/]],
    ['src/pages/admin/Proveedores.tsx', [/<TelefonoInput label="Teléfono"/]],
    ['src/pages/admin/_parts/personas/PersonasLista.tsx', [/<TelefonoInput label="Teléfono"/]],
    ['src/pages/admin/_parts/condominio/ModalDeComplejo.tsx', [/<TelefonoInput label="Celular de la administración"/, /parsearTelefono\(v\)/]],
    ['src/pages/admin/_parts/medios/MedioFormModal.tsx', [/<TelefonoInput[\s\S]*soloCelular/, /parsearCelular\(v\)/]],
    ['src/pages/superadmin/_parts/ModalDeEmpresa.tsx', [/<TelefonoInput label="Teléfono"/]],
  ];
  for (const [ruta, reglas] of pares) {
    it(`${ruta} pinta TelefonoInput y valida con el mismo criterio`, () => {
      const s = fuente(ruta);
      for (const r of reglas) assert.match(s, r);
    });
  }

  it('ningún formulario de teléfono quedó con el texto libre de antes', () => {
    for (const ruta of ['src/pages/admin/Proveedores.tsx', 'src/pages/admin/_parts/personas/PersonasLista.tsx', 'src/pages/superadmin/_parts/ModalDeEmpresa.tsx', 'src/pages/admin/Configuracion.tsx', 'src/pages/shared/Perfil.tsx']) {
      assert.doesNotMatch(fuente(ruta), /register\('telefono'\)/, ruta);
    }
    assert.doesNotMatch(fuente('src/pages/shared/_parts/AvisosPerfil.tsx'), /celularValido/);
  });

  it('perfil: un solo celular, en «Celular y avisos»; «Datos personales» ya no lo envía (guardarlo vacío borraba el de WhatsApp)', () => {
    const perfil = fuente('src/pages/shared/Perfil.tsx');
    assert.doesNotMatch(perfil, /TelefonoInput|telefono: v\./);
    assert.match(perfil, /json: \{ nombre: v\.nombre\.trim\(\) \}/);
    const avisos = fuente('src/pages/shared/_parts/AvisosPerfil.tsx');
    assert.match(avisos, /title="Celular y avisos"/);
    assert.match(avisos, /void reload\(\);\s*void refresh\(\);/, 'el resumen del perfil muestra el celular recién guardado');
    assert.doesNotMatch(fuente('src/pages/admin/_parts/medios/MedioFormModal.tsx'), /\^9\\d\{8\}/);
  });

  it('el componente se exporta desde la librería de UI', () => {
    assert.match(fuente('src/ui/index.ts'), /export \* from '\.\/TelefonoInput';/);
  });
});
