// Dos correcciones de un pago que la pantalla no dejaba deshacer.
//  · `anularPago`: anular un pago ya VALIDADO (el recibo vuelve a quedar por pagar). No se borra nada: el pago queda en la base con `estado_validacion = 'anulado'`,
// quién lo anuló, cuándo y por qué, y deja de contar en todo (ver `lib/pagoVigente.ts`). Un pago de mantenimiento son N filas con el mismo `grupo`: se anulan todas.
//
// Cierre del mes: lo que la junta registró como pagado en el cierre de un block (`EgresoBlock`) se calculó con lo cobrado. Si el mes del recibo ya tiene
// TODAS sus líneas registradas, anular cambiaría el sobrante y el fondo de ahorros ya cerrados: se pide reabrir primero (quitar el registro de las líneas
// en Junta › Cierre del mes, que sí tiene esa salida: `DELETE /api/cierres/lineas/:id`).
//
//  · `reabrirPago`: «Volver a revisar» un pago RECHAZADO (la administración se equivocó). Todo el grupo vuelve a `por_validar` y el cargo a «en revisión»; el rechazo
// anterior (motivo, quién, cuándo, la conformidad) se limpia de las filas y queda en la auditoría. Nunca deja dos pagos vigentes del mismo cargo.
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, HttpError } from '../errors';
import { PAGO_VIGENTE } from '../lib/pagoVigente';
import { periodoTexto } from '../lib/periodo';
import { calcularBlocks, mesDeBlock } from './cierres/calculo';
import { avisarResultado, sincronizarCargo } from './validacionPago';

export const MOTIVO_ANULACION_MIN = 5;
export const MOTIVO_ANULACION_MAX = 200;

export interface PagoAnulado {
  /** El pago que representa al grupo (o el mismo pago, si es suelto). */
  id: number;
  grupo: string | null;
  /** Filas anuladas (una por concepto). */
  pagos: number;
  /** Suma de las filas anuladas, con dos decimales. */
  monto: string;
  cargos: number[];
}

/** Por qué un pago que no está validado no se anula. */
const NO_ANULABLE: Record<string, string> = {
  anulado: 'Este pago ya fue anulado',
  por_validar: 'Este pago aún no está validado: recházalo en lugar de anularlo',
  rechazado: 'Un pago rechazado ya no cuenta: no hay nada que anular',
};

/**
 * Si el mes de alguno de los cargos ya tiene el cierre de su block registrado por completo, lanza 409 («reábrelo antes de anular»).
 * Sin recibo por block, o con el cierre incompleto (faltan líneas por registrar), no bloquea: nada se ha cerrado todavía.
 */
