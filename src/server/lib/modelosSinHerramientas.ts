// Memoria negativa de rutas (proveedor + modelo) que no admiten herramientas (tool-calling). Aparte de `modelosMalos`: el modelo sigue
// sirviendo para chatear, sólo se le pide sin herramientas (con el respaldo determinista). En memoria, como el resto de memorias de rutas.
import { cooldownDeps } from './cooldown';

export const MEMORIA_SIN_HERRAMIENTAS_MS = 60 * 60_000;

const hasta = new Map<string, number>();
const llave = (proveedor: string, modelo: string) => `${proveedor}|${modelo}`;

export function marcarSinHerramientas(proveedor: string, modelo: string, ms = MEMORIA_SIN_HERRAMIENTAS_MS): void {
  hasta.set(llave(proveedor, modelo), cooldownDeps.ahora() + ms);
}
export function sinHerramientas(proveedor: string, modelo: string, ahora = cooldownDeps.ahora()): boolean {
  const h = hasta.get(llave(proveedor, modelo));
  if (h === undefined) return false;
  if (h <= ahora) { hasta.delete(llave(proveedor, modelo)); return false; }
  return true;
}
export const limpiarSinHerramientas = () => hasta.clear();

/** Modelos que sabemos que no llaman herramientas (Gemma en la API de Gemini, razonadores antiguos, no-chat). El resto se prueba y se aprende. */
const NO_LLAMA_HERRAMIENTAS = /gemma|embed|whisper|tts|guard|safeguard|moderation|o1-(mini|preview)|deepseek-r1(?!.*0528)|distill|instruct-v0\.1|text-bison|\bbase\b/i;
export const admiteHerramientas = (modelo: string): boolean => !NO_LLAMA_HERRAMIENTAS.test(modelo);
