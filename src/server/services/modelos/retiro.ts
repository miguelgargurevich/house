// Un modelo `activo` que el proveedor responde como inexistente (404) se retira en el momento, sin esperar al sync.
import { prisma } from '../../db';
import { cooldownDeps } from '../../lib/cooldown';
import { marcarModeloMalo } from '../../lib/modelosMalos';
import type { Eslabon } from '../rotacion';
import { elegirModeloAuto } from './seleccion';

/**
 * Marca el modelo como malo para TODO el proveedor durante 10 min (memoria) y, si la clave tiene catálogo vivo, lo deja `deprecado`
 * (durable: no vuelve a usarse hasta que el sync lo reviva). Si era el fijado en la clave, ésta vuelve a elección automática y lo dice.
 */
export async function retirarModelo(e: Eslabon, modelo: string): Promise<void> {
  marcarModeloMalo(e.proveedor.id, modelo);
  if (e.claveId === null) return;
  const r = await prisma.modeloIA.updateMany({ where: { clave_id: e.claveId, modelo_id: modelo, estado: { not: 'deprecado' } }, data: { estado: 'deprecado', deprecado_at: new Date(cooldownDeps.ahora()) } });
  if (r.count === 0) return;
  let aviso: string | null = null;
  if (e.fijado === modelo) {
    const nuevo = await elegirModeloAuto({ claveId: e.claveId, proveedor: e.proveedor, modelo: null });
    aviso = `El modelo ${modelo} ya no existe; ahora usa ${nuevo}`;
    await prisma.claveIntegracion.updateMany({ where: { id: e.claveId, modelo }, data: { modelo: null, aviso_modelo: aviso } });
  }
  await prisma.syncModelosIA.create({
    data: { clave_id: e.claveId, ok: true, deprecados: 1, detalle: { deprecados: [modelo], origen: 'chat', ...(aviso ? { aviso } : {}) } },
  }).catch(() => undefined);
}
