// «Entrar como»: lo que es lógica (minutos, textos) sin React ni red; lo prueban las pruebas de Node.
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 200;

export interface Impersonando { por: { id: number; nombre: string }; motivo: string; expira_at: string }

/** Minutos que quedan (redondeo hacia arriba: «quedan 1 min» hasta el último segundo); 0 cuando ya venció. */
export function minutosRestantes(expiraAt: string | Date, ahora: number): number {
  const fin = typeof expiraAt === 'string' ? Date.parse(expiraAt) : expiraAt.getTime();
  if (!Number.isFinite(fin)) return 0;
  return Math.max(0, Math.ceil((fin - ahora) / 60_000));
}

export const quedanTexto = (min: number) => (min <= 0 ? 'terminó la sesión' : min === 1 ? 'queda 1 min' : `quedan ${min} min`);

/** Valida el motivo como lo hace el servidor (5 a 200 caracteres, sin contar espacios de los bordes). Devuelve el error o null. */
export function errorDeMotivo(motivo: string): string | null {
  const n = motivo.trim().length;
  if (n < MOTIVO_MIN) return `Escribe el motivo (mínimo ${MOTIVO_MIN} caracteres)`;
  if (n > MOTIVO_MAX) return `Máximo ${MOTIVO_MAX} caracteres`;
  return null;
}
