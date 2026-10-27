// Tipos y textos de la capa comercial (planes, módulos por condominio). Los PRECIOS nunca van aquí: salen siempre de la API.
import type { Tone } from '../../../ui';

export type ModuloClave = 'ia_vouchers' | 'whatsapp_avisos' | 'asistente';
export const MODULO_NOMBRE: Record<ModuloClave, string> = {
  ia_vouchers: 'IA que lee y valida vouchers',
  whatsapp_avisos: 'Avisos por WhatsApp',
  asistente: 'Asistente con IA',
};

export type EstadoSuscripcion = 'gratis' | 'solicitada' | 'activa' | 'por_vencer' | 'vencida';
export const ESTADO_UI: Record<EstadoSuscripcion, { label: string; tone: Tone }> = {
  gratis: { label: 'Gratis', tone: 'neutral' },
  solicitada: { label: 'Solicitada', tone: 'info' },
  activa: { label: 'Activa', tone: 'ok' },
  por_vencer: { label: 'Por vencer', tone: 'warn' },
  vencida: { label: 'Vencida', tone: 'bad' },
};

export interface Cotizacion { unidades: number; base: string; igv: string; total_mes: string; total_anio: string; igv_tasa: string }

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
  cotizacion: Cotizacion;
  solicitud: { plan: string | null; modulos: string[]; en: string | null; cotizacion: Cotizacion } | null;
  referencia_pago: string;
  notas?: string | null;
}

export interface DatosPago { titular: string | null; banco: string | null; cuenta: string | null; cci: string | null; yape: string | null; instrucciones: string | null; igv_tasa: string; dias_gracia: number }

export interface PagoSuscripcion { id: number; complejo_id: number; base: string; igv: string; monto: string; fecha_pago: string; medio: string; operacion: string | null; periodo_desde: string; periodo_hasta: string; voucher_ref: string | null; notas: string | null; registrado_en: string }

export const MEDIOS = [['transferencia', 'Transferencia'], ['yape', 'Yape'], ['plin', 'Plin'], ['efectivo', 'Efectivo'], ['otro', 'Otro']] as const;

/** `2026-11-26T00:00:00.000Z` → `2026-11-26` (para `<input type="date">`). */
export const aFechaInput = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');

/** `pro` → `Pro` (las claves de plan viajan en minúscula; al cliente se le muestra con mayúscula inicial). */
export const nombreDePlan = (clave: string): string => clave.charAt(0).toUpperCase() + clave.slice(1);
