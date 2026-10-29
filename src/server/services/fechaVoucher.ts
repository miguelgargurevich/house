/**
 * La fecha de un pago es la fecha DEL VOUCHER, no la que declara quien lo registra. Cuando la IA lee el comprobante (`evaluacion.ts`) esta
 * pieza decide si esa fecha se puede usar y, si sí, la aplica a todo el grupo del mantenimiento. Las decisiones salen de código
 * (`decidirFecha`, pura): lo que dice el modelo es un dato no confiable y nunca se aplica sin pasar por aquí.
 *
 * `Pago.fecha_origen` deja a la vista de quien valida de dónde salió la fecha:
 *  - `declarada`: la que puso quien registró el pago (aún sin evaluar, o sin voucher).
 *  - `voucher`: leída del comprobante y aplicada.
 *  - `no_leida`: la IA no pudo leerla (o no hubo IA), o la evaluación no la respalda (el comprobante no coincide con el pago o su mensaje nombra otro mes); queda la declarada.
 *  - `invalida`: la IA leyó una fecha futura o anterior a la emisión del recibo − 60 días; NO se aplica, queda la declarada y el pago a revisión.
 *  - `manual`: la corrigió una persona; ninguna evaluación posterior la pisa.
 */
import { prisma } from '../db';
import { ZONA_POR_DEFECTO } from '../../lib/paises';
import { diaEn, hoyEn, medianocheEn } from '../lib/fechas';
import type { Lectura } from '../lib/lecturaComprobante';
import { registrarAuditoria } from '../middleware/audit';
import { alertaDePeriodo, type Veredicto } from './contraste';

const DIA = 86_400_000;
/** Una fecha leída anterior a la emisión del recibo por más de estos días no es creíble: se deja para revisar. */
export const DIAS_ANTES_EMISION_VOUCHER = 60;
export const ORIGENES_FECHA = ['declarada', 'voucher', 'no_leida', 'invalida', 'manual'] as const;
export type OrigenFecha = (typeof ORIGENES_FECHA)[number];

export type DecisionFecha =
  | { tipo: 'aplicar'; fecha: Date; dia: string }
  | { tipo: 'no_leida'; motivo: string }
  | { tipo: 'invalida'; motivo: string; dia: string };

/** El día calendario (00:00 UTC) de una fecha SIN hora, como se guardan emisión y vencimiento: `hoyEn` la correría un día atrás en una zona al oeste de UTC (00:00 UTC son las 19:00 del día anterior en Lima). */
export const diaCalendario = (f: Date): Date => new Date(Math.floor(f.getTime() / DIA) * DIA);

/** «2026-10-31» de un instante, según el día en la zona del condominio. */
export const diaEnZona = (f: Date, zona: string = ZONA_POR_DEFECTO): string => diaEn(f, zona);

/**
 * Cómo se guarda el día leído del voucher: al mediodía UTC, que es la mañana en América y la tarde en Europa, así que cualquier zona
 * razonable muestra el mismo día calendario. Una zona tan al este (Nueva Zelanda) que ese instante ya es otro día lo guarda al mediodía local.
 */
const mediodiaDe = (dia: string, zona: string): Date => {
  const t = Date.parse(`${dia}T12:00:00Z`);
  if (diaEn(new Date(t), zona) === dia) return new Date(t);
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(medianocheEn(zona, a, m, d).getTime() + DIA / 2);
};

/**
 * ¿Se puede usar la fecha que leyó la IA? Exige un comprobante de pago legible cuya operación no esté pendiente ni fallida (la fecha de una operación
 * que no se completó no es la del pago). Futura (después de HOY en la zona del condominio) o anterior a `emision − 60 días` → `invalida`.
 * Se guarda al mediodía UTC (07:00 en Lima) del día leído: así cualquier zona horaria razonable muestra el mismo día calendario.
 */
export function decidirFecha(lectura: Pick<Lectura, 'fecha' | 'es_comprobante_de_pago' | 'legible' | 'estado_operacion'>, o: { hoy: Date; emision: Date; zona?: string }): DecisionFecha {
  const zona = o.zona ?? ZONA_POR_DEFECTO;
  // `emision` es el día calendario de emisión del recibo (fecha sin hora).
  if (!lectura.es_comprobante_de_pago) return { tipo: 'no_leida', motivo: 'La imagen no parece un comprobante de pago' };
  if (!lectura.legible) return { tipo: 'no_leida', motivo: 'El comprobante no se lee con claridad' };
  if (lectura.estado_operacion === 'pendiente' || lectura.estado_operacion === 'fallida') return { tipo: 'no_leida', motivo: 'La operación del comprobante no figura como exitosa' };
  if (!lectura.fecha) return { tipo: 'no_leida', motivo: 'No se encontró la fecha en el comprobante' };
  const t = Date.parse(`${lectura.fecha}T00:00:00Z`);
  if (t > hoyEn(zona, o.hoy).getTime()) return { tipo: 'invalida', motivo: 'La fecha del comprobante es futura', dia: lectura.fecha };
  if (t < diaCalendario(o.emision).getTime() - DIAS_ANTES_EMISION_VOUCHER * DIA) return { tipo: 'invalida', motivo: `La fecha del comprobante es anterior a la emisión del recibo por más de ${DIAS_ANTES_EMISION_VOUCHER} días`, dia: lectura.fecha };
  return { tipo: 'aplicar', fecha: mediodiaDe(lectura.fecha, zona), dia: lectura.fecha };
}

