// Qué le falta registrar a la junta de un block en el cierre de un mes (lo usa el recordatorio `cierre_pendiente`).
import { prisma } from '../../db';
import { periodoTexto } from '../../lib/periodo';
import { calcularBlocks, mesDeBlock } from './calculo';
import { calcularCentral } from './central';

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

export interface AportesPendientes {
  condominio: string | null;
  periodo: string;
  /** Nombres de los blocks que aún no registran su aporte a la Junta central. */
  blocks: string[];
}

/** Blocks sin aporte a la Junta central en ese mes. `null` si todos ya aportaron (o no hay aportes que esperar, o el condominio ya no existe): no hay nada que avisar. */
export async function aportesPendientes(complejoId: number, anio: number, mes: number): Promise<AportesPendientes | null> {
  const c = await prisma.complejoHabitacional.findUnique({ where: { id: complejoId }, select: { nombre: true } });
  if (!c) return null;
  const { blocks_sin_aportar } = await calcularCentral(complejoId, anio, mes);
  if (!blocks_sin_aportar.length) return null;
  return { condominio: c.nombre, periodo: periodoTexto(mes, anio), blocks: blocks_sin_aportar.map((b) => b.nombre ?? 'Block') };
}
