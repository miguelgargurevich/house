/** Lo que devuelve `GET /api/recibos/:id/agua` (lecturas de agua por departamento de un recibo). */
export interface LecturaGuardada {
  fecha_anterior: string;
  lectura_anterior: string;
  fecha_actual: string;
  lectura_actual: string;
  factor: string;
  consumo_m3: string;
  monto: string;
  tiene_foto: boolean;
}

export interface FilaAgua {
  unidad: { id: number; codigo: string; propietario: string | null };
  lectura: LecturaGuardada | null;
  /** La lectura actual del mes previo de esa unidad: lo que se precarga como «anterior». */
  anterior: { fecha: string; lectura: string; factor: string } | null;
  /** Lo que el recibo cobra por «AGUA DPTO.»; `null` si el departamento no tiene ese concepto. */
  agua_recibo: string | null;
  alerta: string | null;
}

export interface AguaDelRecibo {
  recibo: { id: number; mes: number; anio: number; fecha_corte_agua: string | null; estructura: { id: number; nombre: string | null; correo_vouchers: string | null } | null };
  factor_sugerido: string | null;
  items: FilaAgua[];
}

export interface ResultadoGuardado { guardadas: number; errores: { fila?: number; dpto: string; mensaje: string }[] }
export interface ResultadoImportacion extends ResultadoGuardado { filas: number }
