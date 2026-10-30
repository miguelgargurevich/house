// Lo que devuelve `/api/cierres` (ver docs/API-CONTRATO.md). Los montos llegan como texto con 2 decimales.

export type Destino = 'administradora' | 'central' | 'servicio' | 'proveedor' | 'ahorro_block';
export type EstadoCierre = 'sin_recibo' | 'pendiente' | 'por_clasificar' | 'sin_conformidad' | 'cerrado';

export interface Persona { id: number; nombre: string }

export interface RegistroLinea {
  id: number;
  monto_pagado: string;
  fecha_pago: string;
  referencia: string | null;
  observaciones: string | null;
  registrado_por: Persona | null;
  created_at: string;
  voucher: { nombre: string; tipo_mime: string; tamano: number } | null;
  conformidad: { at: string; por: Persona | null } | null;
}

export interface CuentaDestino { banco: string | null; tipo: string | null; numero: string | null; cci: string | null; titular: string | null }

export interface LineaCierre {
  linea: string;
  destino: Destino;
  concepto_id: number | null;
  nombre: string;
  proveedor: { id: number; razon_social: string; cuenta: CuentaDestino } | null;
  facturado: string;
  cobrado: string;
  detalle: { nombre: string; facturado: string }[];
  registro: RegistroLinea | null;
  obsoleta: boolean;
  lleva_conformidad: boolean;
  puede_conformidad: boolean;
}

export interface MedioCentral {
  id: number; tipo: string; banco: string | null; banco_otro: string | null; tipo_cuenta: string | null;
  numero_cuenta: string | null; cci: string | null; moneda: string; titular: string;
}

export interface CierreBlock {
  estructura: { id: number; nombre: string | null };
  complejo_id: number;
  moneda: string;
  mes: number;
  anio: number;
  hay_recibo: boolean;
  lineas: LineaCierre[];
  ahorro: { facturado: string; cobrado: string; conceptos: { nombre: string; facturado: string }[] };
  sin_clasificar: { concepto_id: number; nombre: string; facturado: string; cobrado: string }[];
  facturado_total: string;
  cobrado_total: string;
  pagado_total: string;
  ahorro_mes: string;
  sobrante_mes: string;
  estado: EstadoCierre;
  registrado_completo: boolean;
  lineas_total: number;
  lineas_pagadas: number;
  fondo_ahorros: string;
  cuentas: { central: MedioCentral[]; administradora: (CuentaDestino & { empresa: string }) | null };
  puede: { registrar: boolean };
}

export interface FilaBlock {
  estructura: { id: number; nombre: string | null };
  estado: EstadoCierre;
  lineas_total: number;
  lineas_pagadas: number;
  por_clasificar: number;
  facturado_total: string;
  cobrado_total: string;
  pagado_total: string;
  ahorro_mes: string;
  sobrante_mes: string;
  fondo_ahorros: string;
}

export interface TablaBlocks { complejo_id: number; moneda: string; mes: number; anio: number; blocks: FilaBlock[]; por_estado: Record<string, number> }

export interface Aporte {
  estructura: { id: number; nombre: string | null };
  linea: string;
  nombre: string;
  facturado: string;
  registro: RegistroLinea | null;
  estado: 'sin_registrar' | 'sin_conformidad' | 'conforme';
  puede_conformidad: boolean;
}

export interface Aportes {
  complejo_id: number;
  moneda: string;
  mes: number;
  anio: number;
  destino: 'central' | 'administradora';
  aportes: Aporte[];
  totales: { facturado: string; registrado: string; conforme: string; sin_registrar: number; sin_conformidad: number };
  caja_central: { recibido: string; por_confirmar: string };
  puede: { conformidad: boolean };
}

export interface CuentasEmpresa {
  administradora: CuentaDestino & { empresa: string };
  proveedores: (CuentaDestino & { id: number; razon_social: string })[];
}

// ---------- Cierre de la Junta central (`GET /api/cierres/central`) ----------
export type EstadoCentral = 'sin_blocks' | 'faltan_aportes' | 'falta_conformidad' | 'al_dia';
export type CategoriaCentral = 'alquiler_estacionamiento' | 'otro_ingreso' | 'servicio' | 'proveedor' | 'otro_egreso';

export interface MovimientoCentral {
  id: number;
  tipo: 'ingreso' | 'egreso';
  categoria: CategoriaCentral;
  categoria_etiqueta: string;
  mes: number;
  anio: number;
  descripcion: string | null;
  pagador: string | null;
  estacionamiento: string | null;
  proveedor: { id: number; razon_social: string } | null;
  documento: string | null;
  monto: string;
  fecha: string;
  referencia: string | null;
  observaciones: string | null;
  registrado_por: Persona | null;
  created_at: string;
  voucher: { nombre: string; tipo_mime: string; tamano: number } | null;
}

export interface AporteBlock {
  estructura: { id: number; nombre: string | null };
  facturado: string;
  registro: RegistroLinea | null;
  estado: 'sin_registrar' | 'sin_conformidad' | 'conforme';
}

export interface CierreCentral {
  complejo_id: number;
  moneda: string;
  mes: number;
  anio: number;
  estado: EstadoCentral;
  ingresos: {
    aportes: { confirmados: string; fondo_contingencia: string; por_confirmar: string; blocks: AporteBlock[] };
    otros: { total: string; movimientos: MovimientoCentral[] };
    total: string;
  };
  egresos: { total: string; movimientos: MovimientoCentral[] };
  saldo_mes: string;
  fondo_ahorros: string;
  fondo_contingencia_mes: string;
  fondo_contingencia: string;
  blocks_sin_aportar: { id: number; nombre: string | null; facturado: string }[];
  categorias: { ingreso: { value: CategoriaCentral; label: string }[]; egreso: { value: CategoriaCentral; label: string }[] };
  puede: { registrar: boolean };
}
