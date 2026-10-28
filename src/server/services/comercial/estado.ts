// Qué módulos tiene HOY un condominio. Se calcula con `vigente_hasta` y el reloj (no depende de que el planificador haya corrido):
// una suscripción vencida pasada la gracia se comporta como Gratis. Nunca se borra ni se bloquea nada: sólo se apagan los módulos.
import { diasEntre, hoyLima } from '../../lib/fechas';
import { CAPACIDADES, type EstadoSuscripcion } from './catalogo';

export interface EntradaSuscripcion {
  plan_clave: string;
  modulos: string[];
  estado: string;
  vigente_hasta: Date | null;
  solicitud_plan: string | null;
  solicitud_modulos: string[];
}
export interface PlanMinimo { clave: string; modulos_incluidos: string[]; /** Tope de unidades por condominio (null = sin tope). */ unidades_maximas?: number | null }
export interface Plazos { dias_gracia: number; dias_aviso_vencimiento: number }

export interface EstadoEfectivo {
  plan_clave: string;
  estado: EstadoSuscripcion;
  /** Capacidades activas ahora (módulos, mora automática, reportes; del plan + sueltos), ya descontado lo vencido pasada la gracia. */
  modulos: string[];
  /** Días que faltan para `vigente_hasta` (negativo = ya venció); null si no vence. */
  dias_para_vencer: number | null;
  en_gracia: boolean;
  /** Tenía módulos de pago y ya se apagaron por falta de pago. */
  apagada: boolean;
}

const GRATIS: PlanMinimo = { clave: 'gratis', modulos_incluidos: [] };

/** `sus` null = el condominio nunca tuvo suscripción: Gratis. */
export function estadoEfectivo(sus: EntradaSuscripcion | null, planes: PlanMinimo[], plazos: Plazos, ahora: Date): EstadoEfectivo {
  if (!sus) return { plan_clave: 'gratis', estado: 'gratis', modulos: [], dias_para_vencer: null, en_gracia: false, apagada: false };
  const plan = planes.find((p) => p.clave === sus.plan_clave) ?? GRATIS;
  const comprados = [...new Set([...plan.modulos_incluidos, ...sus.modulos])];
  const pendiente = sus.solicitud_plan != null || sus.solicitud_modulos.length > 0;

  // Cortesía: todo lo que trae el plan MÁS cada capacidad del catálogo (aunque el plan en la base aún no la liste), sin cobro ni vencimiento.
  if (plan.clave === 'cortesia') return { plan_clave: plan.clave, estado: 'activa', modulos: [...new Set([...comprados, ...CAPACIDADES])], dias_para_vencer: null, en_gracia: false, apagada: false };

  const sinPago = comprados.length === 0;
  if (sinPago) return { plan_clave: plan.clave, estado: pendiente ? 'solicitada' : 'gratis', modulos: [], dias_para_vencer: null, en_gracia: false, apagada: false };

  // Con pago: sin fecha de vencimiento = lo dejó así el superadmin a propósito (no vence).
  if (!sus.vigente_hasta) return { plan_clave: plan.clave, estado: pendiente ? 'solicitada' : 'activa', modulos: comprados, dias_para_vencer: null, en_gracia: false, apagada: false };

  const dias = diasEntre(hoyLima(ahora), sus.vigente_hasta);
  if (dias >= 0) {
    const porVencer = dias <= plazos.dias_aviso_vencimiento;
    return { plan_clave: plan.clave, estado: porVencer ? 'por_vencer' : pendiente ? 'solicitada' : 'activa', modulos: comprados, dias_para_vencer: dias, en_gracia: false, apagada: false };
  }
  const enGracia = -dias <= plazos.dias_gracia;
  return { plan_clave: plan.clave, estado: 'vencida', modulos: enGracia ? comprados : [], dias_para_vencer: dias, en_gracia: enGracia, apagada: !enGracia };
}
