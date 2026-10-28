// Puerta por módulo: `moduloActivo(complejoId, clave)` y sus variantes. Una consulta por condominio con caché corta por proceso;
// toda escritura de la suscripción, de los planes o de la configuración llama a `invalidarComercial()`.
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import type { AuthUser } from '../../middleware/auth';
import { CONFIGURACION_ID, type CapacidadClave } from './catalogo';
import { estadoEfectivo, type EstadoEfectivo, type PlanMinimo, type Plazos } from './estado';

/** Puntos de inyección para pruebas (reloj y vida de la caché). */
export const comercialDeps = {
  ahora: (): Date => new Date(),
  /** Vida de la caché por condominio y de los planes/plazos. 0 = sin caché. */
  ttlMs: 30_000,
};

interface Entrada<T> { valor: T; hasta: number }
const porComplejo = new Map<number, Entrada<EstadoEfectivo>>();
let referencia: Entrada<{ planes: PlanMinimo[]; plazos: Plazos }> | null = null;
const TOPE_CLAVES = 5000;

/** Vacía la caché (todo, o un condominio). Se llama al cambiar una suscripción, un plan o la configuración. */
export function invalidarComercial(complejoId?: number): void {
  if (complejoId == null) { porComplejo.clear(); referencia = null; return; }
  porComplejo.delete(complejoId);
}

async function cargarReferencia(): Promise<{ planes: PlanMinimo[]; plazos: Plazos }> {
  const t = comercialDeps.ahora().getTime();
  if (referencia && referencia.hasta > t) return referencia.valor;
  const [planes, cfg] = await Promise.all([
    prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true, unidades_maximas: true } }),
    prisma.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { dias_gracia: true, dias_aviso_vencimiento: true } }),
  ]);
  const valor = { planes, plazos: cfg ?? { dias_gracia: 7, dias_aviso_vencimiento: 5 } };
  if (comercialDeps.ttlMs > 0) referencia = { valor, hasta: t + comercialDeps.ttlMs };
  return valor;
}

/** Estado de la suscripción de un condominio ahora mismo (con caché corta). */
export async function estadoDeComplejo(complejoId: number): Promise<EstadoEfectivo> {
  const t = comercialDeps.ahora().getTime();
  const c = porComplejo.get(complejoId);
  if (c && c.hasta > t) return c.valor;
  const [sus, ref] = await Promise.all([
    prisma.suscripcionCondominio.findUnique({ where: { complejo_id: complejoId }, select: { plan_clave: true, modulos: true, estado: true, vigente_hasta: true, solicitud_plan: true, solicitud_modulos: true } }),
    cargarReferencia(),
  ]);
  const valor = estadoEfectivo(sus, ref.planes, ref.plazos, comercialDeps.ahora());
  if (comercialDeps.ttlMs > 0) {
    if (porComplejo.size >= TOPE_CLAVES) porComplejo.clear();
    porComplejo.set(complejoId, { valor, hasta: t + comercialDeps.ttlMs });
  }
  return valor;
}

/** ¿Este condominio tiene la capacidad activa (un módulo, la mora automática o los reportes)? Sin condominio (null) no hay a quién cobrarle: no. */
export async function moduloActivo(complejoId: number | null | undefined, clave: CapacidadClave): Promise<boolean> {
  if (complejoId == null) return false;
  return (await estadoDeComplejo(complejoId)).modulos.includes(clave);
}

export const NOMBRES_MODULO: Record<CapacidadClave, string> = {
  ia_vouchers: 'IA que lee y valida vouchers',
  whatsapp_avisos: 'Avisos por WhatsApp',
  asistente: 'Asistente con IA',
  mora_automatica: 'Mora automática',
  reportes: 'Reportes y exportes',
};

/** 403 con `code: 'MODULO_NO_ACTIVO'` y la capacidad: la pantalla muestra el aviso «Disponible en el plan Pro» con el enlace a Mi plan. */
export function moduloNoActivo(clave: CapacidadClave, mensaje?: string): HttpError {
  return new HttpError(403, mensaje ?? `«${NOMBRES_MODULO[clave]}» está disponible en el plan Pro. Pasa a Pro desde Mi plan`, undefined, 'MODULO_NO_ACTIVO', { modulo: clave });
}

