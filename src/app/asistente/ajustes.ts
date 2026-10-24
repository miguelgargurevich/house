// Elecciones del compositor (modelo, creatividad, esfuerzo) y borrador: lógica pura, sin React. Se guardan por usuario en `localStorage`
// (siempre con try/catch: puede estar bloqueado). Por omisión: Auto + Equilibrado + Medio.
import type { Ajustes, Esfuerzo, ModeloOpcion, OpcionesChat, Parametros, PresetId, PresetOpcion } from './tipos';

export const LIMITES = {
  temperature: { min: 0, max: 2, paso: 0.05 },
  maxTokens: { min: 128, max: 4096, paso: 64 },
  topP: { min: 0, max: 1, paso: 0.05 },
  topK: { min: 1, max: 100, paso: 1 },
} as const;

/** Mismos valores que las tablas del servidor (el servidor es quien manda; esto sólo evita un parpadeo antes de cargar las opciones). */
export const PARAMETROS_EQUILIBRADO: Parametros = { temperature: 0.7, maxTokens: 1024, topP: 0.95, topK: 40 };
export const AJUSTES_DEFECTO: Ajustes = { modelo: 'auto', preset: 'equilibrado', parametros: PARAMETROS_EQUILIBRADO, esfuerzo: 'medium' };
export const NOMBRE_PRESET: Record<PresetId, string> = { preciso: 'Preciso', equilibrado: 'Equilibrado', creativo: 'Creativo', a_medida: 'A medida' };
export const NOMBRE_ESFUERZO: Record<Esfuerzo, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto' };

const acotar = (v: unknown, { min, max }: { min: number; max: number }, defecto: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : defecto;
  return Math.min(max, Math.max(min, n));
};

export function normalizarParametros(raw: unknown, tope: number = LIMITES.maxTokens.max): Parametros {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    temperature: acotar(r.temperature, LIMITES.temperature, PARAMETROS_EQUILIBRADO.temperature),
    maxTokens: Math.round(acotar(r.maxTokens, { min: LIMITES.maxTokens.min, max: Math.min(tope, LIMITES.maxTokens.max) }, PARAMETROS_EQUILIBRADO.maxTokens)),
    topP: acotar(r.topP, LIMITES.topP, PARAMETROS_EQUILIBRADO.topP),
    topK: Math.round(acotar(r.topK, LIMITES.topK, PARAMETROS_EQUILIBRADO.topK)),
  };
}

const igualesParams = (a: Parametros, b: Parametros) => a.temperature === b.temperature && a.maxTokens === b.maxTokens && a.topP === b.topP && a.topK === b.topK;

/** Si el rótulo dice un preset pero los valores son otros, el rótulo pasa a «A medida»: nunca se muestra «Equilibrado» sobre valores distintos. */
export function presetEfectivo(preset: PresetId, parametros: Parametros, presets: PresetOpcion[]): PresetId {
  if (preset === 'a_medida') return 'a_medida';
  const tabla = presets.find((p) => p.id === preset)?.parametros;
  return tabla && igualesParams(tabla, parametros) ? preset : 'a_medida';
}

/** Lee lo guardado y lo deja válido para ESTE usuario (lo que no puede elegir vuelve a su valor por omisión). */
export function normalizarAjustes(raw: unknown, opciones: OpcionesChat | null): Ajustes {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const tope = opciones?.max_tokens ?? 1024;
  const parametros = normalizarParametros(r.parametros, tope);
  let preset: PresetId = (['preciso', 'equilibrado', 'creativo', 'a_medida'] as const).find((p) => p === r.preset) ?? 'equilibrado';
  const presets = opciones?.presets ?? [];
  if (presets.length) preset = presetEfectivo(preset, parametros, presets);
  else if (preset !== 'a_medida' && preset !== 'equilibrado') preset = 'a_medida';
  const esfuerzo = (['low', 'medium', 'high'] as const).find((e) => e === r.esfuerzo) ?? 'medium';
  let modelo = typeof r.modelo === 'string' && r.modelo ? r.modelo : 'auto';
  if (opciones) {
    if (!opciones.puede_elegir_modelo || (modelo !== 'auto' && !opciones.modelos.some((m) => m.id === modelo))) modelo = 'auto'; // un modelo retirado ya no se ofrece
  }
  return { modelo, preset, parametros, esfuerzo: opciones && !opciones.puede_elegir_esfuerzo ? 'medium' : esfuerzo };
}

