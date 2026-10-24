import type { ComprobanteMeta } from '../../shared/comprobantes';
import type { EvaluacionResidente } from '../../shared/evaluacion';

export type EstadoValidacion = 'por_validar' | 'validado' | 'rechazado';
export type Metodo = 'transferencia' | 'yape' | 'plin' | 'efectivo' | 'tarjeta';

export interface PagoResidente {
  id: number;
  monto: number | string;
  fecha_pago: string;
  metodo_pago: Metodo | string | null;
  referencia: string | null;
  observaciones?: string | null;
  estado_validacion: EstadoValidacion;
  motivo_rechazo: string | null;
  validado_at: string | null;
  comprobante: ComprobanteMeta | null;
  /** Sólo un estado simple: el detalle de la IA es de la junta y la administración. */
  evaluacion?: EvaluacionResidente | null;
  validado_por_ia?: boolean;
  unidad?: { codigo: string } | null;
  concepto?: { nombre: string } | null;
  /** Pago del mantenimiento completo (un grupo de pagos por concepto); `null` en los pagos sueltos antiguos. */
  mantenimiento?: { grupo: string; titulo: string; numero: string; recibo_id: number; unidad_id: number; total: string; conceptos: number } | null;
}

/** Lo que se muestra del pago: el mantenimiento completo (con su total) o el concepto del pago suelto. */
export const nombrePago = (p: Pick<PagoResidente, 'mantenimiento' | 'concepto'>) => p.mantenimiento ? p.mantenimiento.titulo.split(' · ')[0]! : p.concepto?.nombre ?? 'Pago';
export const montoPago = (p: Pick<PagoResidente, 'mantenimiento' | 'monto'>) => p.mantenimiento?.total ?? p.monto;

export const METODOS: { value: Metodo; label: string }[] = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'yape', label: 'Yape' },
  { value: 'plin', label: 'Plin' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
];

export function metodoLabel(m: string | null | undefined): string {
  if (!m) return '—';
  return METODOS.find(x => x.value === m)?.label ?? m.charAt(0).toUpperCase() + m.slice(1);
}

/** Lo que ve el residente: un pago por validar es «en revisión». */
export const estadoVisible = (e: EstadoValidacion): string => (e === 'por_validar' ? 'en_revision' : e);

export const primerNombre = (nombre: string | undefined) => nombre?.trim().split(/\s+/)[0] ?? '';

/** Medio de pago que ve el residente (`GET /api/me/medios-pago`): sólo lo necesario para pagar. */
export interface MedioResidente {
  id: number;
  tipo: 'banco' | 'yape' | 'plin';
  ambito: 'block' | 'condominio';
  banco: string | null;
  tipo_cuenta: 'ahorros' | 'corriente' | null;
  numero_cuenta: string | null;
  cci: string | null;
  titular: string;
  celular: string | null;
  tiene_qr: boolean;
}
