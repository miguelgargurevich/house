/** La respuesta de `GET /api/estado-cuenta/unidades/:id` (ver docs/API-CONTRATO.md). Los montos llegan como texto con 2 decimales. */
export type EstadoMes = 'pagado' | 'en_revision' | 'parcial' | 'vencido' | 'pendiente';
export type EstadoPago = 'validado' | 'por_validar' | 'rechazado' | 'anulado';

export interface PagoEstadoCuenta {
  id: number | null;
  /** `AAAA-MM-DD` (día en la zona del condominio). */
  fecha: string | null;
  operacion: string | null;
  metodo: string | null;
  monto: string;
  estado: EstadoPago;
  /** Pago registrado sin voucher: el monto cuadra la lista con lo cobrado. */
  sin_detalle: boolean;
}

export interface FilaEstadoCuenta {
  recibo_id: number;
  anio: number;
  mes: number;
  periodo: string;
  fecha_vencimiento: string;
  estado: EstadoMes;
  cargo: string;
  por_concepto: { concepto: string; monto: string; es_mora: boolean }[];
  mora: string;
  pagado: string;
  en_revision: string;
  saldo: string;
  saldo_acumulado: string;
  pagos: PagoEstadoCuenta[];
}

export interface TotalesEstadoCuenta {
  cargado: string;
  mora: string;
  pagado: string;
  en_revision: string;
  saldo_anterior: string;
  saldo_deudor: string;
  meses_vencidos: number;
  deuda_vencida: string;
  pagos_rechazados: number;
  pagos_anulados: number;
}

export interface EstadoCuenta {
  unidad: { id: number; codigo: string; tipo: string };
  estructura: { id: number; nombre: string | null } | null;
  condominio: { id: number; nombre: string } | null;
  administradora: string | null;
  propietario: string | null;
  inquilino: string | null;
  moneda: string;
  zona_horaria: string;
  fecha_corte: string;
  desde: string | null;
  hasta: string | null;
  totales: TotalesEstadoCuenta;
  filas: FilaEstadoCuenta[];
}

/** Un departamento que se puede elegir en el estado de cuenta. */
export interface UnidadElegible { id: number; codigo: string }

export const ESTADO_MES: Record<EstadoMes, string> = { pagado: 'Pagado', en_revision: 'En revisión', parcial: 'Pago parcial', vencido: 'Vencido', pendiente: 'Por pagar' };
export const ESTADO_PAGO: Record<EstadoPago, string> = { validado: 'Validado', por_validar: 'Por validar', rechazado: 'Rechazado (no suma)', anulado: 'Anulado (no suma)' };

/** Rangos que ofrece la pantalla; el servidor acepta cualquier `desde`/`hasta` (`AAAA-MM`). */
export type RangoEstadoCuenta = 'ultimos' | 'anio' | 'anio_pasado' | 'todo';

/** `?desde=…&hasta=…` (o vacío) de un rango, con `anio` = el año en curso. */
export function consultaDeRango(rango: RangoEstadoCuenta, anio: number): string {
  switch (rango) {
    case 'anio': return `?desde=${anio}-01&hasta=${anio}-12`;
    case 'anio_pasado': return `?desde=${anio - 1}-01&hasta=${anio - 1}-12`;
    case 'todo': return '?desde=2000-01';
    default: return '';
  }
}
