// La «lectura de IA» de la demo: una respuesta de ejemplo en lugar de llamar al OCR o a un modelo de pago. Sale de los datos del propio pago (monto del
// recibo, medio de pago del condominio, fecha de hoy), así que el contraste real la encuentra coherente con el recibo; de cada 6 vouchers, uno trae un
// monto distinto para que se vea también el caso «no coincide». Determinista: depende de la referencia del pago (no de su id, que en la siembra en
// paralelo no sale siempre en el mismo orden).
import { prisma } from '../../db';
import { hoyEn } from '../../lib/fechas';
import type { Lectura } from '../../lib/lecturaComprobante';
import type { PagoEvaluado } from '../evaluacion';

/** Cada cuántos vouchers de ejemplo trae un monto que no calza (para mostrar la alerta de la IA). */
export const CADA_CUANTOS_NO_CALZA = 6;

export async function lecturaDeEjemplo(pago: PagoEvaluado, moneda: string, zona: string): Promise<Lectura> {
  const unidad = pago.reciboConceptoUnidad?.unidad;
  const total = pago.grupo != null ? (await prisma.pago.aggregate({ where: { grupo: pago.grupo }, _sum: { monto: true } }))._sum.monto : null;
  const esperado = Number((total ?? pago.monto).toString());
  const medios = unidad?.complejo_id != null
    ? await prisma.medioPago.findMany({
        where: { activo: true, complejo_id: unidad.complejo_id, OR: [{ estructura_id: null }, ...(unidad.estructura_id != null ? [{ estructura_id: unidad.estructura_id }] : [])] },
        select: { tipo: true, titular: true, celular: true, numero_cuenta: true },
        orderBy: [{ estructura_id: { sort: 'desc', nulls: 'last' } }, { orden: 'asc' }, { id: 'asc' }],
      })
    : [];
  const destino = medios[0] ?? null;
  const metodo = pago.metodo_pago ?? '';
  const medio: Lectura['medio'] = metodo === 'yape' ? 'yape' : metodo === 'plin' ? 'plin' : metodo === 'deposito' ? 'deposito' : 'transferencia';
  const clave = Number((pago.referencia ?? '').replace(/\D/g, '')) || pago.id;
  const noCalza = clave % CADA_CUANTOS_NO_CALZA === 0;
  return {
    es_comprobante_de_pago: true,
    legible: true,
    medio,
    estado_operacion: 'exitosa',
    monto: noCalza ? Math.max(1, Math.round(esperado - 10)) : esperado,
    moneda: moneda === 'USD' ? 'USD' : 'PEN',
    fecha: hoyEn(zona, new Date()).toISOString().slice(0, 10),
    numero_operacion: `DEMO${String(clave).padStart(6, '0')}`,
    destinatario_nombre: destino?.titular ?? null,
    destino_numero: (destino?.celular ?? destino?.numero_cuenta ?? '').replace(/\D/g, '').slice(-4) || null,
    mensaje: 'Pago de mantenimiento',
  };
}
