import type { PrismaClient } from '@prisma/client';
import { ZONA_POR_DEFECTO } from '../../lib/paises';
import { hoyEn } from './fechas';

/**
 * Migración de datos: todo condominio con empresa y sin contrato vigente recibe uno (idempotente: una segunda corrida no cambia nada).
 * Devuelve cuántos contratos creó (o, con `simular`, cuántos crearía).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function crearContratosIniciales(cliente: Pick<PrismaClient<any, any, any>, 'complejoHabitacional' | 'contratoAdministracion' | 'recibo'>, simular = false): Promise<number> {
  const faltan = await cliente.complejoHabitacional.findMany({
    where: { empresa_id: { not: null }, contratos: { none: { fecha_fin: null } } },
    select: { id: true, empresa_id: true, zona_horaria: true },
  });
  if (simular) return faltan.length;
  for (const c of faltan) {
    const primero = await cliente.recibo.findFirst({ where: { complejo_id: c.id }, orderBy: { fecha_emision: 'asc' }, select: { fecha_emision: true } });
    await cliente.contratoAdministracion.create({ data: { complejo_id: c.id, empresa_id: c.empresa_id as number, fecha_inicio: primero?.fecha_emision ?? hoyEn(c.zona_horaria ?? ZONA_POR_DEFECTO) } });
  }
  return faltan.length;
}
