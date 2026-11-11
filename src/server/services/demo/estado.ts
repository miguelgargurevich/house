// Modo demostración: UN solo interruptor, en la base (`ConfiguracionDemo`, fila id = 1). Todo lo que sale hacia fuera (correo, WhatsApp, IA) y lo que
// cambia una cuenta de demo pregunta aquí. Sin variables de entorno nuevas.
//
// Seguridad de la lectura:
//  - Una base que no tiene la tabla (o sin fila) lee «apagado»: producción se comporta como siempre.
//  - Si la lectura FALLA (la base parpadea) se conserva la última respuesta conocida: una instancia de demo nunca «se apaga» por un error pasajero.
import { prisma } from '../../db';

/** Puntos de inyección para pruebas: reloj y duración de la caché (0 = sin caché). */
export const demoDeps = { ahora: (): number => Date.now(), ttlMs: 5_000 };

let cache: { valor: boolean; hasta: number } | null = null;
let ultimoValor = false;
let avisado = false;

/** Olvida la respuesta guardada (tras encender o apagar el modo, o al reiniciar la demo). */
export function invalidarDemo(): void {
  cache = null;
}

export async function modoDemo(): Promise<boolean> {
  const t = demoDeps.ahora();
  if (cache && cache.hasta > t) return cache.valor;
  let valor: boolean;
  try {
    const fila = await prisma.configuracionDemo.findUnique({ where: { id: 1 }, select: { activo: true } });
    valor = fila?.activo === true;
    ultimoValor = valor;
  } catch (e) {
    // Tabla ausente (base sin el esquema nuevo) o base caída: se queda con lo último que se supo (apagado si nunca se leyó).
    if (!avisado) {
      avisado = true;
      console.warn('[demo] no se pudo leer el modo de demostración; se usa el último valor conocido:', e instanceof Error ? e.name : 'error');
    }
    valor = ultimoValor;
  }
  cache = { valor, hasta: t + demoDeps.ttlMs };
  return valor;
}

/** Enciende o apaga el modo de demostración (lo usan el seed de la demo y las pruebas). */
export async function fijarModoDemo(activo: boolean): Promise<void> {
  await prisma.configuracionDemo.upsert({ where: { id: 1 }, create: { id: 1, activo }, update: { activo } });
  ultimoValor = activo;
  invalidarDemo();
}

/** El único mensaje de las negativas del candado: corto, en español y sin detalles internos. */
export const MENSAJE_DEMO = 'No está disponible en la demo: los datos son de ejemplo. Crea tu cuenta gratis para usarlo con tu condominio.';
export const CODIGO_DEMO = 'DEMO';
