import type { DepsAvisos } from '../avisos/canales';
import { ENLACE_APP } from '../avisos/plantillas';

/**
 * Inyectables del bot por canal (Evolution, reloj, URL pública de House). Las pruebas los reemplazan: nunca sale nada a la red real.
 * `env` es el `process.env` vivo (sólo se leen EVOLUTION_URL / EVOLUTION_APIKEY, que ya existían: no hay variables nuevas).
 */
export const canalesDeps: DepsAvisos & { urlPublica: () => string } = {
  fetch: (...a) => fetch(...a),
  ahora: () => new Date(),
  env: process.env,
  urlPublica: () => ENLACE_APP,
};

/** Sólo los últimos dígitos: el número es un dato personal (Ley 29733) y no va en claro a ningún log. */
export const enmascarar = (identificador: string): string => `***${identificador.slice(-3)}`;
