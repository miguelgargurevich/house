// Lógica pura (sin React ni red) de cuánto se espera una evaluación «pendiente» y qué se le dice a la persona: nunca un spinner infinito.

/** Cada cuánto se consulta el estado de la evaluación. */
export const INTERVALO_EVALUACION_MS = 3000;
/** Pasado este tiempo «Evaluando…» ya no es normal: se avisa que se puede seguir sin la IA. */
export const AVISO_TARDA_MS = 20_000;
/** Pasado este tiempo se deja de consultar y se muestra el estado (el servidor da por terminada la evaluación en ~3 min como mucho). */
export const TOPE_ESPERA_MS = 180_000;

export type FaseEspera = 'normal' | 'tarda' | 'agotada';

export function faseDeEspera(esperadoMs: number): FaseEspera {
  if (esperadoMs >= TOPE_ESPERA_MS) return 'agotada';
  return esperadoMs >= AVISO_TARDA_MS ? 'tarda' : 'normal';
}

export const AVISO_TARDA_GESTION = 'La IA está tardando más de lo normal; puedes validarlo tú.';
export const AVISO_TARDA_RESIDENTE = 'Lo revisará una persona si la IA no responde.';
export const AGOTADA_GESTION = 'La IA no respondió a tiempo. Puedes reintentar o validarlo tú.';
export const AGOTADA_RESIDENTE = 'Tu comprobante quedó en revisión: la administración lo validará.';

type EstadoEv = 'pendiente' | 'completada' | 'error' | 'no_disponible';

/** Mensaje para quien valida cuando la evaluación no dio resultado (error, sin IA o sin respuesta a tiempo). */
export function mensajeSinResultado(estado: EstadoEv, motivo: string | null, agotada: boolean): string | null {
  if (estado === 'pendiente') return agotada ? AGOTADA_GESTION : null;
  if (estado === 'error') return `La IA no pudo evaluar el comprobante${motivo ? `: ${motivo}` : ''}. Puedes reintentar o validarlo tú.`;
  if (estado === 'no_disponible') return `${motivo ?? 'La evaluación automática no está disponible.'} Puedes reintentar o validarlo tú.`;
  return null;
}

/** ¿Hay un spinner? Sólo mientras la evaluación está pendiente (o se pidió otra) Y no se agotó la espera. */
export const estaEvaluando = (estado: EstadoEv | undefined, reevaluando: boolean, fase: FaseEspera) => fase !== 'agotada' && (reevaluando || estado === 'pendiente');

/** «Reintentar» cuando no hubo resultado; «Volver a evaluar» cuando lo hubo. */
export const etiquetaReintento = (estado: EstadoEv | undefined, fase: FaseEspera) =>
  estado === 'error' || estado === 'no_disponible' || (estado === 'pendiente' && fase === 'agotada') ? 'Reintentar' : 'Volver a evaluar';
