/** «Anular pago»: reglas puras (sin React ni red) de quién puede anular y cómo se pide el motivo. El servidor es quien manda (403/404/409). */
import { puedeValidar } from './conformidad';

export const MOTIVO_ANULACION_MIN = 5;
export const MOTIVO_ANULACION_MAX = 200;

/** Mensaje para el campo del motivo; `undefined` si está bien. */
export function errorMotivoAnulacion(motivo: string): string | undefined {
  const t = motivo.trim();
  if (t.length < MOTIVO_ANULACION_MIN) return `Escribe un motivo de al menos ${MOTIVO_ANULACION_MIN} caracteres.`;
  if (t.length > MOTIVO_ANULACION_MAX) return `El motivo admite hasta ${MOTIVO_ANULACION_MAX} caracteres.`;
  return undefined;
}

/**
 * ¿Se ofrece «Anular pago»? Sólo la administración (admin y superadmin entrando como admin) y sólo en un pago VALIDADO: uno por validar se rechaza y uno
 * rechazado o ya anulado no cuenta. La junta (presidente, tesorero) nunca anula.
 */
export const puedeAnular = (user: Parameters<typeof puedeValidar>[0], estado: string): boolean => puedeValidar(user) && estado === 'validado';

/** Lo que pasa al anular, dicho antes de confirmar. */
export const textoAnular = (codigo?: string | null): string =>
  `El recibo${codigo ? ` de ${codigo}` : ''} vuelve a quedar pendiente y el vecino recibe un aviso. El pago no se borra: queda anulado, con tu nombre y el motivo.`;
