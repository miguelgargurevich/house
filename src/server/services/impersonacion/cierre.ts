// Cierre de las `Impersonacion`: al salir, o cuando la sesión prestada se acaba sola (vence, se revoca, se limpia).
import { prisma } from '../../db';
import { registrarAuditoria } from '../../middleware/audit';

export type FinMotivo = 'salir' | 'vencio' | 'revocada';

/** Cierra una impersonación abierta (una sola vez) y deja el `impersonar_fin` en la auditoría con el superadmin como actor. */
export async function cerrarImpersonacion(id: string, motivo: FinMotivo, finAt: Date, ip: string | null = null): Promise<boolean> {
  const fila = await prisma.impersonacion.findUnique({ where: { id } });
  if (!fila) return false;
  const r = await prisma.impersonacion.updateMany({ where: { id, fin_at: null }, data: { fin_at: finAt, fin_motivo: motivo } });
  if (r.count === 0) return false; // ya estaba cerrada: nada que auditar dos veces
  await registrarAuditoria({
    usuario_id: fila.superadmin_id,
    accion: 'impersonar_fin',
    entidad: 'impersonacion',
    detalle: { impersonacion_id: id, usuario_id: fila.usuario_id, motivo: fila.motivo, fin_motivo: motivo },
    ip,
    impersonador_id: null,
    impersonacion_id: null,
  });
  return true;
}

/**
 * Cierra las impersonaciones abiertas cuya sesión prestada ya no sirve (revocada, vencida, inactiva o borrada). Cierra el hueco del
 * Portal de Dealers: si la sesión vence sola, el fin igual queda registrado, con la hora en que realmente se acabó.
 * `inactividadMs` es la ventana de inactividad de las sesiones (se recibe para no depender de `sesiones.ts`).
 */
export async function cerrarTerminadas(ahora: Date, inactividadMs: number): Promise<number> {
  const abiertas = await prisma.impersonacion.findMany({ where: { fin_at: null } });
  if (abiertas.length === 0) return 0;
  const ids = abiertas.map((i) => i.sesion_prestada_id).filter((x): x is string => !!x);
  const sesiones = new Map((await prisma.sesion.findMany({ where: { id: { in: ids } } })).map((s) => [s.id, s]));
  let cerradas = 0;
  for (const imp of abiertas) {
    const s = imp.sesion_prestada_id ? sesiones.get(imp.sesion_prestada_id) : undefined;
    let fin: { motivo: FinMotivo; at: Date } | null = null;
    if (!s) fin = imp.expira_at <= ahora ? { motivo: 'vencio', at: imp.expira_at } : { motivo: 'revocada', at: ahora }; // fila borrada antes de tiempo
    else if (s.revocada_at) fin = { motivo: 'revocada', at: s.revocada_at };
    else if (s.expira_at <= ahora) fin = { motivo: 'vencio', at: s.expira_at };
    else if (s.ultimo_uso_at.getTime() + inactividadMs <= ahora.getTime()) fin = { motivo: 'vencio', at: new Date(s.ultimo_uso_at.getTime() + inactividadMs) };
    if (fin && (await cerrarImpersonacion(imp.id, fin.motivo, fin.at))) cerradas++;
  }
  return cerradas;
}
