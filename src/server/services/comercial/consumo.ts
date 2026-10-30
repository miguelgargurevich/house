// Topes mensuales de consumo por condominio: el asistente de IA y los mensajes de WhatsApp. El tope del mes es el valor del plan por
// departamento × las unidades que se cobran (lo mismo que la vista: el mínimo del plan, si lo tiene). El contador se reserva ANTES de gastar,
// con un incremento atómico condicionado: dos peticiones a la vez no pasan el tope. También están aquí los números del mes para pasar a Pro
// (vouchers validados a mano y con la IA), que se leen de la misma pantalla.
import type { AuthUser } from '../../middleware/auth';
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { hoyEn, inicioMesEn, medianocheEn } from '../../lib/fechas';
import { nombreMes } from '../../lib/periodo';
import { comercialDeps, complejosConModulo, complejosDe, estadoDeComplejo } from './modulos';

export type Recurso = 'asistente' | 'whatsapp';
export const MOTIVO_TOPE_WHATSAPP = 'Tope mensual de WhatsApp del condominio alcanzado';
const CAMPO_TOPE = { asistente: 'asistente_por_unidad_mes', whatsapp: 'whatsapp_por_unidad_mes' } as const;

/** AAAAMM del mes en Lima: la hora de Lima decide cuándo empieza el mes. */
export function periodoDe(ahora: Date): string {
  const h = hoyEn(ZONA_POR_DEFECTO, ahora);
  return `${h.getUTCFullYear()}${String(h.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** «noviembre»: el mes que viene en hora de Lima, para «se renuevan el 1 de …». */
export function mesSiguienteTexto(ahora: Date): string {
  const h = hoyEn(ZONA_POR_DEFECTO, ahora);
  return nombreMes(((h.getUTCMonth() + 1) % 12) + 1);
}

/** Tope del mes para el recurso: null = sin tope (Gratis, cortesía, o el plan no lo fija). Un plan vencido pasada la gracia cuenta como Gratis. */
export async function topeDelMes(complejoId: number, recurso: Recurso): Promise<number | null> {
  const ef = await estadoDeComplejo(complejoId);
  const plan = await prisma.planComercial.findUnique({
    where: { clave: ef.apagada ? 'gratis' : ef.plan_clave },
    select: { asistente_por_unidad_mes: true, whatsapp_por_unidad_mes: true, unidades_minimas: true },
  });
  const porUnidad = plan?.[CAMPO_TOPE[recurso]] ?? null;
  if (porUnidad == null) return null;
  const unidades = await prisma.unidad.count({ where: { complejo_id: complejoId } });
  return porUnidad * Math.max(unidades, plan?.unidades_minimas ?? 0);
}

export interface Reserva { permitido: boolean; usadas: number; tope: number | null }

/**
 * Reserva UNA unidad del recurso para el mes en curso, antes de gastarla. Sin tope no cuenta ni bloquea. La fila del mes se crea si falta (dos
 * peticiones a la vez: `skipDuplicates` deja una sola) y el incremento sólo pasa si la cuenta aún está bajo el tope, en una sola sentencia.
 */
export async function reservarConsumo(complejoId: number, recurso: Recurso, ahora: Date = comercialDeps.ahora()): Promise<Reserva> {
  const tope = await topeDelMes(complejoId, recurso);
  if (tope == null) return { permitido: true, usadas: 0, tope: null };
  const periodo = periodoDe(ahora);
  await prisma.consumoMensual.createMany({ data: [{ complejo_id: complejoId, periodo, recurso }], skipDuplicates: true });
  const r = await prisma.consumoMensual.updateMany({ where: { complejo_id: complejoId, periodo, recurso, cantidad: { lt: tope } }, data: { cantidad: { increment: 1 } } });
  const fila = await prisma.consumoMensual.findUnique({ where: { complejo_id_periodo_recurso: { complejo_id: complejoId, periodo, recurso } }, select: { cantidad: true } });
  return { permitido: r.count === 1, usadas: fila?.cantidad ?? 0, tope };
}

/** Vouchers validados del mes (en Lima) del condominio, a mano y con la IA. Un grupo cuenta una sola vez: su pago principal (el que lleva el voucher). */
export async function conteoVouchers(complejoId: number, ahora: Date = comercialDeps.ahora()): Promise<{ a_mano: number; ia: number }> {
  const h = hoyEn(ZONA_POR_DEFECTO, ahora);
  const siguiente = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() + 1, 1));
  const base = {
    estado_validacion: 'validado',
    validado_at: { gte: inicioMesEn(ZONA_POR_DEFECTO, ahora), lt: medianocheEn(ZONA_POR_DEFECTO, siguiente.getUTCFullYear(), siguiente.getUTCMonth() + 1, 1) },
    comprobante: { isNot: null },
    AND: [{ OR: [{ grupo_principal: true }, { grupo: null }] }],
    reciboConceptoUnidad: { reciboConcepto: { recibo: { complejo_id: complejoId } } },
  };
  const [a, ia] = await Promise.all([
    prisma.pago.count({ where: { ...base, validado_por_ia: false } }),
    prisma.pago.count({ where: { ...base, validado_por_ia: true } }),
  ]);
  return { a_mano: a, ia };
}

export interface UsoMes {
  periodo: string;
  /** «noviembre»: cuándo se renuevan los topes. */
  renueva: string;
  asistente: { usadas: number; tope: number | null };
  whatsapp: { usadas: number; tope: number | null };
  vouchers_a_mano: number;
  vouchers_ia: number;
}

/** Lo que va del mes en cada tope y los vouchers del mes, de un condominio. */
export async function usoDelMes(complejoId: number, ahora: Date = comercialDeps.ahora()): Promise<UsoMes> {
  const periodo = periodoDe(ahora);
  const [topeAsistente, topeWhatsapp, filas, vouchers] = await Promise.all([
    topeDelMes(complejoId, 'asistente'),
    topeDelMes(complejoId, 'whatsapp'),
    prisma.consumoMensual.findMany({ where: { complejo_id: complejoId, periodo }, select: { recurso: true, cantidad: true } }),
    conteoVouchers(complejoId, ahora),
  ]);
  const usadas = (r: Recurso) => filas.find((f) => f.recurso === r)?.cantidad ?? 0;
  return {
    periodo,
    renueva: mesSiguienteTexto(ahora),
    asistente: { usadas: usadas('asistente'), tope: topeAsistente },
    whatsapp: { usadas: usadas('whatsapp'), tope: topeWhatsapp },
    vouchers_a_mano: vouchers.a_mano,
    vouchers_ia: vouchers.ia,
  };
}

/**
 * El condominio al que se carga la consulta al asistente: el que eligió la pantalla (si lo alcanza la persona), el suyo, o el único con el
 * asistente activo. Con varios y sin elegir, cuenta el de menor id con el asistente activo. `null` = el superadmin (sin tope).
 */
export async function complejoDelAsistente(user: AuthUser, elegido?: number | null): Promise<number | null> {
  const ids = await complejosDe(user);
  if (ids === null) return null;
  if (elegido != null) {
    if (!ids.includes(elegido)) throw new HttpError(404, 'Condominio no encontrado');
    return elegido;
  }
  if (user.complejo_id != null && ids.includes(user.complejo_id)) return user.complejo_id;
  const activos = (await complejosConModulo(user, 'asistente')) ?? [];
  return activos.length ? Math.min(...activos) : (ids[0] ?? null);
}

/** El 429 que ve quien pregunta: el mismo texto para todos; la administradora además ve el camino a Mi plan. */
export function mensajeTopeAsistente(user: AuthUser, ahora: Date): string {
  const base = `Este condominio usó las consultas al asistente de este mes. Se renuevan el 1 de ${mesSiguienteTexto(ahora)}.`;
  return user.rol === 'admin' ? `${base} Puedes subir el límite desde Mi plan.` : base;
}
