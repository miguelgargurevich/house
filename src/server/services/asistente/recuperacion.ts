// Claves «rechazadas» que se recuperan solas: un 402 (sin saldo) o un 401 transitorio dejaban la clave fuera para siempre hasta que alguien
// la probara a mano. Cada 6 h (y en la pasada del sync) se vuelve a probar con una consulta mínima y, si ya responde, se rehabilita.
// Respeta un tope para no martillar al proveedor: separación mínima entre pruebas y un máximo de reintentos automáticos por clave.
import { prisma } from '../../db';
import { claveCooldown, cooldownDeps, limpiar } from '../../lib/cooldown';
import { ESTADO_RECHAZADA, eslabonDeFila } from '../rotacion';
import { pruebaDeChat } from './prueba';
import { actualizarSalud, olvidarCausa } from './salud';

/** Separación mínima entre dos pruebas automáticas de la misma clave. */
export const ESPERA_RECUPERACION_MS = 5 * 3_600_000;
/** Reintentos automáticos seguidos por clave (se reinicia al rehabilitarla o reemplazarla). Pasado el tope sólo la rehabilita una prueba manual. */
export const MAX_REINTENTOS_AUTOMATICOS = 8;

const reintentos = new Map<number, number>();
export const olvidarReintentos = () => reintentos.clear();
export const reintentosDe = (claveId: number) => reintentos.get(claveId) ?? 0;

export async function recuperarRechazadas(): Promise<{ revisadas: number; rehabilitadas: number }> {
  const ahora = cooldownDeps.ahora();
  const filas = await prisma.claveIntegracion.findMany({ where: { habilitada: true, estado: ESTADO_RECHAZADA }, orderBy: { id: 'asc' } });
  let revisadas = 0;
  let rehabilitadas = 0;
  for (const f of filas) {
    if (f.probada_at && ahora - f.probada_at.getTime() < ESPERA_RECUPERACION_MS) continue;
    if ((reintentos.get(f.id) ?? 0) >= MAX_REINTENTOS_AUTOMATICOS) continue;
    const e = eslabonDeFila(f);
    if (!e) continue;
    reintentos.set(f.id, (reintentos.get(f.id) ?? 0) + 1);
    revisadas++;
    const p = await pruebaDeChat(e);
    if (p.tipo === 'ok') {
      await prisma.claveIntegracion.update({ where: { id: f.id }, data: { estado: 'ok', estado_detalle: null, probada_at: new Date(ahora) }, select: { id: true } });
      limpiar(claveCooldown(f.proveedor, f.id));
      olvidarCausa(claveCooldown(f.proveedor, f.id));
      reintentos.delete(f.id);
      rehabilitadas++;
      console.warn(`[llavero] clave ${f.proveedor}#${f.id} rehabilitada: ya responde`);
    } else {
      // Sigue rechazada; se anota la hora del intento para respetar la separación.
      await prisma.claveIntegracion.update({ where: { id: f.id }, data: { probada_at: new Date(ahora), ...(p.tipo === 'rechazada' || p.tipo === 'sin_saldo' ? { estado_detalle: p.detalle } : {}) }, select: { id: true } });
    }
  }
  if (rehabilitadas > 0) await actualizarSalud();
  return { revisadas, rehabilitadas };
}
