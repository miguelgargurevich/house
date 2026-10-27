// Lógica pura (sin React ni red) del seguimiento de un pago registrado con voucher: en qué fase está y por qué quedó en revisión.

export type FaseVoucher = 'revisando' | 'pagado' | 'en_revision' | 'rechazado';

/** Lo mínimo del pago principal (de `GET /api/recibos/:id/mantenimientos/:unidadId`, vista completa) que decide la fase. */
export interface PagoSeguimiento {
  estado_validacion: 'por_validar' | 'validado' | 'rechazado';
  validado_por_ia: boolean;
  motivo_rechazo: string | null;
  evaluacion: { estado: string; veredicto?: string | null; resumen?: string | null; error?: string | null } | null;
}

/** Cada cuánto se consulta y cuántas veces como máximo (~2 min: no se queda dando vueltas para siempre). */
export const INTERVALO_SEGUIMIENTO_MS = 3000;
export const MAX_CONSULTAS_SEGUIMIENTO = 40;

const terminada = (e: NonNullable<PagoSeguimiento['evaluacion']>) => e.estado !== 'pendiente';

/**
 * Fase del pago.
 *  - `lecturasTerminadas`: veces seguidas que se vio la evaluación terminada con el pago aún por validar. Si la IA vio un «coincide», puede
 *    estar a punto de validar sola (guarda su lectura y valida un instante después), así que se espera a una segunda lectura antes de
 *    decir «en revisión»; con cualquier otro resultado la IA no valida sola y se dice de inmediato.
 *  - `agotado`: se acabó el tiempo de espera; el pago sigue su curso en el historial.
 */
export function faseVoucher(p: PagoSeguimiento | null, lecturasTerminadas: number, agotado = false): FaseVoucher {
  if (!p) return agotado ? 'en_revision' : 'revisando';
  if (p.estado_validacion === 'validado') return 'pagado';
  if (p.estado_validacion === 'rechazado') return 'rechazado';
  const ev = p.evaluacion;
  if (!ev || !terminada(ev)) return agotado ? 'en_revision' : 'revisando';
  return ev.estado === 'completada' && ev.veredicto === 'coincide' && lecturasTerminadas < 2 && !agotado ? 'revisando' : 'en_revision';
}

/** ¿Hay que seguir consultando? Sólo mientras la fase sea «revisando». */
export const sigueRevisando = (fase: FaseVoucher) => fase === 'revisando';

/** Frase para quien registró el pago: por qué quedó en revisión. Nunca inventa: usa lo que dijo la evaluación. */
export function motivoEnRevision(p: PagoSeguimiento | null, agotado = false): string {
  const ev = p?.evaluacion ?? null;
  if (!ev || !terminada(ev)) return agotado ? 'La revisión automática está tardando más de lo normal.' : 'Aún no se evaluó el voucher.';
  if (ev.estado === 'no_disponible') return ev.error ?? 'La revisión automática no está disponible.';
  if (ev.estado === 'error') return `No se pudo evaluar el voucher${ev.error ? `: ${ev.error}` : ''}.`;
  if (ev.veredicto === 'coincide') return 'La IA vio el voucher correcto, pero no lo validó sola (la validación automática del condominio está desactivada, o la confianza o el control de duplicados no alcanzaron).';
  return ev.resumen ?? 'La IA pide que lo revises a mano.';
}
