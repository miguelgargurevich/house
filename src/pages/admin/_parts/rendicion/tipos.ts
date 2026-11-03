// Lo que devuelve `GET /api/reportes/rendicion` (ver docs/API-CONTRATO.md). Los montos llegan como texto con 2 decimales.

export interface Ref { id: number; nombre: string | null }

export interface LineaEgreso {
  estructura: Ref;
  linea: string;
  nombre: string;
  destino: string;
  destino_etiqueta: string;
  facturado: string;
  pagado: string | null;
  fecha_pago: string | null;
  referencia: string | null;
  estado: 'pagada' | 'por_pagar';
  conformidad: 'conforme' | 'sin_conformidad' | 'por_pagar' | 'no_aplica';
}

export interface MovimientoResumen { fecha: string; concepto: string; detalle: string; monto: string }

export interface FilaBlock {
  estructura: { id: number | null; nombre: string };
  emitido: string;
  cobrado: string;
  por_validar: string;
  egresos_pagado: string;
  egresos_facturado: string;
  traspaso_central: string;
  saldo_inicial: string;
  saldo_final: string;
  fondo_ahorros: string;
  unidades_morosas: number;
  deuda_morosa: string;
  pct_cobrado: number | null;
}

export interface Extracto {
  saldo_banco: string;
  saldo_rendicion: string;
  diferencia: string;
  cuadra: boolean;
  cuentas: { medio_pago_id: number; cuenta: string; extracto_id: number; hasta: string | null; saldo_final: string; saldo_cuadra: boolean | null }[];
}

export interface Moroso {
  unidad: { id: number; codigo: string };
  estructura: Ref | null;
  deuda: string;
  meses: number;
  deuda_del_mes: string;
  dias_max_atraso: number;
}

export interface Rendicion {
  complejo: { id: number; nombre: string; moneda: string };
  periodo: { mes: number; anio: number; desde: string; hasta: string };
  alcance: 'condominio' | 'block';
  estructura: Ref | null;
  ingresos: {
    emitido: string;
    cobrado: { total: string; del_mes: string; de_meses_anteriores: string; adelantado: string; pagos: number };
    por_validar: { total: string; pagos: number };
    conciliacion: null | { activa: false } | { activa: true; conciliado: string; efectivo: string; sin_conciliar: string };
    otros_central: null | { total: string; movimientos: MovimientoResumen[] };
    total: string;
  };
  egresos: {
    facturado: string;
    pagado: string;
    traspaso_central: string;
    por_pagar: { lineas: number; facturado: string };
    sin_conformidad: { lineas: number; monto: string };
    por_destino: { destino: string; etiqueta: string; facturado: string; pagado: string; lineas: number; sin_registrar: number; sin_conformidad: number }[];
    lineas: LineaEgreso[];
    sin_clasificar: { estructura: Ref; nombre: string; facturado: string }[];
    central: null | { total: string; movimientos: MovimientoResumen[] };
    total: string;
  };
  cuadre: {
    saldo_inicial: string;
    ingresos: string;
    egresos: string;
    saldo_final: string;
    saldo_inicial_cargado: false;
    primer_mes: { mes: number; anio: number } | null;
    nota: string;
    extracto: Extracto | null;
  };
  fondos: {
    blocks: { estructura: Ref; fondo_ahorros: string }[];
    fondo_ahorros_blocks: string;
    central: null | { fondo_ahorros: string; fondo_contingencia: string };
  };
  morosidad: {
    al: string;
    emitido: string;
    pagado_del_recibo: string;
    pct_cobrado: number | null;
    unidades_morosas: number;
    deuda_total: string;
    deuda_del_mes: string;
    unidades: Moroso[];
    lista_completa: boolean;
  };
  blocks: FilaBlock[] | null;
  generado_at: string;
}
