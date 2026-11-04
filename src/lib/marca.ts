// Marca propia de la empresa administradora: del color que elige (hex) salen los tokens de tema de Torre, en claro y en oscuro, con el contraste del
// texto sobre la marca garantizado (WCAG AA, 4.5:1). Función PURA y sin dependencias: la usan el servidor (correos) y el cliente (la app).
// Los tokens están en el mismo formato que `src/index.css` («L C H», oklch sin la función) para pegarlos tal cual en `document.documentElement`.

export const VERDE_TORRE_HEX = '#007565';
/** Contraste mínimo del texto sobre la marca (WCAG AA, texto normal). */
export const CONTRASTE_MINIMO = 4.5;
/** Margen sobre el mínimo: el hex de 8 bits redondea y el contraste final no debe bajar de 4.5 por eso. */
const MARGEN = 0.05;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const esHexColor = (v: unknown): v is string => typeof v === 'string' && HEX_COLOR.test(v);

export interface TokensDeTema {
  brand: string;
  brandHover: string;
  brandSoft: string;
  onBrand: string;
  escena: string;
}
export interface PaletaDeMarca {
  claro: TokensDeTema;
  oscuro: TokensDeTema;
  /** Los mismos tokens como hex (`#RRGGBB`): los correos no entienden oklch. */
  hex: { claro: TokensDeTema; oscuro: TokensDeTema };
  /** El color elegido llegó oscurecido (en el tema claro) porque con texto claro no alcanzaba 4.5:1. */
  ajustado: boolean;
  /** Contraste real de `--on-brand` sobre `--brand` en cada tema (calculado sobre el hex que se muestra). */
  contraste: { claro: number; oscuro: number };
}

interface Oklch { L: number; C: number; H: number }

// ---------- Conversión (Björn Ottosson, oklab a sRGB lineal y al revés) ----------
const aLineal = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const deLineal = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function hexARgbLineal(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [aLineal(((n >> 16) & 255) / 255), aLineal(((n >> 8) & 255) / 255), aLineal((n & 255) / 255)];
}

function rgbLinealAOklch([r, g, b]: [number, number, number]): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  // Un gris no tiene matiz: se deja en 0 en vez de un ángulo de puro ruido.
  const H = C < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { L, C: C < 1e-4 ? 0 : C, H };
}

