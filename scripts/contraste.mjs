// Contraste WCAG de los pares texto/fondo reales del sistema (tokens OKLCH de src/index.css).
// Uso: node scripts/contraste.mjs   (sale con código 1 si algún par de texto baja de 4.5:1)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** OKLCH (L 0–1, C, H en grados) → sRGB 0–1 (con recorte al gamut). */
export function oklchASrgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  });
}

const lineal = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const luminancia = ([r, g, b]) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);

/** Razón de contraste WCAG entre dos colores sRGB (1–21). */
export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Lee `--nombre: L C H;` de los bloques `:root` y `.dark` de un CSS. */
export function leerTokens(css) {
  const bloque = (selector) => {
    const i = css.indexOf(`${selector} {`);
    return css.slice(i, css.indexOf('}', i));
  };
  const parse = (txt) => {
    const out = {};
    for (const m of txt.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*;/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
    return out;
  };
  const claro = parse(bloque(':root'));
  return { claro, oscuro: { ...claro, ...parse(bloque('.dark')) } };
}

/** [texto, fondo, descripción] — los pares que la interfaz usa de verdad. */
export const PARES = [
  ['ink', 'surface', 'texto sobre tarjeta'],
  ['ink', 'bg', 'texto sobre la página'],
  ['muted', 'surface', 'texto secundario sobre tarjeta'],
  ['muted', 'bg', 'texto secundario sobre la página'],
  ['muted', 'surface-2', 'texto secundario sobre filas/pestañas (hover, ghost)'],
  ['brand', 'surface', 'enlace/acento sobre tarjeta'],
  ['on-brand', 'brand', 'botón primario'],
  ['on-brand', 'brand-hover', 'botón primario (hover)'],
  ['on-brand', 'bad', 'botón de peligro'],
  ['ok', 'ok-soft', 'estado pagado / alerta ok'],
  ['warn', 'warn-soft', 'estado por vencer / alerta'],
  ['bad', 'bad-soft', 'estado vencido / alerta de error'],
  ['info', 'info-soft', 'estado informativo'],
  ['brand', 'brand-soft', 'avatar / insignia de marca'],
  ['bad', 'surface', 'mensaje de error de un campo'],
  ['ok', 'surface', 'ícono/estado ok sobre tarjeta'],
];

/** Componentes no textuales (WCAG 1.4.11, mínimo 3:1): relleno de barras, bordes de campos. Se informan aparte; no hacen fallar el script. */
export const PARES_NO_TEXTO = [
  ['ok', 'surface-2', 'relleno de la barra de avance (ok)'],
  ['brand', 'surface-2', 'relleno de la barra de avance (brand)'],
  ['warn', 'surface-2', 'relleno de la barra de avance (warn)'],
  ['bad', 'surface-2', 'relleno de la barra de avance (bad)'],
  ['info', 'surface-2', 'relleno de la barra de avance (info)'],
  ['brand', 'surface', 'anillo de foco sobre tarjeta'],
  ['line', 'surface', 'borde de campos de formulario'],
];

export function calcularNoTexto(css) {
  const t = leerTokens(css);
  return ['claro', 'oscuro'].flatMap((tema) =>
    PARES_NO_TEXTO.map(([fg, bg, uso]) => ({ tema, fg, bg, uso, razon: contraste(oklchASrgb(...t[tema][fg]), oklchASrgb(...t[tema][bg])) })),
  );
}

export function calcular(css) {
  const t = leerTokens(css);
  return ['claro', 'oscuro'].flatMap((tema) =>
    PARES.map(([fg, bg, uso]) => ({ tema, fg, bg, uso, razon: contraste(oklchASrgb(...t[tema][fg]), oklchASrgb(...t[tema][bg])) })),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const filas = calcular(css);
  for (const f of filas) console.log(`${f.razon >= 4.5 ? 'OK  ' : 'FALLA'} ${f.razon.toFixed(2).padStart(5)}:1  ${f.tema.padEnd(6)} ${f.fg} / ${f.bg}  (${f.uso})`);
  console.log('\nComponentes no textuales (mínimo 3:1, informativo):');
  for (const f of calcularNoTexto(css)) console.log(`${f.razon >= 3 ? 'OK  ' : 'BAJO '} ${f.razon.toFixed(2).padStart(5)}:1  ${f.tema.padEnd(6)} ${f.fg} / ${f.bg}  (${f.uso})`);
  const malos = filas.filter((f) => f.razon < 4.5);
  console.log(malos.length ? `\n${malos.length} par(es) bajo 4.5:1` : '\nTodos los pares ≥ 4.5:1');
  process.exit(malos.length ? 1 : 0);
}
