// Solo lectura al terminar el periodo gratis. Un condominio que cuenta como Gratis y cuyo `gratis_hasta` ya pasó se puede leer entero (pantallas,
// historial, vouchers) pero no se le registra nada nuevo; pasar a un plan de pago lo levanta al instante. Nada se borra. El backend es la fuente de
// verdad: las pantallas sólo reflejan `solo_lectura`.
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import type { Rol } from '../../config';
import { estadoDeComplejo } from './modulos';

export const MENSAJE_SOLO_LECTURA = 'Este condominio está en solo lectura: terminó su periodo gratis. Pásalo a Torre Pro desde Mi plan para seguir registrando.';
/** Lo que ve un residente: él no puede cambiar el plan, así que se le manda con quien sí. */
export const MENSAJE_SOLO_LECTURA_VECINO = 'Este condominio está en solo lectura por ahora: no se pueden registrar movimientos nuevos. Habla con tu administración.';

const RESIDENTES: Rol[] = ['propietario', 'inquilino'];

/** ¿Este condominio está hoy en solo lectura? Sin condominio (null) no hay plazo que vencer: no. */
export async function enSoloLectura(complejoId: number | null | undefined): Promise<boolean> {
  if (complejoId == null) return false;
  return (await estadoDeComplejo(complejoId)).solo_lectura;
}

/**
 * Puerta de las acciones que CREAN trabajo (recibos, lecturas de agua, pagos, comprobantes, comunicados, cierres, altas de unidades…): 409 con
 * `code: 'SOLO_LECTURA'` si el condominio está en solo lectura. El superadmin nunca queda bloqueado. Lo que sólo lee no la llama.
 */
export async function exigirOperativo(complejoId: number | null | undefined, user: { rol: Rol }): Promise<void> {
  if (user.rol === 'superadmin') return;
  if (!(await enSoloLectura(complejoId))) return;
  throw new HttpError(409, RESIDENTES.includes(user.rol) ? MENSAJE_SOLO_LECTURA_VECINO : MENSAJE_SOLO_LECTURA, undefined, 'SOLO_LECTURA');
}

/**
 * Lo que se guarda por empresa (conceptos, proveedores) y no por condominio: se bloquea sólo cuando la empresa tiene condominios y TODOS están en solo
 * lectura (con uno operativo, la administradora sigue necesitando su catálogo). Una empresa sin condominios no se bloquea.
 */
export async function exigirOperativoEmpresa(empresaId: number | null | undefined, user: { rol: Rol }): Promise<void> {
  if (user.rol === 'superadmin' || empresaId == null) return;
  const complejos = await prisma.complejoHabitacional.findMany({ where: { empresa_id: empresaId }, select: { id: true } });
  if (!complejos.length) return;
  for (const c of complejos) if (!(await enSoloLectura(c.id))) return;
  await exigirOperativo(complejos[0].id, user);
}

// Condominio al que pertenece cada cosa que se crea o cambia (null = no se encontró: la ruta ya respondió 404 por su alcance, aquí no se bloquea).
export const complejoDeUnidad = async (id: number | null | undefined): Promise<number | null> => (id == null ? null : (await prisma.unidad.findUnique({ where: { id }, select: { complejo_id: true } }))?.complejo_id ?? null);
export const complejoDeEstructura = async (id: number | null | undefined): Promise<number | null> => (id == null ? null : (await prisma.estructura.findUnique({ where: { id }, select: { complejo_id: true } }))?.complejo_id ?? null);
export const complejoDeRecibo = async (id: number | null | undefined): Promise<number | null> => (id == null ? null : (await prisma.recibo.findUnique({ where: { id }, select: { complejo_id: true } }))?.complejo_id ?? null);
export const complejoDeReciboConcepto = async (id: number | null | undefined): Promise<number | null> => (id == null ? null : (await prisma.reciboConcepto.findUnique({ where: { id }, select: { recibo: { select: { complejo_id: true } } } }))?.recibo?.complejo_id ?? null);
export const complejoDeCargo = async (id: number | null | undefined): Promise<number | null> => (id == null ? null : (await prisma.reciboConceptoUnidad.findUnique({ where: { id }, select: { reciboConcepto: { select: { recibo: { select: { complejo_id: true } } } } } }))?.reciboConcepto?.recibo?.complejo_id ?? null);
export const complejoDePago = async (id: number | null | undefined): Promise<number | null> => (id == null ? null : complejoDeCargo((await prisma.pago.findUnique({ where: { id }, select: { recibo_concepto_unidad_id: true } }))?.recibo_concepto_unidad_id));
