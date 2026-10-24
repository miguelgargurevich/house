import type { ComprobanteMeta } from '../../shared/comprobantes';

export type EstadoCargo = 'pagado' | 'pendiente' | 'vencido' | 'en_revision';
export type EstadoValidacion = 'por_validar' | 'validado' | 'rechazado';
export type Metodo = 'transferencia' | 'yape' | 'plin' | 'efectivo' | 'tarjeta';

export interface Cargo {
  id: number;
  monto: number | string;
  estado: EstadoCargo;
  concepto: { nombre: string };
  recibo: { id: number; mes: number; anio: number; descripcion?: string | null; fecha_vencimiento: string };
  unidad: { id: number; codigo: string };
  /** Del más reciente al más antiguo. */
  pagos?: { id: number; estado_validacion: EstadoValidacion; motivo_rechazo: string | null }[];
}

/** Motivo del último rechazo si el cargo volvió a quedar por pagar; `null` en cualquier otro caso. */
export function motivoRechazo(c: Cargo): string | null {
  if (c.estado === 'pagado' || c.estado === 'en_revision') return null;
  const ultimo = c.pagos?.[0];
  return ultimo?.estado_validacion === 'rechazado' ? ultimo.motivo_rechazo ?? 'Sin motivo indicado' : null;
}

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
  unidad?: { codigo: string } | null;
  concepto?: { nombre: string } | null;
}

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
