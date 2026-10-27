// Puerta por módulo: `moduloActivo(complejoId, clave)` y sus variantes. Una consulta por condominio con caché corta por proceso;
// toda escritura de la suscripción, de los planes o de la configuración llama a `invalidarComercial()`.
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import type { AuthUser } from '../../middleware/auth';
import type { ModuloClave } from './catalogo';
import { CONFIGURACION_ID } from './catalogo';
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
    prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true } }),
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

/** ¿Este condominio tiene el módulo activo? Sin condominio (null) no hay a quién cobrarle: no. */
export async function moduloActivo(complejoId: number | null | undefined, clave: ModuloClave): Promise<boolean> {
  if (complejoId == null) return false;
  return (await estadoDeComplejo(complejoId)).modulos.includes(clave);
}

export const NOMBRES_MODULO: Record<ModuloClave, string> = {
  ia_vouchers: 'IA que lee y valida vouchers',
  whatsapp_avisos: 'Avisos por WhatsApp',
  asistente: 'Asistente con IA',
};

/** 403 con `code: 'MODULO_NO_ACTIVO'` y el módulo: la pantalla muestra el aviso «Disponible con el módulo…». */
export function moduloNoActivo(clave: ModuloClave, mensaje?: string): HttpError {
  return new HttpError(403, mensaje ?? `Tu condominio no tiene activo el módulo «${NOMBRES_MODULO[clave]}»`, undefined, 'MODULO_NO_ACTIVO', { modulo: clave });
}

export async function exigirModulo(complejoId: number | null | undefined, clave: ModuloClave, mensaje?: string): Promise<void> {
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
export async function moduloActivoPara(user: AuthUser, clave: ModuloClave): Promise<boolean> {
  const ids = await complejosDe(user);
  if (ids === null) return true;
  for (const id of ids) if (await moduloActivo(id, clave)) return true;
  return false;
}

export const MENSAJE_SIN_ASISTENTE = 'Tu condominio no tiene el asistente activo. Pídele a tu administración que active el módulo «Asistente con IA» en Mi plan.';
