export type GlyphProveedor = 'googlagemini' | 'openai' | 'nvidia' | 'ollama';

export interface EntradaIcono {
  hex: string;
  mono: string;
  adaptive: boolean;
  glyph: GlyphProveedor | null;
}

const NEUTRO = '#6B7280';

const PROVEEDORES: Record<string, EntradaIcono> = {
  gemini: { hex: '#3186FF', mono: 'GE', adaptive: false, glyph: 'googlagemini' },
  openai: { hex: '#111827', mono: 'OA', adaptive: true, glyph: 'openai' },
  nvidia: { hex: '#76B900', mono: 'NV', adaptive: false, glyph: 'nvidia' },
  ollama: { hex: '#111827', mono: 'OL', adaptive: true, glyph: 'ollama' },
  deepseek: { hex: '#4D6BFE', mono: 'DS', adaptive: false, glyph: null },
  groq: { hex: '#F55036', mono: 'GQ', adaptive: false, glyph: null },
  mistral: { hex: '#FA520F', mono: 'MI', adaptive: false, glyph: null },
  openrouter: { hex: '#6467F2', mono: 'OR', adaptive: false, glyph: null },
  cerebras: { hex: '#F15A29', mono: 'CB', adaptive: false, glyph: null },
  cohere: { hex: '#39594D', mono: 'CO', adaptive: false, glyph: null },
  sambanova: { hex: '#EE3124', mono: 'SN', adaptive: false, glyph: null },
};

export function datosIconoProveedor(slug: string): EntradaIcono {
  const key = (slug || '').trim().toLowerCase();
  const entrada = PROVEEDORES[key];
  if (entrada) return entrada;
  const mono = key.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
  return { hex: NEUTRO, mono: mono || '?', adaptive: false, glyph: null };
}
