// Qué módulos tiene HOY un condominio. Se calcula con `vigente_hasta` y el reloj (no depende de que el planificador haya corrido):
// una suscripción vencida pasada la gracia se comporta como Gratis. Nunca se borra nada: se apagan los módulos y, pasado el plazo de Gratis, el
// condominio queda en SOLO LECTURA (`solo_lectura`; ver `exigirOperativo` en `operativo.ts`).
import { diasEntre, hoyLima } from '../../lib/fechas';
import { CAPACIDADES, type EstadoSuscripcion } from './catalogo';

export interface EntradaSuscripcion {
  plan_clave: string;
  modulos: string[];
  estado: string;
  vigente_hasta: Date | null;
  solicitud_plan: string | null;
  solicitud_modulos: string[];
  /** Prueba de Pro al registrarse: al vencer vuelve a Gratis al instante. Ausente o false = suscripción de pago normal. */
  es_prueba?: boolean;
  /** Último día del periodo gratis (00:00 UTC del día de Lima); pasado, un condominio que cuenta como Gratis queda en solo lectura. Ausente o null = sin plazo. */
  gratis_hasta?: Date | null;
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
  /** Prueba de Pro vigente (Pro completo mientras dura; al vencer, ya es Gratis). */
  en_prueba: boolean;
  /** Último día del periodo gratis de la suscripción (se informa aunque hoy esté en un plan de pago: si luego vuelve a Gratis, vale); null = sin plazo. */
  gratis_hasta: Date | null;
  /** Cuenta como Gratis Y su `gratis_hasta` ya pasó: sólo se lee y se paga la suscripción; no se registra nada nuevo. Cortesía y planes de pago vigentes (o en gracia) nunca. */
  solo_lectura: boolean;
}

/** Los planes que no se pagan: Gratis y Cortesía. El resto (Básico, Pro, Administradora) se cobra aunque no traiga módulos. */
export const planDePago = (clave: string): boolean => clave !== 'gratis' && clave !== 'cortesia';

const GRATIS: PlanMinimo = { clave: 'gratis', modulos_incluidos: [] };

/** Fecha (00:00 UTC del día de Lima) en que termina una prueba de `dias` días que empieza hoy. */
export const finDePrueba = (dias: number, ahora: Date): Date => new Date(hoyLima(ahora).getTime() + dias * 86_400_000);

/** El día siguiente al último día gratis: desde ahí se comporta en solo lectura. */
export const primerDiaSoloLectura = (gratisHasta: Date): Date => new Date(gratisHasta.getTime() + 86_400_000);

/**
 * Estado que cuenta para las puertas y las pantallas. Una prueba de Pro vencida vuelve a Gratis AL INSTANTE: sin días de gracia, sin «vencida» y
 * sin apagado (sólo deja de tener lo de Pro, igual que cualquier Gratis). Una prueba vigente es Pro completo con `en_prueba`.
 */
export function estadoEfectivo(sus: EntradaSuscripcion | null, planes: PlanMinimo[], plazos: Plazos, ahora: Date): EstadoEfectivo {
  const base = estadoSinPlazo(sus, planes, plazos, ahora);
  const gratisHasta = sus?.gratis_hasta ?? null;
  // Cuenta como Gratis: sin suscripción, plan Gratis o un plan de pago vencido y apagado. La prueba vigente (plan Pro) y la cortesía no.
  const cuentaComoGratis = base.plan_clave === 'gratis' || base.apagada;

  const solo_lectura = cuentaComoGratis && gratisHasta != null && diasEntre(hoyLima(ahora), gratisHasta) < 0;
  return { ...base, gratis_hasta: gratisHasta, solo_lectura };
}

function estadoSinPlazo(sus: EntradaSuscripcion | null, planes: PlanMinimo[], plazos: Plazos, ahora: Date): Omit<EstadoEfectivo, 'gratis_hasta' | 'solo_lectura'> {
  if (sus?.es_prueba && sus.vigente_hasta) {
    const dias = diasEntre(hoyLima(ahora), sus.vigente_hasta);
    if (dias < 0) return { plan_clave: 'gratis', estado: 'gratis', modulos: [], dias_para_vencer: dias, en_gracia: false, apagada: false, en_prueba: false };
    return { ...estadoDeSuscripcion(sus, planes, plazos, ahora), en_prueba: true };
  }
  return { ...estadoDeSuscripcion(sus, planes, plazos, ahora), en_prueba: false };
}

/** La vigencia de una suscripción de pago (sin la prueba): Gratis, solicitada, activa, por vencer, vencida o apagada. */
function estadoDeSuscripcion(sus: EntradaSuscripcion | null, planes: PlanMinimo[], plazos: Plazos, ahora: Date): Omit<EstadoEfectivo, 'en_prueba' | 'gratis_hasta' | 'solo_lectura'> {
  if (!sus) return { plan_clave: 'gratis', estado: 'gratis', modulos: [], dias_para_vencer: null, en_gracia: false, apagada: false };
  const plan = planes.find((p) => p.clave === sus.plan_clave) ?? GRATIS;
  const comprados = [...new Set([...plan.modulos_incluidos, ...sus.modulos])];
  const pendiente = sus.solicitud_plan != null || sus.solicitud_modulos.length > 0;

  // Cortesía: todo lo que trae el plan MÁS cada capacidad del catálogo (aunque el plan en la base aún no la liste), sin cobro ni vencimiento.
  if (plan.clave === 'cortesia') return { plan_clave: plan.clave, estado: 'activa', modulos: [...new Set([...comprados, ...CAPACIDADES])], dias_para_vencer: null, en_gracia: false, apagada: false };

  // Sin pago = Gratis. Básico no trae módulos pero SÍ se paga: lo decide el plan, no la lista de módulos.
  const sinPago = comprados.length === 0 && !planDePago(plan.clave);
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
