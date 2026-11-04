/** Cierre de un pago por validar (validado o rechazado), compartido por la validación manual y la automática de la IA. */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict } from '../errors';
import { encolarAviso, pagadoresDe } from './avisos';

/**
 * Deja el cargo según sus pagos: pagado si lo VALIDADO lo cubre, en revisión si hay un pago por validar, pendiente en otro caso.
 * Un pago rechazado o anulado no cuenta (sólo se suman los `validado` y se miran los `por_validar`).
 */
export async function sincronizarCargo(tx: Prisma.TransactionClient, cargoId: number) {
  const cargo = await tx.reciboConceptoUnidad.findUnique({ where: { id: cargoId }, select: { monto: true } });
  if (!cargo) return;
  const { _sum } = await tx.pago.aggregate({ where: { recibo_concepto_unidad_id: cargoId, estado_validacion: 'validado' }, _sum: { monto: true } });
  const pagado = new Prisma.Decimal(_sum.monto ?? 0).gte(cargo.monto);
  const porValidar = !pagado && (await tx.pago.count({ where: { recibo_concepto_unidad_id: cargoId, estado_validacion: 'por_validar' } })) > 0;
  await tx.reciboConceptoUnidad.update({
    where: { id: cargoId },
    data: pagado ? { estado_pago: 'pagado', fecha_pago: new Date() } : { estado_pago: porValidar ? 'en_revision' : 'pendiente', fecha_pago: null },
  });
}

export interface Cierre {
  pagoId: number;
  cargoId: number | null;
  fechaPago: Date;
  estado: 'validado' | 'rechazado';
  motivo?: string;
  /** Quien valida a mano; null cuando valida la IA. */
  validadorId: number | null;
  porIA?: boolean;
  /** Si se indica, sólo cierra mientras el comprobante siga siendo ese archivo (la IA evaluó ESE archivo). */
  comprobanteSha256?: string;
  /** Sólo cierra si el tesorero ya dio su conformidad: la comprobación va en el mismo UPDATE, así que quitarla a la vez no deja pasar el cierre. */
  exigirConformidad?: boolean;
}

export const MENSAJE_FALTA_CONFORMIDAD = 'Falta el check del tesorero del block';

/**
 * Cierre atómico: sólo una revisión de un pago por validar logra pasar (409 si ya se revisó). Si el pago es de un mantenimiento
 * (tiene `grupo`), se cierran TODOS los pagos del grupo y sus cargos en la misma transacción: se valida o se rechaza el mantenimiento entero.
 */
export async function cerrarPago(c: Cierre): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const datos = {
      estado_validacion: c.estado,
      validado_por_id: c.validadorId,
      validado_at: new Date(),
      motivo_rechazo: c.estado === 'rechazado' ? (c.motivo ?? null) : null,
      validado_por_ia: c.porIA === true,
    };
    const r = await tx.pago.updateMany({
      where: {
        id: c.pagoId,
        estado_validacion: 'por_validar',
        ...(c.exigirConformidad ? { conformidad_at: { not: null } } : {}),
        ...(c.comprobanteSha256 ? { comprobante: { sha256: c.comprobanteSha256 } } : {}),
      },
      data: datos,
    });
    if (r.count === 0) {
      // Por validar y sin conformidad: lo que falta es el check, no que alguien ya lo revisara.
      if (c.exigirConformidad && (await tx.pago.count({ where: { id: c.pagoId, estado_validacion: 'por_validar', conformidad_at: null } })) > 0) throw conflict(MENSAJE_FALTA_CONFORMIDAD);
      throw conflict('Este pago ya fue revisado');
    }
    const cargos = new Set<number>(c.cargoId != null ? [c.cargoId] : []);
    const pago = await tx.pago.findUnique({ where: { id: c.pagoId }, select: { grupo: true } });
    if (pago?.grupo) {
      const resto = await tx.pago.findMany({ where: { grupo: pago.grupo, id: { not: c.pagoId }, estado_validacion: 'por_validar' }, select: { id: true, recibo_concepto_unidad_id: true } });
      if (resto.length) {
        await tx.pago.updateMany({ where: { id: { in: resto.map((x) => x.id) }, estado_validacion: 'por_validar' }, data: datos });
        for (const x of resto) if (x.recibo_concepto_unidad_id != null) cargos.add(x.recibo_concepto_unidad_id);
      }
    }
    if (cargos.size === 0) return;
    if (c.estado === 'validado') {
      await tx.reciboConceptoUnidad.updateMany({ where: { id: { in: [...cargos] } }, data: { estado_pago: 'pagado', fecha_pago: c.fechaPago } });
    } else {
      await tx.reciboConceptoUnidad.updateMany({ where: { id: { in: [...cargos] }, estado_pago: 'en_revision' }, data: { estado_pago: 'pendiente', fecha_pago: null } });
    }
  });
}

/**
 * Avisa del resultado. Un pago validado NO avisa: el vecino lo ve en «Mis recibos». Un rechazo o una anulación salen sólo por correo, a quien registró el pago
 * o, si no hay, a quien paga la unidad (su responsable de pago; sin personas cargadas, el inquilino o, si no tiene, el propietario). Es idempotente por pago (lo resuelve `encolarAviso`) y nunca rompe la validación.
 */
export async function avisarResultado(pagoId: number, estado: 'validado' | 'rechazado' | 'anulado', motivo?: string | null): Promise<void> {
  if (estado === 'validado') return;
  try {
    const p = await prisma.pago.findUnique({
      where: { id: pagoId },
      select: { usuario_id: true, reciboConceptoUnidad: { select: { unidad: { select: { id: true, propietario_id: true, inquilino_id: true } } } } },
    });
    if (!p) return;
    const u = p.reciboConceptoUnidad?.unidad;
    const destinatario = p.usuario_id ?? (u ? (await pagadoresDe([u])).get(u.id) ?? null : null);
    if (destinatario == null) return;
    await encolarAviso(estado === 'anulado' ? 'pago_anulado' : 'pago_rechazado', destinatario, { entidad: 'pago', id: pagoId }, { motivo: motivo ?? undefined });
  } catch (err) {
    console.error('[avisos] no se pudo encolar el aviso del pago', pagoId, err instanceof Error ? err.name : 'error');
  }
}
