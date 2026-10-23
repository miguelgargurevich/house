export type EstadoCargo = 'pagado' | 'pendiente' | 'vencido';
export type Metodo = 'transferencia' | 'yape' | 'plin' | 'efectivo' | 'tarjeta';

export interface Cargo {
  id: number;
  monto: number | string;
  estado: EstadoCargo;
  concepto: { nombre: string };
  recibo: { id: number; mes: number; anio: number; descripcion?: string | null; fecha_vencimiento: string };
  unidad: { id: number; codigo: string };
}

export interface PagoResidente {
  id: number;
  monto: number | string;
  fecha_pago: string;
  metodo_pago: Metodo | string | null;
  referencia: string | null;
  observaciones?: string | null;
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

export const primerNombre = (nombre: string | undefined) => nombre?.trim().split(/\s+/)[0] ?? '';
