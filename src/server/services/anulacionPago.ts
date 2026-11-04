// Anular un pago ya VALIDADO (el recibo vuelve a quedar por pagar). No se borra nada: el pago queda en la base con `estado_validacion = 'anulado'`,
// quién lo anuló, cuándo y por qué, y deja de contar en todo (ver `lib/pagoVigente.ts`). Un pago de mantenimiento son N filas con el mismo `grupo`: se anulan todas.
//
// Cierre del mes: lo que la junta registró como pagado en el cierre de un block (`EgresoBlock`) se calculó con lo cobrado. Si el mes del recibo ya tiene
// TODAS sus líneas registradas, anular cambiaría el sobrante y el fondo de ahorros ya cerrados: se pide reabrir primero (quitar el registro de las líneas
// en Junta › Cierre del mes, que sí tiene esa salida: `DELETE /api/cierres/lineas/:id`).
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict } from '../errors';
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
async function exigirMesAbierto(cargoIds: number[]): Promise<void> {
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
      throw conflict(`El mes ya está cerrado (${periodoTexto(r.mes, r.anio)}, ${bloque}): reábrelo antes de anular. Quita el registro de sus líneas en Junta › Cierre del mes`);
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
