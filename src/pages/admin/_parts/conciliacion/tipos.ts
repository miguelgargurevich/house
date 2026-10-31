// Tipos y textos de la conciliación bancaria (lo que devuelve /api/conciliacion).
import type { Tone } from '../../../../ui';

export type EstadoMovimiento = 'conciliado' | 'por_revisar' | 'sin_pago' | 'ignorado';

export interface Cuenta {
  id: number;
  complejo: { id: number; nombre: string; moneda: string };
  estructura: { id: number; nombre: string | null } | null;
  entidad: string | null;
  ultimos4: string | null;
  moneda: string;
  titular: string;
  activo: boolean;
  ventana_dias: number;
  tiene_mapeo: boolean;
  ultimo_extracto: { id: number; archivo_nombre: string; created_at: string; fecha_hasta: string | null } | null;
}

export interface PagoResumen {
  id: number;
  fecha_pago: string;
  total: string;
  metodo_pago: string | null;
  referencia: string | null;
  estado_validacion: string;
  unidad: { codigo: string; estructura: string | null } | null;
  pagador: string | null;
}

export interface Movimiento {
  id: number;
  fecha: string;
  descripcion: string;
  monto: string;
  numero_operacion: string | null;
  estado: EstadoMovimiento;
  vinculo: 'automatico' | 'manual' | null;
  vinculado_at: string | null;
  vinculado_por: string | null;
  motivo_ignorar: string | null;
  pago: PagoResumen | null;
  sugerencias: PagoResumen[];
}

interface Cifra { cantidad: number; monto: string }
export interface Resumen {
  moneda: string;
  conciliados: Cifra;
  por_revisar: Cifra;
  sin_pago: Cifra;
  ignorados: Cifra;
  total: Cifra;
  vouchers_sin_abono: Cifra;
  extractos: number;
  rango: { desde: string; hasta: string } | null;
}

export interface ResultadoSubida {
  requiere_mapeo: boolean;
  vista?: string[][];
  extracto?: { id: number; archivo_nombre: string; filas_leidas: number; filas_nuevas: number; filas_repetidas: number; total_abonos: string; fecha_desde: string | null; fecha_hasta: string | null };
  cruce?: { revisados: number; conciliados: number; por_revisar: number; sin_pago: number };
  descartes?: { cargos: number; sin_fecha: number; sin_monto: number };
}

export const ESTADO_UI: Record<EstadoMovimiento, { label: string; tone: Tone }> = {
  conciliado: { label: 'Conciliado', tone: 'ok' },
  por_revisar: { label: 'Por revisar', tone: 'warn' },
  sin_pago: { label: 'Abono sin voucher', tone: 'bad' },
  ignorado: { label: 'Ignorado', tone: 'neutral' },
};

/** «Cuenta BCP ····0000 · Condominio Demo (Block 1)». */
export function nombreDeCuenta(c: Cuenta): string {
  return `${c.entidad ?? 'Cuenta'}${c.ultimos4 ? ` ····${c.ultimos4}` : ''} · ${c.titular}${c.estructura ? ` (${c.estructura.nombre ?? 'Block'})` : ''}${c.activo ? '' : ' · inactiva'}`;
}

/** Letra de columna de una hoja de cálculo: 0 → A, 26 → AA. */
export function letraDeColumna(i: number): string {
  let n = i;
  let s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
