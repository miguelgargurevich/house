/** «Volver a revisar» un pago rechazado: reglas puras (sin React ni red) de quién puede, cómo se pide el motivo y qué se dice antes de confirmar. El servidor es quien manda (403/404/409). */
import { puedeValidar } from './conformidad';

export const MOTIVO_REAPERTURA_MIN = 5;
export const MOTIVO_REAPERTURA_MAX = 200;

/** Mensaje para el campo del motivo; `undefined` si está bien. */
export function errorMotivoReapertura(motivo: string): string | undefined {
  const t = motivo.trim();
  if (t.length < MOTIVO_REAPERTURA_MIN) return `Escribe un motivo de al menos ${MOTIVO_REAPERTURA_MIN} caracteres.`;
  if (t.length > MOTIVO_REAPERTURA_MAX) return `El motivo admite hasta ${MOTIVO_REAPERTURA_MAX} caracteres.`;
  return undefined;
}

/**
 * ¿Se ofrece «Volver a revisar»? Sólo la administración (admin y superadmin entrando como admin) y sólo en un pago RECHAZADO. La junta (presidente, tesorero),
 * el vecino y el personal nunca. Que además se pueda HOY (otro pago vigente del mismo cargo, mes cerrado…) lo dice `GET /api/pagos/:id/reapertura`.
 */
export const puedeReabrir = (user: Parameters<typeof puedeValidar>[0], estado: string): boolean => puedeValidar(user) && estado === 'rechazado';

/** Lo que pasa al volver a revisar, dicho antes de confirmar (una línea). */
export const textoReabrir = (codigo?: string | null): string =>
  `El pago vuelve a Por validar y el recibo${codigo ? ` de ${codigo}` : ''} queda en revisión.`;

/** Lo que responde `GET /api/pagos/:id/reapertura`: si se puede y, si no, por qué (el texto del 409). */
export type Reapertura = { puede: true; motivo: null } | { puede: false; motivo: string };
