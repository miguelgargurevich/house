import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, invalid, notFound } from '../errors';
import { ROLES_RESIDENTE } from '../config';
import { revocarDeUsuario } from '../services/sesiones';
import { ZONA_POR_DEFECTO } from '../../lib/paises';
import { hoyEn } from './fechas';

type Tx = Prisma.TransactionClient;

/**
 * Contrato de administración: qué empresa administra un condominio y desde cuándo. `ComplejoHabitacional.empresa_id` es SIEMPRE la
 * empresa del contrato vigente (`fecha_fin` null); todo el alcance (unidades, residentes, recibos nuevos, personal) sale de ahí.
 * Hay un solo contrato vigente por condominio: lo garantiza esta función (bloquea la fila del condominio) y una prueba.
 */

/** El día de hoy en la zona del condominio: la fecha con la que empieza un contrato que no dice otra. */
async function hoyDelCondominio(tx: Tx, complejoId: number): Promise<Date> {
  const c = await tx.complejoHabitacional.findUnique({ where: { id: complejoId }, select: { zona_horaria: true } });
  return hoyEn(c?.zona_horaria ?? ZONA_POR_DEFECTO);
}

/** Inicio de un contrato que no se registró: el primer recibo del condominio, o hoy. */
async function inicioEstimado(tx: Tx, complejoId: number): Promise<Date> {
  const primero = await tx.recibo.findFirst({ where: { complejo_id: complejoId }, orderBy: { fecha_emision: 'asc' }, select: { fecha_emision: true } });
  return primero?.fecha_emision ?? (await hoyDelCondominio(tx, complejoId));
}

/** Cambia la administradora de un condominio: cierra el contrato vigente, abre el nuevo y mueve lo que sigue a la empresa vigente, todo en una transacción. */
export async function cambiarAdministradora(complejoId: number, empresaId: number, opts: { fecha_inicio?: Date; observaciones?: string | null } = {}) {
  const liberados: number[] = [];
  const resultado = await prisma.$transaction(async (tx) => {
    // Serializa los cambios del mismo condominio: dos peticiones simultáneas no pueden dejar dos contratos vigentes.
    const bloqueado = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "ComplejoHabitacional" WHERE id = ${complejoId} FOR UPDATE`;
    if (!bloqueado.length) throw notFound('Condominio');
    const complejo = await tx.complejoHabitacional.findUniqueOrThrow({ where: { id: complejoId }, select: { id: true, empresa_id: true } });
    const empresa = await tx.empresaAdministradora.findUnique({ where: { id: empresaId }, select: { id: true } });
    if (!empresa) throw invalid('Datos inválidos: empresa_id: no existe', { empresa_id: 'No existe' });

    let vigente = await tx.contratoAdministracion.findFirst({ where: { complejo_id: complejoId, fecha_fin: null }, orderBy: { id: 'desc' } });
    if (!vigente && complejo.empresa_id != null) {
      vigente = await tx.contratoAdministracion.create({ data: { complejo_id: complejoId, empresa_id: complejo.empresa_id, fecha_inicio: await inicioEstimado(tx, complejoId) } });
    }
    if (vigente?.empresa_id === empresaId) throw conflict('Esa empresa ya administra este condominio');
    const inicio = opts.fecha_inicio ?? (await hoyDelCondominio(tx, complejoId));
    if (vigente && inicio < vigente.fecha_inicio) {
      throw invalid('Datos inválidos: fecha_inicio: no puede ser anterior al inicio del contrato vigente', { fecha_inicio: 'Anterior al contrato vigente' });
    }
    if (vigente) await tx.contratoAdministracion.update({ where: { id: vigente.id }, data: { fecha_fin: inicio } });
    const contrato = await tx.contratoAdministracion.create({
      data: { complejo_id: complejoId, empresa_id: empresaId, fecha_inicio: inicio, observaciones: opts.observaciones ?? null },
    });
    await tx.complejoHabitacional.update({ where: { id: complejoId }, data: { empresa_id: empresaId } });
    // La empresa de la unidad es la de su condominio: sin esto la anterior seguiría viéndolas.
    await tx.unidad.updateMany({ where: { complejo_id: complejoId }, data: { empresa_id: empresaId } });
    // El personal de la empresa anterior destinado a este condominio deja de estarlo (sigue siendo de su empresa; sus tareas quedan como historial).
    const previa = vigente?.empresa_id ?? null;
    if (previa != null) {
      const personal = await tx.usuario.findMany({ where: { complejo_id: complejoId, empresa_id: previa, rol: { notIn: [...ROLES_RESIDENTE] } }, select: { id: true } });
      if (personal.length) {
        await tx.usuario.updateMany({ where: { id: { in: personal.map((p) => p.id) } }, data: { complejo_id: null } });
        liberados.push(...personal.map((p) => p.id));
      }
    }
    return { contrato, anterior: vigente ? { ...vigente, fecha_fin: inicio } : null };
  });
  // Su alcance cambió: cierra sus sesiones abiertas (como al cambiar el rol).
  for (const id of liberados) await revocarDeUsuario(id);
  return { ...resultado, personal_liberado: liberados.length };
}

/** Condominio nuevo: abre su primer contrato vigente. */
export async function abrirContrato(tx: Tx, complejoId: number, empresaId: number, inicio?: Date, observaciones: string | null = null) {
  inicio ??= await hoyDelCondominio(tx, complejoId);
  return tx.contratoAdministracion.create({ data: { complejo_id: complejoId, empresa_id: empresaId, fecha_inicio: inicio, observaciones } });
}