/** Elegir un preset carga sus valores («A medida» conserva los que había). */
export function elegirPreset(a: Ajustes, preset: PresetId, presets: PresetOpcion[]): Ajustes {
  if (preset === 'a_medida') return { ...a, preset };
  const tabla = presets.find((p) => p.id === preset)?.parametros;
  return tabla ? { ...a, preset, parametros: { ...tabla } } : { ...a, preset };
}

/** Tocar una barra pasa SIEMPRE a «A medida». */
export function cambiarParametro(a: Ajustes, campo: keyof Parametros, valor: number): Ajustes {
  return { ...a, preset: 'a_medida', parametros: normalizarParametros({ ...a.parametros, [campo]: valor }) };
}

/** Cuerpo de la petición: sólo manda lo que este usuario puede elegir (el servidor igual lo vuelve a aplicar). */
export function cuerpoDeAjustes(a: Ajustes, opciones: OpcionesChat | null) {
  const elegirModelo = opciones?.puede_elegir_modelo ?? false;
  const elegirEsfuerzo = opciones?.puede_elegir_esfuerzo ?? false;
  return {
    ...(elegirModelo && a.modelo !== 'auto' ? { modelo: a.modelo } : {}),
    preset: a.preset,
    ...(a.preset === 'a_medida' ? { parametros: a.parametros } : {}),
    ...(elegirEsfuerzo ? { esfuerzo: a.esfuerzo } : {}),
  };
}

/** ¿El esfuerzo tiene efecto con este modelo? Sólo los que razonan (compatibles) o Gemini 2.5+ con «pensar». */
export function esfuerzoSeAplica(m: ModeloOpcion | undefined): boolean {
  if (!m) return false;
  if (m.categoria === 'razonamiento') return true;
  return /Gemini/i.test(m.proveedor) && /^gemini-(2\.5|[3-9])|-latest$/i.test(m.id);
}

/** Texto del menú cuando el esfuerzo no se aplicará (o no está garantizado); `null` si se aplica. */
export function avisoEsfuerzo(a: Ajustes, opciones: OpcionesChat): string | null {
  if (a.modelo === 'auto') return 'En modo Auto el esfuerzo se usa sólo si el modelo elegido razona; no está garantizado.';
  const m = opciones.modelos.find((x) => x.id === a.modelo);
  return esfuerzoSeAplica(m) ? null : 'Este modelo no razona: el esfuerzo no se aplicará.';
}

// ---------- Almacenamiento (por usuario, con try/catch) ----------
type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const almacenReal = (): Almacen | null => { try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; } };

export const claveAjustes = (usuarioId: number) => `house:asistente:ajustes:${usuarioId}`;
export const claveBorrador = (usuarioId: number) => `house:asistente:borrador:${usuarioId}`;

export function leerJson(usuarioId: number, almacen: Almacen | null = almacenReal()): unknown {
  try { const t = almacen?.getItem(claveAjustes(usuarioId)); return t ? JSON.parse(t) : null; } catch { return null; }
}
export function guardarAjustes(usuarioId: number, a: Ajustes, almacen: Almacen | null = almacenReal()): void {
  try { almacen?.setItem(claveAjustes(usuarioId), JSON.stringify(a)); } catch { /* sin almacenamiento: las elecciones valen sólo mientras la pantalla esté abierta */ }
}
export function leerBorrador(usuarioId: number, almacen: Almacen | null = almacenReal()): string {
  try { return almacen?.getItem(claveBorrador(usuarioId)) ?? ''; } catch { return ''; }
}
export function guardarBorrador(usuarioId: number, texto: string, almacen: Almacen | null = almacenReal()): void {
  try { if (texto) almacen?.setItem(claveBorrador(usuarioId), texto); else almacen?.removeItem(claveBorrador(usuarioId)); } catch { /* sin almacenamiento */ }
}
