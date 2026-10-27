import type { FechaOrigen } from './tipos';

/** Qué significa la fecha de un pago: la fecha de pago es la del voucher que leyó la IA (ver `src/server/services/fechaVoucher.ts`). */
export function textoFechaPago(origen: FechaOrigen | undefined): string {
  switch (origen) {
    case 'voucher': return 'Fecha del voucher, leída por la IA';
    case 'no_leida': return 'Fecha declarada: no se pudo leer la fecha del voucher';
    case 'invalida': return 'Fecha declarada: la fecha del voucher es futura o muy antigua y no se aplicó';
    case 'manual': return 'Fecha corregida a mano';
    default: return 'Fecha declarada por quien registró el pago';
  }
}

/** ¿Quien valida debe fijarse en la fecha? (la IA no la leyó o la leyó pero no era creíble) */
export const fechaPorRevisar = (origen: FechaOrigen | undefined): boolean => origen === 'no_leida' || origen === 'invalida';
