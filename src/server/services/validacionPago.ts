/** Cierre de un pago por validar (validado o rechazado), compartido por la validación manual y la automática de la IA. */
import { prisma } from '../db';
import { conflict } from '../errors';
import { encolarAviso } from './avisos';

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
}

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
      where: { id: c.pagoId, estado_validacion: 'por_validar', ...(c.comprobanteSha256 ? { comprobante: { sha256: c.comprobanteSha256 } } : {}) },
      data: datos,
    });
    if (r.count === 0) throw conflict('Este pago ya fue revisado');
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
 * Avisa del resultado a quien registró el pago y al propietario/inquilino de la unidad (sin repetir personas),
 * respetando sus preferencias (lo resuelve `encolarAviso`). Es idempotente por pago y nunca rompe la validación.
 */
export async function avisarResultado(pagoId: number, estado: 'validado' | 'rechazado', motivo?: string | null): Promise<void> {
  try {
    const p = await prisma.pago.findUnique({
      where: { id: pagoId },
      select: { usuario_id: true, reciboConceptoUnidad: { select: { unidad: { select: { propietario_id: true, inquilino_id: true } } } } },
    });
    if (!p) return;
    const u = p.reciboConceptoUnidad?.unidad;
    const destinatarios = new Set<number>();
    for (const id of [p.usuario_id, u?.propietario_id, u?.inquilino_id]) if (id != null) destinatarios.add(id);
    const tipo = estado === 'validado' ? 'pago_validado' : 'pago_rechazado';
    for (const id of destinatarios) await encolarAviso(tipo, id, { entidad: 'pago', id: pagoId }, { motivo: motivo ?? undefined });
  } catch (err) {
    console.error('[avisos] no se pudo encolar el aviso del pago', pagoId, err instanceof Error ? err.name : 'error');
  }
}
