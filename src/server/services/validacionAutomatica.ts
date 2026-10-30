/**
 * Validación automática «IA + tesorero». El pago se valida solo cuando se cumplen las dos cosas:
 *  (a) la IA (o el OCR, sólo si decidió SOLO: `MODELO_OCR_SOLO`) leyó el voucher y coincide (veredicto `coincide`, confianza ≥ umbral, sin duplicados,
 *      fecha creíble) y el condominio tiene encendido `validacion_automatica_ia`;
 *  (b) el tesorero del block dio su conformidad («el dinero llegó a la cuenta»), salvo que nadie pueda darla (`ExencionConformidad`: el block no
 *      tiene tesorero, o el pago lo registró el propio tesorero): ahí basta (a), como antes.
 * Se dispara desde el que llegue SEGUNDO: al terminar la evaluación y al dar la conformidad. Es idempotente: sólo cierra un pago `por_validar`.
 */
import { prisma } from '../db';
import { HttpError } from '../errors';
import { exencionDelPago, type ExencionConformidad } from '../lib/conformidad';
import { registrarAuditoria } from '../middleware/audit';
import { moduloActivo } from './comercial/modulos';
import { MODELO_OCR_SOLO } from './ocrVoucher';
import { avisarResultado, cerrarPago } from './validacionPago';

/** Confianza mínima de la IA para validar sola. */
export const UMBRAL_AUTOVALIDACION = 0.9;

export interface OpcionesAutovalidacion {
  /** La fecha leída del voucher se descartó por futura o muy antigua (lo sabe quien acaba de decidirla; si no, se mira `fecha_origen`). */
  fechaInvalida?: boolean;
}

/** Valida el pago si se cumplen (a) y (b). Devuelve `true` sólo si ESTA llamada lo validó. Nunca rechaza ni lanza por «ya revisado». */
export async function validarSiCumple(pagoId: number, opciones: OpcionesAutovalidacion = {}): Promise<boolean> {
  const pago = await prisma.pago.findUnique({
    where: { id: pagoId },
    select: {
      id: true,
      estado_validacion: true,
      conformidad_at: true,
      conformidad_por_id: true,
      fecha_pago: true,
      fecha_origen: true,
      recibo_concepto_unidad_id: true,
      comprobante: { select: { sha256: true, created_at: true } },
      evaluacion: { select: { estado: true, proveedor: true, modelo: true, veredicto: true, confianza: true, updated_at: true } },
      reciboConceptoUnidad: { select: { unidad: { select: { complejo_id: true, complejo: { select: { validacion_automatica_ia: true } } } } } },
    },
  });
  if (!pago || pago.estado_validacion !== 'por_validar') return false;
  const { comprobante, evaluacion: ev } = pago;
  const unidad = pago.reciboConceptoUnidad?.unidad;
  if (!comprobante || !ev || !unidad || unidad.complejo?.validacion_automatica_ia !== true) return false;

  // (a) La evaluación es de ESTE archivo (terminó después de subirlo) y coincide. Un OCR que sólo fue la última red (la IA no leyó) informa y nada más;
  // el que decidió solo (todo calzó, sin alertas) lleva `MODELO_OCR_SOLO`.
  if (ev.estado !== 'completada' || (ev.proveedor === 'ocr' && ev.modelo !== MODELO_OCR_SOLO) || ev.veredicto !== 'coincide') return false;
  if (ev.confianza == null || ev.confianza < UMBRAL_AUTOVALIDACION) return false;
  if (ev.updated_at.getTime() < comprobante.created_at.getTime()) return false; // la evaluación es anterior al archivo vigente (lo reemplazaron y falta releerlo)
  if (opciones.fechaInvalida === true || pago.fecha_origen === 'invalida') return false;
  if (!(await moduloActivo(unidad.complejo_id, 'ia_vouchers'))) return false;

  // (b) El check del tesorero, o nadie que pueda darlo.
  const exencion = pago.conformidad_at ? null : await exencionDelPago(pago.id);
  if (!pago.conformidad_at && exencion === null) return false;

  try {
    await cerrarPago({
      pagoId: pago.id,
      cargoId: pago.recibo_concepto_unidad_id,
      fechaPago: pago.fecha_pago,
      estado: 'validado',
      validadorId: null,
      porIA: true,
      comprobanteSha256: comprobante.sha256,
      exigirConformidad: exencion === null,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return false; // ya lo revisó una persona, cambió el comprobante o quitaron la conformidad
    throw err;
  }
  await registrarAuditoria({
    usuario_id: null,
    accion: 'validar',
    entidad: 'pago',
    entidad_id: pago.id,
    detalle: { por: 'ia', veredicto: ev.veredicto, confianza: ev.confianza, ...detalleConformidad(exencion, pago.conformidad_por_id) },
  });
  await avisarResultado(pago.id, 'validado');
  return true;
}

/** Con quién se validó: `tesorero` (id de quien dio la conformidad) o la razón por la que no hacía falta. */
function detalleConformidad(exencion: ExencionConformidad | null, tesoreroId: number | null): { tesorero: number } | { sin_conformidad: ExencionConformidad } | Record<string, never> {
  if (exencion) return { sin_conformidad: exencion };
  return tesoreroId != null ? { tesorero: tesoreroId } : {};
}
