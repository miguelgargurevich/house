/** Cómo se ve una evaluación de comprobante según quién mira: la junta y el admin ven todo; el residente, sólo un estado simple. */
import type { Prisma } from '@prisma/client';

export const selectEvaluacion = {
  id: true, estado: true, proveedor: true, modelo: true, veredicto: true, confianza: true, extraido: true, coincidencias: true,
  alertas: true, resumen: true, intentos: true, error: true, evaluada_at: true, updated_at: true,
} satisfies Prisma.EvaluacionComprobanteSelect;

export type EstadoResidente = 'evaluando' | 'revisado' | 'necesita_revision' | 'no_disponible';

/** Sin veredicto ni alertas: «revisado» sólo si la IA vio todo en orden; cualquier otra cosa es «necesita revisión» (mensaje neutro). */
export function estadoParaResidente(ev: { estado: string; veredicto: string | null } | null | undefined): EstadoResidente | null {
  if (!ev) return null;
  if (ev.estado === 'pendiente') return 'evaluando';
  if (ev.estado === 'no_disponible') return 'no_disponible';
  if (ev.estado === 'completada' && ev.veredicto === 'coincide') return 'revisado';
  return 'necesita_revision';
}

/** Reemplaza `evaluacion` por `{ estado }` simple (o null). Nunca deja pasar alertas, extraído ni comprobaciones. */
export function conVistaResidente<T extends { evaluacion?: { estado: string; veredicto: string | null } | null }>(p: T): Omit<T, 'evaluacion'> & { evaluacion: { estado: EstadoResidente } | null } {
  const { evaluacion, ...resto } = p;
  const estado = estadoParaResidente(evaluacion);
  return { ...resto, evaluacion: estado ? { estado } : null };
}
