// Catálogo de modelos de IA: lectura de `GET /models` de cada proveedor, filtro de lo que no es chat y clasificación por nombre.
// Funciones puras (sin red ni base): las usan la sincronización, la elección automática y las pruebas.
import type { ProveedorIA } from './proveedoresIA';

export const CATEGORIAS = ['rapido', 'equilibrado', 'razonamiento', 'avanzado', 'otro'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const ETIQUETA_CATEGORIA: Record<Categoria, string> = {
  razonamiento: 'Razonamiento',
  rapido: 'Rápido',
  equilibrado: 'Equilibrado',
  avanzado: 'Avanzado',
  otro: 'Otros',
};

/** Modelo tal como lo informa el proveedor, ya normalizado. */
export interface ModeloListado {
  modelo_id: string;
  nombre: string | null;
  ventana: number | null;
  vision: boolean | null;
}

// Los límites de palabra evitan falsos positivos: `mini` no debe calzar en `gemini`, ni `live` en `olive`.
const borde = (p: string) => new RegExp(`(^|[-_/.:])(${p})([-_.:]|$)`, 'i');

// Lo que NO sirve para conversar: se guarda como categoría 'otro' y nunca es elegible.
const NO_CHAT = [
  /embed|text-to-speech|speech|whisper|transcri|audio|voice|imagen|image|video|sora|dall-e|flux|stable-diffusion|moderation|safety|safeguard|shield|rerank|robotics|computer-use/i,
  borde('tts|stt|veo|live|guard|guardrail|aqa|lyria|nano-banana'),
];

export function esModeloDeChat(modelo_id: string): boolean {
  return !NO_CHAT.some((r) => r.test(modelo_id));
}

// Se evalúan en este orden; el primero que calza decide.
const RAZONAMIENTO = [/reason|think|gpt-oss/i, borde('o1|o3|o4|r1')];
const RAPIDO = [borde('flash|lite|mini|nano|small|haiku|instant|[1-8]b')];
const AVANZADO = [/large|opus|sonnet|ultra/i, borde('pro|max|70b|120b|405b|671b')];

/** Categoría por patrones de nombre. Razonamiento manda sobre rápido (p. ej. `o3-mini` razona) y rápido sobre avanzado (`flash-lite`). */
export function clasificarModelo(modelo_id: string): Categoria {
  if (!esModeloDeChat(modelo_id)) return 'otro';
  if (RAZONAMIENTO.some((r) => r.test(modelo_id))) return 'razonamiento';
  if (RAPIDO.some((r) => r.test(modelo_id))) return 'rapido';
  if (AVANZADO.some((r) => r.test(modelo_id))) return 'avanzado';
  return 'equilibrado';
}

/** OpenRouter marca los gratuitos con el sufijo `:free`. Ningún otro proveedor del catálogo lo usa. */
export const esGratis = (proveedor: string, modelo_id: string) => proveedor === 'openrouter' && /:free$/i.test(modelo_id);

const numeroOnull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null);
const textoOnull = (v: unknown, max = 160) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const idValido = (v: unknown): v is string => typeof v === 'string' && /^[\w.:/-]{1,120}$/.test(v);

/**
 * Lee la respuesta de `GET /models`. Gemini: el campo `name` trae el prefijo `models/` y sólo sirven los que soportan
 * `generateContent`. OpenAI-compatibles: el identificador es `id` (el `name` de OpenRouter es el nombre de pantalla).
 * Devuelve `null` si el cuerpo no tiene la forma esperada (eso NO es una lista vacía).
 */
export function leerListaModelos(p: Pick<ProveedorIA, 'id' | 'tipo'>, cuerpo: unknown): ModeloListado[] | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const c = cuerpo as { models?: unknown; data?: unknown };
  const lista = p.tipo === 'gemini' ? c.models : c.data;
  if (!Array.isArray(lista)) return null;
  const vistos = new Set<string>();
  const salida: ModeloListado[] = [];
  for (const item of lista) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as Record<string, unknown>;
    let id: unknown;
    let ventana: number | null = null;
    let vision: boolean | null = null;
    let nombre: string | null = null;
    if (p.tipo === 'gemini') {
      const metodos = m.supportedGenerationMethods;
      if (!Array.isArray(metodos) || !metodos.includes('generateContent')) continue;
      id = typeof m.name === 'string' ? m.name.replace(/^models\//, '') : undefined;
      ventana = numeroOnull(m.inputTokenLimit);
      nombre = textoOnull(m.displayName);
      vision = true; // la familia Gemini es multimodal
    } else {
      id = m.id;
      ventana = numeroOnull(m.context_length) ?? numeroOnull(m.context_window);
      nombre = textoOnull(m.name) ?? textoOnull(m.display_name);
      const arq = (m.architecture as { input_modalities?: unknown } | undefined)?.input_modalities;
      if (Array.isArray(arq)) vision = arq.includes('image');
    }
    if (!idValido(id) || vistos.has(id)) continue;
    vistos.add(id);
    salida.push({ modelo_id: id, nombre, ventana, vision });
  }
  return salida;
}

