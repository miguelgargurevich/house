import type { ComprobanteMeta } from '../comprobantes';
import type { EvaluacionCompleta, EvaluacionResidente } from '../evaluacion';

/** Mantenimiento = todos los conceptos del mes de UN departamento (el «recibo del departamento»). */
export type EstadoMantenimiento = 'pagado' | 'en_revision' | 'parcial' | 'vencido' | 'pendiente';

export interface Mantenimiento {
  recibo_id: number;
  unidad_id: number;
  /** `2026-10-B01-804` */
  numero: string;
  /** «Mantenimiento de octubre de 2026 · B01-804» */
  titulo: string;
  mes: number;
  anio: number;
  fecha_vencimiento: string;
  unidad: { id: number; codigo: string; estructura: { id: number; nombre: string | null } | null };
  propietario: { id: number; nombre: string } | null;
  total: string;
  cobrado: string;
  en_revision: string;
  /** Lo que aún se puede pagar. */
  saldo: string;
  estado: EstadoMantenimiento;
}

export interface MedioPagoMant {
  id: number;
  tipo: 'banco' | 'yape' | 'plin' | 'recaudacion';
  ambito: 'block' | 'condominio';
  banco: string | null;
  /** Nombre real de la entidad (si es «Otro», el que escribió la junta). */
  entidad: string | null;
  moneda: 'PEN' | 'USD';
  /** «Soles» o «Dólares». */
  moneda_nombre: string;
  servicio: string | null;
  /** Recaudación: «Paga desde Pago de servicios en … → …, con el código: …» (con el código de TU unidad). */
  instruccion: string | null;
  tipo_cuenta: 'ahorros' | 'corriente' | null;
  numero_cuenta: string | null;
  cci: string | null;
  titular: string;
  celular: string | null;
  tiene_qr: boolean;
}

export interface ConceptoMantenimiento {
  cargo_id: number;
  concepto: string;
  es_recargo: boolean;
  monto: string;
  cobrado: string;
  en_revision: string;
  saldo: string;
  /** Por qué se cobra (hoy sólo la mora): «Pago fuera de fecha del recibo de octubre de 2026». */
  motivo?: string | null;
}

export type FechaOrigen = 'declarada' | 'voucher' | 'no_leida' | 'invalida' | 'manual';

export interface PagoMantenimiento {
  /** Pago principal del grupo (o el pago suelto): con este id se ve el comprobante y se valida. */
  id: number;
  grupo: string | null;
  suelto: boolean;
  monto: string;
  conceptos: string[];
  metodo_pago: string | null;
  referencia: string | null;
  fecha_pago: string;
  /** De dónde salió la fecha: la del voucher que leyó la IA, la declarada (sin leer), una fecha leída que no se aplicó o corregida a mano. */
  fecha_origen?: FechaOrigen;
  estado_validacion: 'por_validar' | 'validado' | 'rechazado';
  motivo_rechazo: string | null;
  validado_por_ia: boolean;
  registrado_por: { id: number; nombre: string } | null;
  comprobante: ComprobanteMeta | null;
  evaluacion: EvaluacionResidente | EvaluacionCompleta | null;
}

/** Detalle del consumo de agua del departamento en el recibo (lo que el recibo impreso llama «lectura de contómetro»). */
export interface AguaMantenimiento {
  fecha_anterior: string;
  lectura_anterior: string;
  fecha_actual: string;
  lectura_actual: string;
  /** S/ por m³. */
  factor: string;
  consumo_m3: string;
  /** Consumo × factor, en S/. */
  monto: string;
  tiene_foto: boolean;
  /** URL de la foto del contómetro (con el alcance de quien mira); `null` si no hay. */
  foto_url: string | null;
}

export interface DetalleMantenimiento extends Omit<Mantenimiento, 'propietario'> {
  fecha_emision: string;
  /** Fecha de corte del agua (la fija la administración o la junta). */
  fecha_corte_agua: string | null;
  /** Lo que el departamento debe de periodos anteriores (nunca negativo). */
  deuda_acumulada: string;
  /** Total del mantenimiento + deuda acumulada. */
  total_general: string;
  agua: AguaMantenimiento | null;
  /** «Correo del block» para enviar vouchers. */
  correo_vouchers: string | null;
  /** Concepto de mora/multa del recibo que este departamento no debe: se imprime en S/ 0.00. */
  linea_mora: string | null;
  condominio: { id: number; nombre: string; direccion: string | null; notas_pago: string | null; admin_nombre: string | null; admin_celular: string | null; admin_correo: string | null; cabecera_url: string | null } | null;
  empresa: { id: number; nombre: string; ruc: string | null; direccion: string | null; telefono: string | null; email: string | null; logo_url: string | null } | null;
  propietario: { id: number; nombre: string } | null;
  inquilino: { id: number; nombre: string } | null;
  conceptos: ConceptoMantenimiento[];
  pagos: PagoMantenimiento[];
  medios_pago: MedioPagoMant[];
}

export interface ResultadoPagoMantenimiento { grupo: string; pago_id: number; total: string; cargos: number; mantenimiento: DetalleMantenimiento }

/** ¿Se puede pagar ahora? Queda saldo y no hay un pago esperando validación que cubra el resto. */
export const sePuedePagar = (m: Pick<Mantenimiento, 'saldo' | 'estado'>) => Number(m.saldo) > 0 && m.estado !== 'en_revision' && m.estado !== 'pagado';

/** Motivo del último rechazo si el mantenimiento volvió a quedar por pagar; `null` en otro caso. */
export function motivoRechazoMant(pagos: Pick<PagoMantenimiento, 'estado_validacion' | 'motivo_rechazo'>[] | undefined, estado: EstadoMantenimiento): string | null {
  if (estado === 'pagado' || estado === 'en_revision') return null;
  const ultimo = pagos?.[0];
  return ultimo?.estado_validacion === 'rechazado' ? ultimo.motivo_rechazo ?? 'Sin motivo indicado' : null;
}

/** El medio de pago principal de una torre para el recibo impreso: la primera cuenta bancaria de su block, si no, la del condominio. */
export function cuentaBancaria(medios: MedioPagoMant[]): MedioPagoMant | null {
  const bancos = medios.filter(m => m.tipo === 'banco');
  return bancos.find(m => m.ambito === 'block') ?? bancos[0] ?? null;
}
