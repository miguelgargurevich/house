/** Revisión de morosos antes de emitir y «Quitar la multa»: tipos de lo que responde la API y lógica pura (sin React). */
import type { FechaOrigen } from '../../../shared/mantenimiento/tipos';

export type EstadoMora = 'a_tiempo' | 'tarde' | 'sin_deuda';

export interface PagoMora {
  /** El pago principal del mantenimiento: con este id se corrige la fecha. */
  id: number;
  monto: string;
  fecha_pago: string;
  /** El día del condominio («2026-10-01»). */
  dia: string;
  fecha_origen: FechaOrigen;
  estado_validacion: 'por_validar' | 'validado';
}

export interface UnidadMora {
  unidad_id: number;
  codigo: string;
  estado: EstadoMora;
  deuda: string;
  pagos: PagoMora[];
  revisar: boolean;
}

export interface TorreMora {
  estructura_id: number | null;
  torre: string | null;
  anterior: { id: number; mes: number; anio: number; fecha_vencimiento: string } | null;
  aun_no_vence: boolean;
  unidades: UnidadMora[];
}

export interface VistaMora {
  complejo_id: number;
  mes: number;
  anio: number;
  /** `false` = el plan o el monto no cobran mora: la emisión no agregará multas. */
  aplica: boolean;
  monto: string;
  torres: TorreMora[];
  resumen: { a_tiempo: number; tarde: number; sin_deuda: number; revisar: number };
}

/** «Según el voucher pagó a tiempo; tiene la multa de …» que trae el pago cuando la multa debería quitarse. */
export interface AvisoMulta { texto: string; recibo_id: number; unidad_id: number; monto: string }

export const ESTADO_MORA: Record<EstadoMora, { tone: 'ok' | 'bad' | 'neutral'; label: string }> = {
  a_tiempo: { tone: 'ok', label: 'Pagó a tiempo' },
  tarde: { tone: 'bad', label: 'Pagó tarde: tendrá multa' },
  sin_deuda: { tone: 'neutral', label: 'Sin deuda' },
};

/** «Sólo para revisar» deja los departamentos con algo que mirar; sin el filtro, todos. */
export const filtrarUnidades = (unidades: UnidadMora[], soloRevisar: boolean): UnidadMora[] => (soloRevisar ? unidades.filter(u => u.revisar) : unidades);

/** Por qué un departamento está marcado «Revisar» (el primer motivo que aplica). */
export function motivoRevisar(u: UnidadMora): string | null {
  if (!u.revisar) return null;
  if (u.pagos.some(p => p.fecha_origen === 'invalida')) return 'La fecha del voucher no se aplicó (futura o muy antigua)';
  if (u.pagos.some(p => p.fecha_origen === 'no_leida')) return 'No se pudo leer la fecha del voucher';
  if (u.pagos.some(p => p.fecha_origen === 'declarada')) return 'La fecha la declaró quien registró el pago; no viene del voucher';
  return 'El pago sigue por validar';
}

/** Una línea para el encabezado: cuántos tendrán multa y cuántos conviene revisar. */
export function resumenVista(v: VistaMora): string {
  if (!v.aplica) return 'Este condominio no cobra mora automática (plan o monto): al emitir no se agregará ninguna multa.';
  const { tarde, revisar } = v.resumen;
  const multa = tarde === 0 ? 'Nadie tendrá multa' : `${tarde} ${tarde === 1 ? 'departamento tendrá' : 'departamentos tendrán'} multa`;
  return `${multa}${revisar > 0 ? ` · ${revisar} para revisar` : ''}`;
}

/** El día elegido en el calendario, guardado al mediodía UTC: así ninguna zona horaria lo corre al día anterior ni al siguiente (como la fecha que lee la IA del voucher). */
export const fechaDeCorreccion = (dia: string): string => `${dia}T12:00:00Z`;

const CONCEPTO_MULTA = /\b(multa|mora)\b/i;

export interface ConceptoDeRecibo { cargo_id: number; concepto: string; monto: string; cobrado: string; en_revision: string }

/** La línea de multa de un departamento que aún se puede quitar: sin nada cobrado ni en revisión. */
export function multaQuitable(conceptos: ConceptoDeRecibo[]): ConceptoDeRecibo | null {
  return conceptos.find(c => CONCEPTO_MULTA.test(c.concepto) && Number(c.monto) > 0 && Number(c.cobrado) === 0 && Number(c.en_revision) === 0) ?? null;
}

export const MOTIVO_MULTA_MIN = 5;
export const MOTIVO_MULTA_MAX = 300;
export function errorMotivoMulta(motivo: string): string | undefined {
  const t = motivo.trim();
  if (t.length < MOTIVO_MULTA_MIN) return `Escribe un motivo de al menos ${MOTIVO_MULTA_MIN} caracteres.`;
  if (t.length > MOTIVO_MULTA_MAX) return `El motivo admite hasta ${MOTIVO_MULTA_MAX} caracteres.`;
  return undefined;
}
