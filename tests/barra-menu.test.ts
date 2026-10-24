// Lógica pura de la barra lateral compacta: ancho, persistencia segura, atajo de teclado y ancho del asistente según la barra.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BARRA_ANCHA, BARRA_RIEL, CLAVE_BARRA, anchoBarra, enCampoDeTexto, esAtajoMenu, guardarColapsada, leerColapsada } from '../src/app/barra';
import { acotarAncho, ANCHO_MAX } from '../src/app/asistente/panel';

const memoria = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };

describe('ancho de la barra', () => {
  it('riel 64 px, expandida 256 px', () => {
    assert.equal(anchoBarra(true), 64);
    assert.equal(anchoBarra(false), 256);
    assert.equal(BARRA_RIEL, 64);
    assert.equal(BARRA_ANCHA, 256);
  });
});

describe('persistencia', () => {
  it('por defecto expandida', () => assert.equal(leerColapsada(memoria()), false));
  it('guarda y lee', () => {
    const a = memoria();
    guardarColapsada(true, a);
    assert.equal(a.m.get(CLAVE_BARRA), '1');
    assert.equal(leerColapsada(a), true);
    guardarColapsada(false, a);
    assert.equal(leerColapsada(a), false);
  });
  it('valor basura = expandida', () => { const a = memoria(); a.setItem(CLAVE_BARRA, 'quizás'); assert.equal(leerColapsada(a), false); });
  it('sin almacenamiento o bloqueado no revienta', () => {
    assert.equal(leerColapsada(null), false);
    assert.doesNotThrow(() => guardarColapsada(true, null));
    assert.equal(leerColapsada(roto), false);
    assert.doesNotThrow(() => guardarColapsada(true, roto));
  });
});

describe('atajo de teclado', () => {
  it('«[» y Ctrl/Cmd+B alternan', () => {
    assert.equal(esAtajoMenu({ key: '[' }), true);
    assert.equal(esAtajoMenu({ key: 'b', ctrlKey: true }), true);
    assert.equal(esAtajoMenu({ key: 'B', metaKey: true }), true);
  });
  it('otras teclas o b sin Ctrl/Cmd, no', () => {
    assert.equal(esAtajoMenu({ key: 'b' }), false);
    assert.equal(esAtajoMenu({ key: ']' }), false);
    assert.equal(esAtajoMenu({ key: '[', ctrlKey: true }), false);
    assert.equal(esAtajoMenu({ key: 'b', ctrlKey: true, shiftKey: true }), false);
    assert.equal(esAtajoMenu({ key: '[', altKey: true }), false);
  });
  it('no en campos de texto', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'DIV', getAttribute: () => 'textbox' }]) {
      assert.equal(esAtajoMenu({ key: '[', target }), false);
      assert.equal(esAtajoMenu({ key: 'b', ctrlKey: true, target }), false);
    }
    assert.equal(enCampoDeTexto({ tagName: 'BUTTON' }), false);
    assert.equal(enCampoDeTexto(null), false);
  });
  it('no al mantener la tecla ni si ya se atendió', () => {
    assert.equal(esAtajoMenu({ key: '[', repeat: true }), false);
    assert.equal(esAtajoMenu({ key: '[', defaultPrevented: true }), false);
  });
});

describe('asistente según el ancho real de la barra', () => {
  it('con riel el panel puede ser más ancho que con la barra expandida', () => {
    assert.equal(acotarAncho(ANCHO_MAX, 1280, BARRA_ANCHA), 544);
    assert.equal(acotarAncho(ANCHO_MAX, 1280, BARRA_RIEL), ANCHO_MAX);
  });
  it('sin tercer argumento asume la barra expandida (compatibilidad)', () => assert.equal(acotarAncho(ANCHO_MAX, 1280), 544));
});
