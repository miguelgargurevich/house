// `paletaDeMarca`: de un hex salen los tokens de tema (claro y oscuro) con el contraste del texto sobre la marca garantizado (WCAG AA, 4.5:1).
// Función pura y compartida (servidor y cliente): no toca la base.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONTRASTE_MINIMO, VERDE_TORRE_HEX, contrasteWcag, esHexColor, paletaDeMarca, variablesCss } from '../src/lib/marca';

/** Colores de la matriz: los que más suelen romper un tema (muy claros, muy oscuros, saturados) y los de uso corriente. */
const MATRIZ: [string, string][] = [
  ['amarillo', '#ffff00'],
  ['blanco casi puro', '#fefefe'],
  ['negro', '#000000'],
  ['rojo', '#ff0000'],
  ['azul', '#0057b8'],
  ['naranja', '#ff9800'],
  ['morado', '#6a1b9a'],
  ['gris medio', '#808080'],
  ['celeste claro', '#a0d8ff'],
  ['verde lima', '#7fff00'],
  ['rosa', '#ff69b4'],
  ['marrón', '#5d4037'],
];

describe('paletaDeMarca: contraste', () => {
  for (const [nombre, hex] of MATRIZ) {
    it(`${nombre} (${hex}): el texto sobre la marca llega a ${CONTRASTE_MINIMO}:1 en claro y en oscuro, y la marca se lee sobre su fondo suave`, () => {
      const p = paletaDeMarca(hex);
      // Se mide sobre el hex que de verdad se muestra (el correo) y sobre cada token, no sobre un número intermedio.
      assert.ok(contrasteWcag(p.hex.claro.onBrand, p.hex.claro.brand) >= CONTRASTE_MINIMO, `claro ${p.contraste.claro}`);
      assert.ok(contrasteWcag(p.hex.oscuro.onBrand, p.hex.oscuro.brand) >= CONTRASTE_MINIMO, `oscuro ${p.contraste.oscuro}`);
      assert.ok(p.contraste.claro >= CONTRASTE_MINIMO && p.contraste.oscuro >= CONTRASTE_MINIMO);
      assert.ok(contrasteWcag(p.hex.claro.brand, p.hex.claro.brandSoft) >= CONTRASTE_MINIMO, 'text-brand sobre brand-soft (claro)');
      // En oscuro la marca también se lee sobre el fondo oscuro de la app (L 0.175 ≈ #0b1210).
      assert.ok(contrasteWcag(p.hex.oscuro.brand, '#0b1210') >= CONTRASTE_MINIMO, 'marca sobre el fondo oscuro');
    });
  }

  it('un color claro se oscurece y la función lo informa; uno que ya contrasta no se toca', () => {
    for (const hex of ['#ffff00', '#fefefe', '#ff0000', '#ff9800', '#7fff00', '#a0d8ff']) assert.equal(paletaDeMarca(hex).ajustado, true, hex);
    for (const hex of ['#000000', '#0057b8', '#6a1b9a', '#5d4037']) assert.equal(paletaDeMarca(hex).ajustado, false, hex);
  });

  it('oscurecer baja la L (oklch) pero conserva el matiz, y sólo lo justo: el contraste final queda cerca del mínimo, no muy por encima', () => {
    const amarillo = paletaDeMarca('#ffff00');
    const [L, , H] = amarillo.claro.brand.split(' ').map(Number);
    assert.ok(L! < 0.96 && L! > 0.4, `L=${L}`);
    assert.ok(Math.abs(H! - 109.77) < 0.5, `matiz ${H}`);
    assert.ok(amarillo.contraste.claro < CONTRASTE_MINIMO + 1.5, `se oscureció de más: ${amarillo.contraste.claro}`);
    // El rojo puro llega a ~4 con texto claro: se oscurece poco.
    assert.ok(paletaDeMarca('#ff0000').contraste.claro < CONTRASTE_MINIMO + 1.5);
  });

  it('el negro no se toca en claro y en oscuro sube a una versión clara; el blanco se vuelve gris con texto legible', () => {
    const negro = paletaDeMarca('#000000');
    assert.equal(negro.claro.brand, '0 0 0');
    assert.ok(Number(negro.oscuro.brand.split(' ')[0]) >= 0.74);
    const blanco = paletaDeMarca('#ffffff');
    assert.equal(blanco.ajustado, true);
    assert.ok(Number(blanco.claro.brand.split(' ')[0]) < 0.6);
    assert.ok(blanco.contraste.claro >= CONTRASTE_MINIMO);
  });
});

describe('paletaDeMarca: el verde de Torre', () => {
  it('sale SIN cambios: los mismos valores que src/index.css, sin ajuste', () => {
    const p = paletaDeMarca(VERDE_TORRE_HEX);
    assert.equal(p.ajustado, false);
    assert.deepEqual(p.claro, { brand: '0.5 0.1 180', brandHover: '0.43 0.095 180', brandSoft: '0.953 0.03 180', onBrand: '0.99 0.005 180', escena: '0.5 0.1 180' });
    assert.deepEqual(p.oscuro, { brand: '0.74 0.11 180', brandHover: '0.8 0.11 180', brandSoft: '0.3 0.05 180', onBrand: '0.17 0.02 180', escena: '0.23 0.04 180' });
  });

  it('coincide con index.css al pie de la letra (no se copió mal)', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const [claro, oscuro] = [/:root\s*{([^}]*)}/.exec(css)![1]!, /\.dark\s*{([^}]*)}/.exec(css)![1]!];
    const p = paletaDeMarca(VERDE_TORRE_HEX);
    for (const [tema, bloque] of [[p.claro, claro], [p.oscuro, oscuro]] as const) {
      for (const [variable, valor] of Object.entries(variablesCss(tema))) {
        assert.match(bloque, new RegExp(`${variable}:\\s*${valor.replace(/\./g, '\\.')};`), `${variable} = ${valor}`);
      }
    }
  });

  it('un verde casi igual (por el redondeo del hex) tampoco se mueve; uno claramente distinto sí', () => {
    assert.equal(paletaDeMarca('#007566').claro.brand, '0.5 0.1 180');
    assert.notEqual(paletaDeMarca('#2e7d32').claro.brand, '0.5 0.1 180');
  });
});

describe('paletaDeMarca: entradas', () => {
  it('hex inválido → error', () => {
    for (const malo of ['', 'rojo', '#12345', '#1234567', '#GGGGGG', '007565', '#00756', 'rgb(0,0,0)', '#ff00ff00', ' #ff0000']) {
      assert.throws(() => paletaDeMarca(malo), /hex/, JSON.stringify(malo));
      assert.equal(esHexColor(malo), false);
    }
    assert.throws(() => paletaDeMarca(null as unknown as string));
    assert.throws(() => paletaDeMarca(undefined as unknown as string));
  });

  it('mayúsculas y minúsculas dan lo mismo', () => {
    assert.deepEqual(paletaDeMarca('#0057B8'), paletaDeMarca('#0057b8'));
  });

  it('los tokens tienen el formato de index.css («L C H») y los hex son #rrggbb', () => {
    for (const [, hex] of MATRIZ) {
      const p = paletaDeMarca(hex);
      for (const tema of [p.claro, p.oscuro]) for (const v of Object.values(tema)) assert.match(v, /^\d(\.\d+)? \d(\.\d+)? \d+(\.\d+)?$/, `${hex}: ${v}`);
      for (const tema of [p.hex.claro, p.hex.oscuro]) for (const v of Object.values(tema)) assert.match(v, /^#[0-9a-f]{6}$/);
    }
  });
});
