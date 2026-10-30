/**
 * Lo que va del mes en un condominio, para Mi plan y el Resumen: el texto de cada tope, el aviso al 80 % y los mensajes de los vouchers.
 * Sin React ni API: lo prueban las pruebas de Node. Los números los da el servidor (`GET /api/comercial/mi-plan`, campo `uso`).
 */
export interface Tope { usadas: number; tope: number | null }
export interface UsoMes {
  periodo: string;
  /** «noviembre»: cuándo se renuevan los topes. */
  renueva: string;
  asistente: Tope;
  whatsapp: Tope;
  vouchers_a_mano: number;
  vouchers_ia: number;
}

/** A partir de este porcentaje del tope se avisa. */
export const UMBRAL_AVISO = 0.8;

/** «asistente 3 de 10» o, sin tope, «asistente 3 (sin tope)». */
export const textoTope = (nombre: string, t: Tope): string => (t.tope == null ? `${nombre} ${t.usadas} (sin tope)` : `${nombre} ${t.usadas} de ${t.tope}`);

/** ¿Algún tope (que lo tiene) llegó al umbral? Sin tope no hay nada que avisar. */
export const topeAlto = (u: UsoMes): boolean => [u.asistente, u.whatsapp].some((t) => t.tope != null && t.tope > 0 && t.usadas >= t.tope * UMBRAL_AVISO);

const vouchers = (n: number): string => `${n} ${n === 1 ? 'voucher' : 'vouchers'}`;

/**
 * Lo que se dice de los vouchers: en prueba, lo que la IA ya validó; en Gratis, lo que se validó a mano y lo que Pro cambiaría. Sin cifra que
 * decir (cero), no dice nada.
 */
export function mensajeVouchers(u: UsoMes, plan: string, enPrueba: boolean): string | null {
  if (enPrueba) return u.vouchers_ia > 0 ? `La IA ya validó ${vouchers(u.vouchers_ia)} por ti este mes.` : null;
  if (plan === 'gratis' && u.vouchers_a_mano > 0) return `Este mes validaste a mano ${vouchers(u.vouchers_a_mano)}. Con Pro, la IA los lee y valida los que coinciden; tú sólo revisas.`;
  return null;
}