function oklchARgbLineal({ L, C, H }: Oklch): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const enGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** Baja el croma hasta que el color cabe en sRGB (mismo L y matiz): lo que se calcula es lo que se ve, sin recortes del navegador. */
function dentroDeGamut(c: Oklch): Oklch {
  if (enGamut(oklchARgbLineal(c))) return c;
  let lo = 0;
  let hi = c.C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (enGamut(oklchARgbLineal({ ...c, C: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...c, C: lo };
}

const redondear = (v: number, d: number) => Number(v.toFixed(d));
/** Redondeo del token tal como se escribe en el CSS. */
const limpio = (c: Oklch): Oklch => ({ L: redondear(c.L, 4), C: redondear(c.C, 4), H: redondear(c.H, 2) });
const texto = (c: Oklch): string => `${redondear(c.L, 4)} ${redondear(c.C, 4)} ${redondear(c.H, 2)}`;

function aHex(c: Oklch): string {
  const rgb = oklchARgbLineal(c).map((v) => Math.round(Math.min(1, Math.max(0, deLineal(Math.min(1, Math.max(0, v))))) * 255));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function luminancia(hex: string): number {
  const [r, g, b] = hexARgbLineal(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores `#RRGGBB` (1 a 21). */
export function contrasteWcag(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------- Paleta ----------
/** Tokens de Torre tal como están en `src/index.css`. El verde de Torre sale SIN cambios (no pasa por la conversión). */
const TORRE: Record<'claro' | 'oscuro', TokensDeTema> = {
  claro: { brand: '0.5 0.1 180', brandHover: '0.43 0.095 180', brandSoft: '0.953 0.03 180', onBrand: '0.99 0.005 180', escena: '0.5 0.1 180' },
  oscuro: { brand: '0.74 0.11 180', brandHover: '0.8 0.11 180', brandSoft: '0.3 0.05 180', onBrand: '0.17 0.02 180', escena: '0.23 0.04 180' },
};

const aHexTema = (t: Record<keyof TokensDeTema, Oklch>): TokensDeTema => ({
  brand: aHex(t.brand), brandHover: aHex(t.brandHover), brandSoft: aHex(t.brandSoft), onBrand: aHex(t.onBrand), escena: aHex(t.escena),
});

function aOklchTexto(s: string): Oklch {
  const [L, C, H] = s.split(' ').map(Number);
  return { L: L!, C: C!, H: H! };
}

function armarTemaClaro(base: Oklch): Record<keyof TokensDeTema, Oklch> {
  const brand = limpio(dentroDeGamut(base));
  const hover = limpio(dentroDeGamut({ L: brand.L < 0.3 ? brand.L + 0.08 : brand.L - 0.07, C: brand.C * 0.95, H: brand.H }));
  const soft = limpio(dentroDeGamut({ L: 0.953, C: Math.min(0.03, brand.C * 0.3), H: brand.H }));
  const onBrand = limpio({ L: 0.99, C: 0.005, H: brand.H });
  return { brand, brandHover: hover, brandSoft: soft, onBrand, escena: brand };
}

function armarTemaOscuro(base: Oklch): Record<keyof TokensDeTema, Oklch> {
  // En oscuro la marca va más clara para contrastar con el fondo; el texto sobre ella es el oscuro de siempre.
  const L = Math.min(0.88, Math.max(0.74, base.L));
  const brand = limpio(dentroDeGamut({ L, C: base.C * 1.1, H: base.H }));
  const hover = limpio(dentroDeGamut({ L: brand.L + 0.06, C: brand.C, H: brand.H }));
  const soft = limpio(dentroDeGamut({ L: 0.3, C: Math.min(0.05, brand.C * 0.5), H: brand.H }));
  const onBrand = limpio({ L: 0.17, C: 0.02, H: brand.H });
  const escena = limpio(dentroDeGamut({ L: 0.23, C: Math.min(0.04, brand.C * 0.4), H: brand.H }));
  return { brand, brandHover: hover, brandSoft: soft, onBrand, escena };
}

const tokensComoTexto = (t: Record<keyof TokensDeTema, Oklch>): TokensDeTema => ({
  brand: texto(t.brand), brandHover: texto(t.brandHover), brandSoft: texto(t.brandSoft), onBrand: texto(t.onBrand), escena: texto(t.escena),
});

/** ¿El color elegido es (casi) el verde de Torre? Tolerancia de redondeo del hex: en ese caso no se toca nada. */
function esVerdeTorre(c: Oklch): boolean {
  const t = aOklchTexto(TORRE.claro.brand);
  const dh = Math.min(Math.abs(c.H - t.H), 360 - Math.abs(c.H - t.H));
  return Math.abs(c.L - t.L) < 0.01 && Math.abs(c.C - t.C) < 0.01 && dh < 3;
}

/**
 * Tokens de tema (claro y oscuro) para un color de marca `#RRGGBB`. Hex inválido → lanza `Error`.
 * Garantía: `--on-brand` sobre `--brand` ≥ 4.5:1 en los dos temas. Si en claro el color no llega con texto claro, se baja su L (oklch) lo justo y
 * `ajustado` es `true`. El verde de Torre devuelve los tokens de `index.css` sin cambios.
 */
export function paletaDeMarca(hex: string): PaletaDeMarca {
  if (!esHexColor(hex)) throw new Error('El color debe ser un hex de 6 dígitos, por ejemplo #007565');
  const origen = rgbLinealAOklch(hexARgbLineal(hex));

  if (esVerdeTorre(origen)) {
    const claro = TORRE.claro;
    const oscuro = TORRE.oscuro;
    const h = {
      claro: aHexTema({ brand: aOklchTexto(claro.brand), brandHover: aOklchTexto(claro.brandHover), brandSoft: aOklchTexto(claro.brandSoft), onBrand: aOklchTexto(claro.onBrand), escena: aOklchTexto(claro.escena) }),
      oscuro: aHexTema({ brand: aOklchTexto(oscuro.brand), brandHover: aOklchTexto(oscuro.brandHover), brandSoft: aOklchTexto(oscuro.brandSoft), onBrand: aOklchTexto(oscuro.onBrand), escena: aOklchTexto(oscuro.escena) }),
    };
    return { claro: { ...claro }, oscuro: { ...oscuro }, hex: h, ajustado: false, contraste: { claro: contrasteWcag(h.claro.onBrand, h.claro.brand), oscuro: contrasteWcag(h.oscuro.onBrand, h.oscuro.brand) } };
  }

  // Tema claro: se baja la L hasta que el texto claro sobre la marca (en hex, lo que se ve) llegue a 4.5, y también la marca como texto sobre su fondo suave
  // (ítem activo del menú, enlaces): así `text-brand` se lee igual que en el verde de Torre.
  let claro = armarTemaClaro(origen);
  let ajustado = false;
  const llega = (t: Record<keyof TokensDeTema, Oklch>) => contrasteWcag(aHex(t.onBrand), aHex(t.brand)) >= CONTRASTE_MINIMO + MARGEN && contrasteWcag(aHex(t.brand), aHex(t.brandSoft)) >= CONTRASTE_MINIMO + MARGEN;
  for (let L = origen.L; !llega(claro) && L > 0; L -= 0.002) {
    claro = armarTemaClaro({ ...origen, L: Math.max(0, L) });
    ajustado = true;
  }
  const oscuro = armarTemaOscuro(origen);
  const hex_ = { claro: aHexTema(claro), oscuro: aHexTema(oscuro) };
  return {
    claro: tokensComoTexto(claro),
    oscuro: tokensComoTexto(oscuro),
    hex: hex_,
    ajustado,
    contraste: { claro: contrasteWcag(hex_.claro.onBrand, hex_.claro.brand), oscuro: contrasteWcag(hex_.oscuro.onBrand, hex_.oscuro.brand) },
  };
}

/** Nombres de variables CSS de `src/index.css` para cada token. */
export const VARIABLES_DE_TEMA: Record<keyof TokensDeTema, string> = {
  brand: '--brand',
  brandHover: '--brand-hover',
  brandSoft: '--brand-soft',
  onBrand: '--on-brand',
  escena: '--escena',
};

/** `{ '--brand': '0.5 0.1 180', … }` listo para `style.setProperty`. */
export function variablesCss(t: TokensDeTema): Record<string, string> {
  return Object.fromEntries((Object.keys(VARIABLES_DE_TEMA) as (keyof TokensDeTema)[]).map((k) => [VARIABLES_DE_TEMA[k], t[k]]));
}

/** La marca de la empresa tal como llega en `marca` de `/api/auth/me` y del login (ver `docs/API-CONTRATO.md`). */
export interface MarcaUsuario {
  /** `null` = Torre. */
  empresa_id: number | null;
  razon_social: string | null;
  /** Nombre comercial si la marca está activa y lo tiene; si no, la razón social. */
  nombre: string;
  /** Ruta de la API con `?v=`; `null` si la empresa no subió logo. */
  logo_url: string | null;
  /** `#RRGGBB` sólo con la marca activa. */
  color: string | null;
  activa: boolean;
}

export const MARCA_TORRE: MarcaUsuario = { empresa_id: null, razon_social: null, nombre: 'Torre', logo_url: null, color: null, activa: false };

/**
 * Hoja de estilos de la marca: los tokens del tema claro en `html:root` y los del oscuro en `html.dark`. Se escribe en un `<style>` (no en el `style` de
 * `<html>`: un valor en línea pisaría el tema oscuro) y su especificidad (elemento + clase) gana a `:root` y `.dark` de `index.css` sin `!important`.
 */
export function cssDeMarca(hex: string): { css: string; ajustado: boolean } {
  const p = paletaDeMarca(hex);
  const bloque = (selector: string, t: TokensDeTema) => `${selector}{${Object.entries(variablesCss(t)).map(([k, v]) => `${k}:${v}`).join(';')}}`;
  return { css: `${bloque('html:root', p.claro)}${bloque('html.dark', p.oscuro)}`, ajustado: p.ajustado };
}

/** Primera letra o número del nombre, en mayúscula: va en el cuadrito de color cuando la empresa no subió logo. */
export const inicialDeMarca = (nombre: string): string => (/[\p{L}\p{N}]/u.exec(nombre.trim())?.[0] ?? 'T').toUpperCase();
