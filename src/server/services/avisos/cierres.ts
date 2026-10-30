// Recordatorio al tesorero del block: «tu cierre del mes tiene pagos sin registrar». Sale desde el día 5 (en la zona del condominio) del mes siguiente,
// una sola vez por mes y block (la fila de `Notificacion` es única por usuario, canal, tipo y referencia: `cierre:<año>-<mes>` + id del block).
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { prisma } from '../../db';
import { hoyEn } from '../../lib/fechas';
import { calcularBlocks, mesDeBlock } from '../cierres/calculo';
import { encolarAviso } from './cola';

export const DIA_CIERRE = 5;

export const refCierre = (anio: number, mes: number) => `cierre:${anio}-${String(mes).padStart(2, '0')}` as const;

/** Mes anterior al de `hoy` (00:00 UTC). */
function mesAnterior(hoy: Date): { anio: number; mes: number } {
  const p = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
  return { anio: p.getUTCFullYear(), mes: p.getUTCMonth() + 1 };
}

/**
 * Encola el aviso `cierre_pendiente` a cada tesorero de block cuyo cierre del MES ANTERIOR aún tiene líneas sin pago registrado, desde el día 5 del mes.
 * Sólo mira el mes anterior (no despierta cierres viejos). Repetir la llamada no duplica nada. Devuelve cuántas notificaciones creó.
 */
export async function encolarCierresPendientes(ahora: Date): Promise<number> {
  const complejos = await prisma.complejoHabitacional.findMany({ where: { recibos: { some: { estructura_id: { not: null } } } }, select: { id: true, zona_horaria: true } });
  let creadas = 0;
  for (const c of complejos) {
    const hoy = hoyEn(c.zona_horaria ?? ZONA_POR_DEFECTO, ahora);
    if (hoy.getUTCDate() < DIA_CIERRE) continue;
    const { anio, mes } = mesAnterior(hoy);
    const blocks = await prisma.estructura.findMany({ where: { complejo_id: c.id, recibos: { some: { anio, mes } } }, select: { id: true } });
    if (!blocks.length) continue;
    const calculo = await calcularBlocks(blocks.map((b) => b.id));
    for (const b of blocks) {
      const cierre = mesDeBlock(calculo.get(b.id)!, b.id, c.id, anio, mes);
      if (!cierre.lineas.some((l) => !l.obsoleta && !l.registro)) continue;
      const tesoreros = await prisma.usuario.findMany({ where: { rol: 'propietario', cargo_junta: 'tesorero', complejo_id: c.id, estructura_id: b.id }, select: { id: true } });
      for (const t of tesoreros) creadas += await encolarAviso('cierre_pendiente', t.id, { entidad: refCierre(anio, mes), id: b.id }, { ahora });
    }
  }
  return creadas;
}
