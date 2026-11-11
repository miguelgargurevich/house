// Reinicio de la demo: la base vuelve al estado inicial (el seed) cada noche a las 3:00 de Lima y a pedido del superadmin de la instancia.
// El candado de reinicio vive en la base (`ConfiguracionDemo.reiniciando_desde`), así dos procesos no siembran a la vez; uno que lleva más de 15 minutos se da por caído.
import { prisma } from '../../db';
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { horaEn, medianocheEn } from '../../lib/fechas';
import { modoDemo } from './estado';
import { sembrarDemo, type ResumenDemo } from './sembrar';

export const HORA_REINICIO_LIMA = 3;
const MAX_REINICIO_MS = 15 * 60_000;

/** El instante de las 3:00 de Lima del día de `ahora`: la demo debe haberse sembrado después de él. */
export function reinicioDeHoy(ahora: Date): Date {
  const h = horaEn(ZONA_POR_DEFECTO, ahora);
  return new Date(medianocheEn(ZONA_POR_DEFECTO, h.getUTCFullYear(), h.getUTCMonth() + 1, h.getUTCDate()).getTime() + HORA_REINICIO_LIMA * 3_600_000);
}

/** ¿Toca reiniciar? Ya pasaron las 3:00 de hoy (Lima) y la última siembra fue antes (o nunca). Sin límite superior: tras una caída se pone al día. */
export function tocaReiniciar(ahora: Date, sembradaAt: Date | null): boolean {
  const limite = reinicioDeHoy(ahora);
  return ahora >= limite && (sembradaAt == null || sembradaAt < limite);
}

export type ResultadoReinicio = { estado: 'hecho'; resumen: ResumenDemo } | { estado: 'en_curso' } | { estado: 'no_es_demo' };

/** Reinicia la demo (sólo con el modo demo encendido). Si ya hay un reinicio en marcha no hace nada. Un fallo libera el candado y se propaga. */
export async function reiniciarDemo(log: (m: string) => void = () => undefined): Promise<ResultadoReinicio> {
  if (!(await modoDemo())) return { estado: 'no_es_demo' };
  const ahora = new Date();
  const tomado = await prisma.configuracionDemo.updateMany({
    where: { id: 1, OR: [{ reiniciando_desde: null }, { reiniciando_desde: { lt: new Date(ahora.getTime() - MAX_REINICIO_MS) } }] },
    data: { reiniciando_desde: ahora },
  });
  if (tomado.count === 0) return { estado: 'en_curso' };
  try {
    return { estado: 'hecho', resumen: await sembrarDemo({ log }) };
  } finally {
    await prisma.configuracionDemo.updateMany({ where: { id: 1 }, data: { reiniciando_desde: null } }).catch(() => undefined);
  }
}

/** Vigila cada minuto si toca el reinicio nocturno. Sólo hace algo con el modo demo encendido; en producción es un cheque barato y silencioso. */
export function iniciarReinicioNocturno(log: (m: string) => void = (m) => console.log(m)) {
  const t = setInterval(() => {
    void (async () => {
      if (!(await modoDemo())) return;
      const fila = await prisma.configuracionDemo.findUnique({ where: { id: 1 }, select: { sembrada_at: true } });
      if (!tocaReiniciar(new Date(), fila?.sembrada_at ?? null)) return;
      log('[demo] reinicio nocturno: sembrando la demo de nuevo…');
      const r = await reiniciarDemo();
      if (r.estado === 'hecho') log(`[demo] reinicio listo en ${r.resumen.segundos} s`);
    })().catch((e) => console.error('[demo] el reinicio falló:', e instanceof Error ? e.message : 'error'));
  }, 60_000);
  t.unref();
  return t;
}
