import type { Page } from '../../../../api';
import { periodo } from '../../../../ui';

export type Lista<T> = Page<T>;

export interface Complejo { id: number; nombre: string }
export interface Concepto { id: number; nombre: string; activo?: boolean | null }

export const METODOS = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'yape', label: 'Yape' },
  { value: 'plin', label: 'Plin' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
] as const;

export function metodoLabel(v: string | null | undefined): string {
  return METODOS.find(m => m.value === v)?.label ?? (v ? v.charAt(0).toUpperCase() + v.slice(1) : '—');
}

/** Fecha local como yyyy-mm-dd (valor de <input type="date">), con desplazamiento en días. */
export function hoyISO(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** yyyy-mm-dd → ISO a mediodía local, para que la zona horaria no mueva el día. */
export function fechaAISO(v: string): string {
  return new Date(`${v}T12:00:00`).toISOString();
}

/** Nombre del mes en español (periodo() devuelve «Enero de 2000»: sólo se usa la primera palabra). */
export function nombreMes(mes: number): string {
  return periodo(mes, 2000).split(' ')[0] ?? '';
}
