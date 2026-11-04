// De qué empresa es un aviso: la marca del correo es la de la empresa del condominio al que se refiere (no la de quien lo recibe: un vecino con
// departamentos en dos empresas recibe cada aviso con la marca de la empresa que le escribe). Los avisos de la plataforma (estado de la IA) no son de ninguna.
import { prisma } from '../../db';

type Ref = { entidad: string; id: number };

const deCargo = async (cargoId: number): Promise<number | null> => {
  const c = await prisma.reciboConceptoUnidad.findUnique({
    where: { id: cargoId },
    select: { unidad: { select: { empresa_id: true, complejo: { select: { empresa_id: true } } } }, reciboConcepto: { select: { recibo: { select: { empresa_id: true, complejo: { select: { empresa_id: true } } } } } } },
  });
  const recibo = c?.reciboConcepto?.recibo;
  return recibo?.complejo?.empresa_id ?? recibo?.empresa_id ?? c?.unidad?.complejo?.empresa_id ?? c?.unidad?.empresa_id ?? null;
};

/** La empresa de la que habla el aviso, o `null` (plataforma, o el recibo/comunicado ya no existe). */
export async function empresaDeAviso(ref: Ref): Promise<number | null> {
  if (ref.entidad === 'cargo') return deCargo(ref.id);
  if (ref.entidad === 'pago') {
    const p = await prisma.pago.findUnique({ where: { id: ref.id }, select: { recibo_concepto_unidad_id: true } });
    return p?.recibo_concepto_unidad_id != null ? deCargo(p.recibo_concepto_unidad_id) : null;
  }
  if (ref.entidad === 'recibo') {
    const r = await prisma.recibo.findUnique({ where: { id: ref.id }, select: { empresa_id: true, complejo: { select: { empresa_id: true } } } });
    return r?.complejo?.empresa_id ?? r?.empresa_id ?? null;
  }
  if (ref.entidad === 'comunicado') {
    const c = await prisma.comunicado.findUnique({ where: { id: ref.id }, select: { complejo: { select: { empresa_id: true } } } });
    return c?.complejo?.empresa_id ?? null;
  }
  if (ref.entidad.startsWith('cierre-central:')) {
    return (await prisma.complejoHabitacional.findUnique({ where: { id: ref.id }, select: { empresa_id: true } }))?.empresa_id ?? null;
  }
  if (ref.entidad.startsWith('cierre:')) {
    return (await prisma.estructura.findUnique({ where: { id: ref.id }, select: { complejo: { select: { empresa_id: true } } } }))?.complejo?.empresa_id ?? null;
  }
  return null;
}