async function exigirMesAbierto(cargoIds: number[], accion = 'anular'): Promise<void> {
  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: { id: { in: cargoIds } },
    select: { unidad: { select: { estructura_id: true } }, reciboConcepto: { select: { recibo: { select: { estructura_id: true, complejo_id: true, mes: true, anio: true, estructura: { select: { nombre: true } } } } } } },
  });
  const vistos = new Set<string>();
  for (const c of cargos) {
    const r = c.reciboConcepto?.recibo;
    const estructuraId = r?.estructura_id ?? c.unidad?.estructura_id ?? null;
    if (!r || estructuraId == null) continue;
    const clave = `${estructuraId}|${r.anio}|${r.mes}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const cierre = mesDeBlock((await calcularBlocks([estructuraId])).get(estructuraId)!, estructuraId, r.complejo_id, r.anio, r.mes);
    if (cierre.registrado_completo && cierre.lineas.some((l) => l.registro)) {
      const bloque = r.estructura?.nombre ?? 'el block';
      throw conflict(`El mes ya está cerrado (${periodoTexto(r.mes, r.anio)}, ${bloque}): reábrelo antes de ${accion}. Quita el registro de sus líneas en Junta › Cierre del mes`);
    }
  }
}

/**
 * Anula el pago (y todo su grupo). Un pago que no está `validado` da 409; uno ya anulado, también (no se anula dos veces). El permiso y el alcance de la empresa
 * los resuelve quien llama: `pagoId` ya es de su alcance. En una sola transacción marca las filas y recalcula cada cargo (`sincronizarCargo`): el recibo vuelve a
 * pendiente. El aviso al vecino sale después y nunca rompe la anulación.
 */
export async function anularPago(pagoId: number, usuarioId: number, motivo: string): Promise<PagoAnulado> {
  const pago = await prisma.pago.findUnique({ where: { id: pagoId }, select: { id: true, estado_validacion: true, grupo: true } });
  if (!pago) throw conflict('Este pago ya no existe');
  if (pago.estado_validacion !== 'validado') throw conflict(NO_ANULABLE[pago.estado_validacion] ?? 'Este pago no se puede anular');

  const filas = await prisma.pago.findMany({
    where: pago.grupo != null ? { grupo: pago.grupo, estado_validacion: 'validado' } : { id: pago.id },
    select: { id: true, monto: true, grupo_principal: true, recibo_concepto_unidad_id: true },
    orderBy: { id: 'asc' },
  });
  const cargos = [...new Set(filas.map((f) => f.recibo_concepto_unidad_id).filter((c): c is number => c != null))];
  await exigirMesAbierto(cargos);

  const ahora = new Date();
  await prisma.$transaction(async (tx) => {
    // El UPDATE comprueba que sigan `validado`: dos anulaciones a la vez no pasan las dos (la segunda ve 0 filas).
    const r = await tx.pago.updateMany({
      where: { id: { in: filas.map((f) => f.id) }, estado_validacion: 'validado' },
      data: { estado_validacion: 'anulado', anulado_at: ahora, anulado_por_id: usuarioId, motivo_anulacion: motivo },
    });
    if (r.count === 0) throw conflict(NO_ANULABLE.anulado!);
    for (const id of cargos) await sincronizarCargo(tx, id);
  });

  const principal = filas.find((f) => f.grupo_principal) ?? filas.find((f) => f.id === pago.id) ?? filas[0]!;
  await avisarResultado(principal.id, 'anulado', motivo);
  return { id: principal.id, grupo: pago.grupo, pagos: filas.length, monto: filas.reduce((s, f) => s.plus(f.monto), new Prisma.Decimal(0)).toFixed(2), cargos };
}

// ---------- Volver a revisar un pago rechazado ----------
export const MOTIVO_REAPERTURA_MIN = 5;
export const MOTIVO_REAPERTURA_MAX = 200;

/** Cuánto de quien lo rechazó se conserva (para la auditoría: al limpiar las filas no se pierde). */
export interface RechazoAnterior {
  motivo: string | null;
  por_id: number | null;
  por_nombre: string | null;
  /** El rechazo lo hizo la IA (no hay persona). */
  por_ia: boolean;
  at: string | null;
  /** La conformidad del tesorero que tenía el pago (se limpia al reabrir: tras un rechazo, el tesorero la da otra vez). */
  conformidad_por_id: number | null;
  conformidad_at: string | null;
}

export interface PagoReabierto {
  id: number;
  grupo: string | null;
  pagos: number;
  monto: string;
  cargos: number[];
  rechazo_anterior: RechazoAnterior;
}

/** Por qué un pago que no está rechazado no se reabre. */
const NO_REABRIBLE: Record<string, string> = {
  por_validar: 'Este pago ya está por validar: revísalo',
  validado: 'Este pago ya está validado: no hay nada que volver a revisar',
  anulado: 'Un pago anulado no se vuelve a revisar: el vecino puede registrar el pago otra vez',
};

export const MENSAJE_OTRO_PAGO_VIGENTE = 'Ya hay otro pago de este mantenimiento: revisa ese';
export const MENSAJE_RECIBO_INEXISTENTE = 'El recibo de este pago ya no existe: no se puede volver a revisar';

type Lector = Pick<typeof prisma, 'pago' | 'reciboConceptoUnidad'>;

/** Otro pago vigente (por validar o validado) del mismo cargo lo cubre; también un cargo que ya figura pagado sin fila de pago (dato antiguo). Reabrir dejaría el mes cobrado dos veces. */
async function exigirSinOtroPagoVigente(tx: Lector, cargos: number[], filaIds: number[]): Promise<void> {
  const otro = await tx.pago.findFirst({ where: { AND: [{ recibo_concepto_unidad_id: { in: cargos }, id: { notIn: filaIds } }, PAGO_VIGENTE] }, select: { id: true } });
  if (otro) throw conflict(MENSAJE_OTRO_PAGO_VIGENTE);
  if ((await tx.reciboConceptoUnidad.count({ where: { id: { in: cargos }, estado_pago: 'pagado' } })) > 0) throw conflict('Este cargo ya figura pagado: no hay nada que volver a revisar');
}

/** Lo que se lee antes de reabrir (y para saber si se puede): el pago, sus filas rechazadas y sus cargos, con los 409 que no necesitan transacción. */
async function cargarReapertura(pagoId: number) {
  const pago = await prisma.pago.findUnique({ where: { id: pagoId }, select: { id: true, estado_validacion: true, grupo: true } });
  if (!pago) throw conflict('Este pago ya no existe');
  if (pago.estado_validacion !== 'rechazado') throw conflict(NO_REABRIBLE[pago.estado_validacion] ?? 'Este pago no se puede volver a revisar');

  const filas = await prisma.pago.findMany({
    where: pago.grupo != null ? { grupo: pago.grupo, estado_validacion: 'rechazado' } : { id: pago.id },
    select: { id: true, monto: true, grupo_principal: true, recibo_concepto_unidad_id: true, motivo_rechazo: true, validado_por_id: true, validado_at: true, validado_por_ia: true, conformidad_por_id: true, conformidad_at: true },
    orderBy: { id: 'asc' },
  });
  // El recibo del cargo ya no existe (o el pago quedó sin cargo): no hay a qué volver.
  const cargos = [...new Set(filas.map((f) => f.recibo_concepto_unidad_id).filter((c): c is number => c != null))];
  if (cargos.length === 0 || filas.some((f) => f.recibo_concepto_unidad_id == null)) throw conflict(MENSAJE_RECIBO_INEXISTENTE);
  const existentes = await prisma.reciboConceptoUnidad.findMany({ where: { id: { in: cargos } }, select: { id: true, reciboConcepto: { select: { recibo_id: true } } } });
  if (existentes.length !== cargos.length || existentes.some((c) => c.reciboConcepto?.recibo_id == null)) throw conflict(MENSAJE_RECIBO_INEXISTENTE);
  await exigirMesAbierto(cargos, 'volver a revisar');
  return { pago, filas, cargos };
}

/**
 * Vuelve a revisar un pago RECHAZADO (y todo su grupo): queda `por_validar`, el cargo «en revisión», y el rechazo se limpia (motivo, quién, cuándo, si lo hizo la IA y la
 * conformidad del tesorero: tras un rechazo el abono se vuelve a mirar, y quien lo da por bueno lo vuelve a confirmar). El permiso y el alcance los resuelve quien llama; quién
 * reabre y por qué lo guarda la auditoría de la ruta (el pago vuelve a ser un pago por revisar y no lleva ese rastro).
 *
 * 409 si el pago no está rechazado, si el mes tiene el cierre de su block registrado por completo (misma regla que anular), si el cargo ya tiene otro pago vigente (el vecino
 * volvió a subir el voucher: reabrir dejaría dos pagos del mismo mes) o si el recibo ya no existe. Los cargos se bloquean (`FOR UPDATE`) antes de mirar los otros pagos.
 *
 * Los avisos `pago_rechazado` de estos pagos: los que siguen en la cola pasan a `omitida` («Pago reabierto»), y todos (enviados o no) cambian de referencia, porque la
 * fila es única por (persona, canal, tipo, referencia) y, si el pago se rechaza otra vez, el aviso nuevo se perdería. No sale aviso nuevo por reabrir.
 */
export async function reabrirPago(pagoId: number): Promise<PagoReabierto> {
  const { pago, filas, cargos } = await cargarReapertura(pagoId);
  const filaIds = filas.map((f) => f.id);
  const ahora = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ReciboConceptoUnidad" WHERE id IN (${Prisma.join([...cargos].sort((a, b) => a - b))}) ORDER BY id FOR UPDATE`;
    await exigirSinOtroPagoVigente(tx, cargos, filaIds);
    // El UPDATE comprueba que sigan `rechazado`: dos reaperturas a la vez (o una validación) no pasan las dos.
    const r = await tx.pago.updateMany({
      where: { id: { in: filaIds }, estado_validacion: 'rechazado' },
      data: { estado_validacion: 'por_validar', motivo_rechazo: null, validado_at: null, validado_por_id: null, validado_por_ia: false, conformidad_at: null, conformidad_por_id: null },
    });
    if (r.count !== filaIds.length) throw conflict('Este pago ya no está rechazado: recarga la pantalla');
    for (const id of cargos) await sincronizarCargo(tx, id);
    const avisos = { tipo: 'pago_rechazado', ref_entidad: 'pago', ref_id: { in: filaIds } };
    await tx.notificacion.updateMany({ where: { ...avisos, estado: { in: ['pendiente', 'error'] } }, data: { estado: 'omitida', error: 'Pago reabierto' } });
    await tx.notificacion.updateMany({ where: avisos, data: { ref_entidad: `reabierto:${ahora.getTime()}` } });
  });

  const principal = filas.find((f) => f.grupo_principal) ?? filas.find((f) => f.id === pago.id) ?? filas[0]!;
  const rechazo = filas.find((f) => f.validado_por_id != null || f.validado_at != null) ?? principal;
  const conformidad = filas.find((f) => f.conformidad_at != null);
  const por = rechazo.validado_por_id != null ? await prisma.usuario.findUnique({ where: { id: rechazo.validado_por_id }, select: { nombre: true } }) : null;
  return {
    id: principal.id,
    grupo: pago.grupo,
    pagos: filas.length,
    monto: filas.reduce((s, f) => s.plus(f.monto), new Prisma.Decimal(0)).toFixed(2),
    cargos,
    rechazo_anterior: {
      motivo: filas.find((f) => f.motivo_rechazo != null)?.motivo_rechazo ?? null,
      por_id: rechazo.validado_por_id,
      por_nombre: por?.nombre ?? null,
      por_ia: rechazo.validado_por_ia,
      at: rechazo.validado_at?.toISOString() ?? null,
      conformidad_por_id: conformidad?.conformidad_por_id ?? null,
      conformidad_at: conformidad?.conformidad_at?.toISOString() ?? null,
    },
  };
}

/**
 * ¿Se puede volver a revisar? Lo que mira `reabrirPago`, sin cambiar nada: la pantalla apaga el botón y dice por qué. `puede: false` trae el mismo texto del 409.
 * (Es una lectura: la última palabra la tiene `reabrirPago`, dentro de su transacción.)
 */
export async function puedeReabrirse(pagoId: number): Promise<{ puede: true; motivo: null } | { puede: false; motivo: string }> {
  try {
    const { filas, cargos } = await cargarReapertura(pagoId);
    await exigirSinOtroPagoVigente(prisma, cargos, filas.map((f) => f.id));
    return { puede: true, motivo: null };
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return { puede: false, motivo: err.message };
    throw err;
  }
}