// ---------- Preferencias para el modo Auto ----------
/** Patrones en orden de preferencia por proveedor. Lo que no calza con ninguno va después, por nombre. */
export const PREFERENCIAS: Record<string, RegExp[]> = {
  // 24-oct (Miguel): flash-lite primero mientras `gemini-flash-latest` siga colgándose en producción (> 40 s sin responder con estas claves).
  gemini: [/^gemini-flash-lite-latest$/, /^gemini-flash-latest$/, /^gemini-2\.5-flash$/, /^gemini-[\d.]+-flash$/, /-flash$/],
  groq: [/^openai\/gpt-oss-120b$/, /-versatile$/, /^qwen/],
  openrouter: [/gemma-4.*:free$/, /nemotron.*:free$/, /:free$/],
};

export const indicePreferencia = (proveedor: string, modelo_id: string): number => {
  const lista = PREFERENCIAS[proveedor] ?? [];
  const i = lista.findIndex((r) => r.test(modelo_id));
  return i < 0 ? lista.length : i;
};

/**
 * Modelos de chat que Auto nunca pone primero: muy pequeños (<= 4B) o de nicho (24-oct: en producción Groq elegía `allam-2-7b` para
 * los mensajes cortos). Siguen como último respaldo y se pueden fijar a mano.
 */
export const esDebil = (modelo_id: string) => /allam|(^|[-_/:.])[1-4](\.\d)?b([-_:.]|$)/i.test(modelo_id);

/** Los modelos con «preview/exp» no son estables: en Auto van después de los estables. */
export const esInestable = (modelo_id: string) => /preview|exp(erimental)?\b|-exp-|-\d{2}-\d{2}$/i.test(modelo_id);

// ---------- Parámetros del turno ----------
export const PRESETS = {
  preciso: { nombre: 'Preciso', detalle: 'Respuestas más exactas y estables. Ideal para datos y pasos.', temperature: 0.2, maxTokens: 1024, topP: 0.8, topK: 20 },
  equilibrado: { nombre: 'Equilibrado', detalle: 'Un buen punto medio entre exactitud y naturalidad.', temperature: 0.7, maxTokens: 1024, topP: 0.95, topK: 40 },
  creativo: { nombre: 'Creativo', detalle: 'Respuestas más variadas y con más libertad al redactar.', temperature: 1.1, maxTokens: 2048, topP: 1, topK: 80 },
} as const;
export type PresetId = keyof typeof PRESETS | 'a_medida';
export const PRESET_IDS = ['preciso', 'equilibrado', 'creativo', 'a_medida'] as const;
export const ESFUERZOS = ['low', 'medium', 'high'] as const;
export type Esfuerzo = (typeof ESFUERZOS)[number];

export interface ParametrosGeneracion { temperature: number; maxTokens: number; topP: number; topK: number }
export const LIMITES = { temperature: [0, 2], maxTokens: [128, 4096], topP: [0, 1], topK: [1, 100] } as const;
/** Tope de `maxTokens` para quien no es administrador: se aplica en el servidor. */
export const MAX_TOKENS_RESIDENTE = 1024;

/** Margen extra para los «tokens de razonamiento», que cuentan contra el tope de salida y dejarían la respuesta cortada. */
export const MARGEN_RAZONAMIENTO: Record<Esfuerzo, number> = { low: 256, medium: 1024, high: 3072 };
export const PRESUPUESTO_PENSAR_GEMINI: Record<Esfuerzo, number> = { low: 128, medium: 1024, high: 4096 };

/** ¿El modelo de Gemini admite `thinkingConfig`? (2.5 en adelante y los alias `*-latest`). */
export const geminiAdmitePensar = (modelo: string) => /^gemini-(2\.5|[3-9])|-latest$/i.test(modelo);
/** ¿Entiende `reasoning_effort`? Sólo los de categoría razonamiento. */
export const admiteEsfuerzo = (modelo: string) => clasificarModelo(modelo) === 'razonamiento';
/** `top_k` sólo lo acepta OpenRouter entre los compatibles con OpenAI del catálogo. */
export const aceptaTopK = (proveedor: ProveedorIA) => proveedor.tipo === 'gemini' || proveedor.id === 'openrouter';

/** Nombre legible para mostrar: el del proveedor o, si falta, el identificador. */
export const nombreModelo = (m: { nombre: string | null; modelo_id: string }) => m.nombre ?? m.modelo_id;
