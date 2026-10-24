// Parámetros de un turno del chat (los mismos que usa My Workspace: creatividad, modelo y esfuerzo) y las reglas por rol.
// La regla de quién puede qué se aplica AQUÍ, en el servidor: ocultar controles en la pantalla no es una defensa.
import type { Rol } from '../config';
import { ESFUERZOS, LIMITES, MAX_TOKENS_RESIDENTE, PRESETS, PRESET_IDS, type Esfuerzo, type ParametrosGeneracion, type PresetId } from './modelosIA';
import { z } from '../validation';

export const PARAMETROS_DEFECTO: ParametrosGeneracion = { temperature: 0.7, maxTokens: 1024, topP: 0.95, topK: 40 };

const rango = ([min, max]: readonly [number, number], unidad = '') => ({ min, max, mensaje: `Debe estar entre ${min} y ${max}${unidad}` });
const t = rango(LIMITES.temperature);
const m = rango(LIMITES.maxTokens);
const tp = rango(LIMITES.topP);
const tk = rango(LIMITES.topK);

export const parametrosSchema = z.object({
  temperature: z.number({ error: 'Debe ser un número' }).min(t.min, t.mensaje).max(t.max, t.mensaje),
  maxTokens: z.number({ error: 'Debe ser un número' }).int('Debe ser un entero').min(m.min, m.mensaje).max(m.max, m.mensaje),
  topP: z.number({ error: 'Debe ser un número' }).min(tp.min, tp.mensaje).max(tp.max, tp.mensaje),
  topK: z.number({ error: 'Debe ser un número' }).int('Debe ser un entero').min(tk.min, tk.mensaje).max(tk.max, tk.mensaje),
});

/** Todo lo del turno salvo el mensaje (ése conserva su error histórico `{ error: { code, message } }`). */
export const ajustesSchema = z
  .object({
    conversacion_id: z.string({ error: 'Debe ser un texto' }).trim().min(1).max(40).optional(),
    ruta: z.string({ error: 'Debe ser un texto' }).max(200).optional(),
    modelo: z.string({ error: 'Debe ser un texto' }).trim().min(1, 'Es obligatorio').max(120).regex(/^[\w.:/-]+$/, 'Modelo inválido').default('auto'),
    preset: z.enum(PRESET_IDS, { error: `Debe ser: ${PRESET_IDS.join(', ')}` }).default('equilibrado'),
    parametros: parametrosSchema.optional(),
    esfuerzo: z.enum(ESFUERZOS, { error: `Debe ser: ${ESFUERZOS.join(', ')}` }).default('medium'),
  })
  .refine((v) => v.preset !== 'a_medida' || v.parametros !== undefined, { path: ['parametros'], message: 'Es obligatorio con el preset «a_medida»' });
export type Ajustes = z.infer<typeof ajustesSchema>;

/** Sólo admin y superadmin eligen modelo y esfuerzo y pasan de 1024 tokens. */
export const puedeElegir = (rol: Rol) => rol === 'admin' || rol === 'superadmin';

export interface AjustesAplicados {
  /** `null` = Auto. */
  modeloFijo: string | null;
  preset: PresetId;
  parametros: ParametrosGeneracion;
  esfuerzo: Esfuerzo;
  /** Quien no puede elegir queda con auto/medio y el tope de tokens, aunque mande otra cosa. */
  limitado: boolean;
}

export function aplicarAjustes(rol: Rol, a: Ajustes): AjustesAplicados {
  const base: ParametrosGeneracion = a.preset === 'a_medida' ? { ...a.parametros! } : { temperature: PRESETS[a.preset].temperature, maxTokens: PRESETS[a.preset].maxTokens, topP: PRESETS[a.preset].topP, topK: PRESETS[a.preset].topK };
  if (puedeElegir(rol)) return { modeloFijo: a.modelo === 'auto' ? null : a.modelo, preset: a.preset, parametros: base, esfuerzo: a.esfuerzo, limitado: false };
  return { modeloFijo: null, preset: a.preset, parametros: { ...base, maxTokens: Math.min(base.maxTokens, MAX_TOKENS_RESIDENTE) }, esfuerzo: 'medium', limitado: true };
}
