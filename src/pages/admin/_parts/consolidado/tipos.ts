import type { DetalleMantenimiento } from '../../../shared/mantenimiento/tipos';

/** Respuesta de `GET /api/recibos/:id/consolidado` (contrato en docs/API-CONTRATO.md): la tabla del block con todos sus departamentos. */
export interface ColumnaConsolidado { id: number; nombre: string; es_recargo: boolean }

export interface FilaConsolidado {
  unidad_id: number;
  codigo: string;
  block: string | null;
  dpto: string;
  /** «Apellidos y Nombres» del propietario; vacío si no tiene. */
  propietario: string;
  /** Un monto por columna (mismo orden que `conceptos`). */
  montos: string[];
  total_mant: string;
  deuda_acumulada: string;
  total: string;
}

export interface Consolidado {
  recibo_id: number;
  empresa: string | null;
  condominio: string;
  block: string | null;
  mes: number;
  anio: number;
  fecha_vencimiento: string;
  moneda: string;
  conceptos: ColumnaConsolidado[];
  filas: FilaConsolidado[];
  totales: { montos: string[]; total_mant: string; deuda_acumulada: string; total: string };
}

/** `GET /api/recibos/:id/consolidado/impresion`: el recibo de cada departamento (sin pagos) y el consolidado que va a continuación. */
export interface ImpresionBlock { consolidado: Consolidado; recibos: DetalleMantenimiento[] }
