// Tipos y textos de la capa comercial (planes, módulos por condominio). Los PRECIOS nunca van aquí: salen siempre de la API.
import type { Tone } from '../../../ui';

/** Lo que trae un plan de pago (Pro): los tres módulos, la mora automática y los reportes. Ya no se venden sueltos. */
export type ModuloClave = 'ia_vouchers' | 'whatsapp_avisos' | 'asistente' | 'mora_automatica' | 'reportes';
export const MODULO_NOMBRE: Record<ModuloClave, string> = {
  ia_vouchers: 'IA que lee y valida vouchers',
  whatsapp_avisos: 'Avisos por WhatsApp',
  asistente: 'Asistente con IA',
  mora_automatica: 'Mora automática',
  reportes: 'Reportes y exportes',
};

export type EstadoSuscripcion = 'gratis' | 'solicitada' | 'activa' | 'por_vencer' | 'vencida';
export const ESTADO_UI: Record<EstadoSuscripcion, { label: string; tone: Tone }> = {
  gratis: { label: 'Gratis', tone: 'neutral' },
  solicitada: { label: 'Solicitada', tone: 'info' },
  activa: { label: 'Activa', tone: 'ok' },
  por_vencer: { label: 'Por vencer', tone: 'warn' },
  vencida: { label: 'Vencida', tone: 'bad' },
};

/** `moneda` (ISO 4217) e `impuesto_nombre` (IGV, IVA…) son los del país del condominio; `igv` e `igv_tasa` (fracción) son ese impuesto. */
export interface Cotizacion { moneda: string; impuesto_nombre: string; unidades: number; unidades_cobradas: number; minimo_aplicado: boolean; base: string; igv: string; total_mes: string; total_anio: string; igv_tasa: string }

export interface VistaSuscripcion {
  complejo_id: number;
  complejo: string;
  empresa: { id: number; nombre: string } | null;
  plan: { clave: string; nombre: string };
  modulos_activos: string[];
  modulos_sueltos: string[];
  estado: EstadoSuscripcion;
  vigente_hasta: string | null;
  dias_para_vencer: number | null;
  en_gracia: boolean;
  unidades_facturables: number;
  /** Departamentos que se cobran: el mayor entre los que tiene y el mínimo del plan. */
  unidades_cobradas: number;
  /** Tope de departamentos del plan que cuenta hoy (Gratis); null = sin tope. */
  unidades_maximas: number | null;
  /** Mínimo de departamentos que cobra el plan (Pro y Administradora); null = sin mínimo. */
  unidades_minimas: number | null;
  /** País del condominio y, de él, la moneda en que paga y el impuesto que se le suma. */
  pais: string;
  moneda: string;
  impuesto: { nombre: string; tasa: string };
  cotizacion: Cotizacion;
  /** El plan de pago contratado no tiene precio en la moneda de su país: no hay monto que mostrar, hay que «consultar». */
  precio_consultar: boolean;
  /** Planes de pago que este condominio puede pedir hoy. */
  planes_disponibles: string[];
  solicitud: { plan: string | null; modulos: string[]; en: string | null; cotizacion: Cotizacion; consultar: boolean } | null;
  referencia_pago: string;
  notas?: string | null;
}

export interface DatosPago { titular: string | null; banco: string | null; cuenta: string | null; cci: string | null; yape: string | null; instrucciones: string | null; igv_tasa: string; dias_gracia: number }

export interface PagoSuscripcion { id: number; complejo_id: number; base: string; igv: string; monto: string; moneda: string; impuesto_nombre: string; impuesto_tasa: string; fecha_pago: string; medio: string; operacion: string | null; periodo_desde: string; periodo_hasta: string; voucher_ref: string | null; notas: string | null; registrado_en: string }

export const MEDIOS = [['transferencia', 'Transferencia'], ['yape', 'Yape'], ['plin', 'Plin'], ['efectivo', 'Efectivo'], ['otro', 'Otro']] as const;

/** `2026-11-26T00:00:00.000Z` → `2026-11-26` (para `<input type="date">`). */
export const aFechaInput = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');

/** `pro` → `Pro` (las claves de plan viajan en minúscula; al cliente se le muestra con mayúscula inicial). */
export const nombreDePlan = (clave: string): string => clave.charAt(0).toUpperCase() + clave.slice(1);
