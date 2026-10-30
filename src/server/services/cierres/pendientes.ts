// Qué le falta registrar a la junta de un block en el cierre de un mes (lo usa el recordatorio `cierre_pendiente`).
import { prisma } from '../../db';
import { periodoTexto } from '../../lib/periodo';
import { calcularBlocks, mesDeBlock } from './calculo';

export interface CierrePendiente {
  bloque: string;
  condominio: string | null;
  periodo: string;
  /** Nombres de las líneas sin pago registrado. */
  lineas: string[];
}

/** `null` si ya no falta nada (o el block ya no existe): no hay nada que avisar. */
export async function cierrePendiente(estructuraId: number, anio: number, mes: number): Promise<CierrePendiente | null> {
  const b = await prisma.estructura.findUnique({ where: { id: estructuraId }, select: { id: true, nombre: true, complejo_id: true, complejo: { select: { nombre: true } } } });
  if (!b) return null;
  const cierre = mesDeBlock((await calcularBlocks([b.id])).get(b.id)!, b.id, b.complejo_id, anio, mes);
  const faltan = cierre.lineas.filter((l) => !l.obsoleta && !l.registro).map((l) => l.nombre);
  if (!cierre.hay_recibo || !faltan.length) return null;
  return { bloque: b.nombre ?? 'tu block', condominio: b.complejo?.nombre ?? null, periodo: periodoTexto(mes, anio), lineas: faltan };
}