export async function exigirModulo(complejoId: number | null | undefined, clave: CapacidadClave, mensaje?: string): Promise<void> {
  if (!(await moduloActivo(complejoId, clave))) throw moduloNoActivo(clave, mensaje);
}

/**
 * Condominios que alcanza una persona (para los módulos que se usan por persona, como el asistente): el suyo, los de su empresa
 * (administradora y personal) o aquellos donde tiene unidades (residentes). `null` = todos (superadmin).
 */
export async function complejosDe(user: AuthUser): Promise<number[] | null> {
  if (user.rol === 'superadmin') return null;
  const ids = new Set<number>();
  if (user.complejo_id != null) ids.add(user.complejo_id);
  if (user.empresa_id != null && (user.complejo_id == null || user.rol === 'admin')) {
    for (const c of await prisma.complejoHabitacional.findMany({ where: { empresa_id: user.empresa_id }, select: { id: true } })) ids.add(c.id);
  }
  if (user.rol === 'propietario' || user.rol === 'inquilino') {
    const unidades = await prisma.unidad.findMany({ where: { OR: [{ propietario_id: user.id }, { inquilino_id: user.id }], complejo_id: { not: null } }, select: { complejo_id: true } });
    for (const u of unidades) if (u.complejo_id != null) ids.add(u.complejo_id);
  }
  return [...ids];
}

/** ¿Alguno de los condominios de la persona tiene el módulo? Superadmin siempre. */
export async function moduloActivoPara(user: AuthUser, clave: CapacidadClave): Promise<boolean> {
  const ids = await complejosDe(user);
  if (ids === null) return true;
  for (const id of ids) if (await moduloActivo(id, clave)) return true;
  return false;
}

/** De los condominios que alcanza la persona, los que tienen la capacidad activa; `null` = todos (superadmin). */
export async function complejosConModulo(user: AuthUser, clave: CapacidadClave): Promise<number[] | null> {
  const ids = await complejosDe(user);
  if (ids === null) return null;
  const activos: number[] = [];
  for (const id of ids) if (await moduloActivo(id, clave)) activos.push(id);
  return activos;
}

export const MENSAJE_SIN_ASISTENTE = 'Tu condominio no tiene el asistente activo: es parte del plan Pro. Pídele a tu administración que pase a Pro desde Mi plan.';

// ---------- Tope de unidades del plan ----------
/** El plan «que cuenta» para el tope: el contratado, salvo que esté vencido y apagado (entonces se comporta como Gratis, igual que con los módulos). */
export async function limiteDeUnidades(complejoId: number): Promise<{ plan_clave: string; maximo: number | null }> {
  const [ef, ref] = await Promise.all([estadoDeComplejo(complejoId), cargarReferencia()]);
  const claveEfectiva = ef.apagada ? 'gratis' : ef.plan_clave;
  const plan = ref.planes.find((p) => p.clave === claveEfectiva);
  return { plan_clave: claveEfectiva, maximo: plan?.unidades_maximas ?? null };
}

/**
 * Antes de crear `agregar` unidades en un condominio: si su plan tiene tope y se pasaría, 403 con `code: 'LIMITE_UNIDADES'`. Nunca se borra ni se
 * esconde nada: quien ya tiene más unidades que el tope sólo deja de poder agregar más.
 */
export async function exigirCupoDeUnidades(complejoId: number | null | undefined, agregar = 1): Promise<void> {
  if (complejoId == null) return;
  const { plan_clave, maximo } = await limiteDeUnidades(complejoId);
  if (maximo == null) return;
  const actuales = await prisma.unidad.count({ where: { complejo_id: complejoId } });
  if (actuales + agregar <= maximo) return;
  const nombre = plan_clave.charAt(0).toUpperCase() + plan_clave.slice(1);
  throw new HttpError(403, `El plan ${nombre} llega hasta ${maximo} departamentos; pasa a Pro desde Mi plan`, undefined, 'LIMITE_UNIDADES', { limite: maximo, actuales });
}