export const MOTIVO_NO_COINCIDE = 'El comprobante no coincide con el pago: la fecha no se aplica';
export const MOTIVO_OTRO_PERIODO = 'El mensaje del comprobante nombra otro mes que el del recibo: la fecha no se aplica';

/**
 * La fecha del voucher sólo vale si la evaluación respalda ese comprobante como el pago de ESTE recibo: con veredicto `no_coincide` (monto, destino, duplicado
 * u operación fallida) o con el mensaje nombrando otro mes, el comprobante es de otro pago y su fecha no se aplica (queda la declarada). El resto, como `decidirFecha`.
 * `ilegible` ya sale `no_leida` de `decidirFecha` (no es comprobante o no se lee).
 */
export function decidirFechaEvaluada(
  lectura: Pick<Lectura, 'fecha' | 'es_comprobante_de_pago' | 'legible' | 'estado_operacion' | 'mensaje'>,
  o: { hoy: Date; emision: Date; zona?: string; veredicto: Veredicto; periodo: { mes: number; anio: number } | null },
): DecisionFecha {
  if (o.veredicto === 'no_coincide') return { tipo: 'no_leida', motivo: MOTIVO_NO_COINCIDE };
  const base = decidirFecha(lectura, o);
  if (base.tipo === 'aplicar' && alertaDePeriodo(lectura.mensaje, o.periodo, 'comprobante')) return { tipo: 'no_leida', motivo: MOTIVO_OTRO_PERIODO };
  return base;
}

/**
 * Aplica la decisión a TODO el grupo del mantenimiento (o al pago suelto): `fecha_pago`, `fecha_origen` y, si el mantenimiento ya estaba
 * validado, la fecha de pago de sus cargos. La fecha declarada se guarda en `fecha_declarada` la primera vez, para restaurarla si un voucher
 * posterior no se puede leer. Devuelve la `fecha_pago` que quedó (la que debe usar una validación automática) o `null` si no hay pago.
 */
export async function aplicarFechaDelVoucher(pagoId: number, decision: DecisionFecha): Promise<{ fecha_pago: Date; origen: OrigenFecha } | null> {
  const pago = await prisma.pago.findUnique({ where: { id: pagoId }, select: { id: true, grupo: true, fecha_pago: true, fecha_declarada: true, fecha_origen: true, reciboConceptoUnidad: { select: { reciboConcepto: { select: { recibo: { select: { complejo: { select: { zona_horaria: true } } } } } } } } } });
  if (!pago) return null;
  const zona = pago.reciboConceptoUnidad?.reciboConcepto?.recibo?.complejo?.zona_horaria ?? ZONA_POR_DEFECTO;
  if (pago.fecha_origen === 'manual') return { fecha_pago: pago.fecha_pago, origen: 'manual' };
  const declarada = pago.fecha_declarada ?? pago.fecha_pago;
  const origen: OrigenFecha = decision.tipo === 'aplicar' ? 'voucher' : decision.tipo;
  const nueva = decision.tipo === 'aplicar' ? decision.fecha : declarada;
  const grupo = await prisma.pago.findMany({ where: pago.grupo != null ? { grupo: pago.grupo } : { id: pago.id }, select: { id: true, recibo_concepto_unidad_id: true } });
  const ids = grupo.map((p) => p.id);
  const cargos = grupo.map((p) => p.recibo_concepto_unidad_id).filter((c): c is number => c != null);
  await prisma.$transaction([
    prisma.pago.updateMany({ where: { id: { in: ids } }, data: { fecha_pago: nueva, fecha_origen: origen, fecha_declarada: decision.tipo === 'aplicar' ? declarada : null } }),
    // Un mantenimiento ya validado guarda la fecha de pago en sus cargos: se mantiene al día con la del voucher.
    prisma.reciboConceptoUnidad.updateMany({ where: { id: { in: cargos }, estado_pago: 'pagado' }, data: { fecha_pago: nueva } }),
  ]);
  if (nueva.getTime() !== pago.fecha_pago.getTime() || origen !== pago.fecha_origen) {
    await registrarAuditoria({
      usuario_id: null,
      accion: 'fecha_pago_voucher',
      entidad: 'pago',
      entidad_id: pagoId,
      detalle: { origen, anterior: diaEnZona(pago.fecha_pago, zona), nueva: diaEnZona(nueva, zona), ...(decision.tipo === 'aplicar' ? {} : { motivo: decision.motivo, ...(decision.tipo === 'invalida' ? { leida: decision.dia } : {}) }) },
    });
  }
  return { fecha_pago: nueva, origen };
}
