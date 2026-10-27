// Tareas periódicas del asistente, en proceso y con bloqueo entre réplicas:
//  - sincronización de modelos + recuperación de claves rechazadas: cada 6 h (primera pasada ~60 s tras arrancar), `MODELOS_SYNC`;
//  - canary de salud: cada 30 min, `ASISTENTE_CANARY`;
//  - limpieza de conversaciones de más de 90 días: cada hora, `ASISTENTE_LIMPIEZA`;
//  - barrido de evaluaciones de comprobantes (reintentos vencidos y evaluaciones sin dueño tras un reinicio): cada minuto (primera pasada ~10 s tras
//    arrancar), `EVALUACION_BARRIDO`. Sin bloqueo: cada toma es un UPDATE atómico, así que varias réplicas no duplican trabajo.
import { canaryActivo, CADA_CANARY_MS, PRIMERA_PASADA_CANARY_MS, pasadaDeCanary } from './canary';
import { limpiarConversaciones, limpiezaActiva } from './conversaciones';
import { barrerEvaluaciones } from '../evaluacion';
import { limpiarCanales } from '../canales/entrante';
import { CADA_SYNC_MS, PRIMERA_PASADA_MS, pasadaDeSync, sincronizacionActiva } from '../modelos/sync';

function cada(nombre: string, primeroMs: number, cadaMs: number, tarea: () => Promise<unknown>): () => void {
  let enMarcha = false;
  const correr = async () => {
    if (enMarcha) return; // una pasada lenta no se encima con la siguiente
    enMarcha = true;
    try { await tarea(); } catch (err) { console.error(`[asistente] ${nombre} falló:`, err instanceof Error ? err.message : 'error'); } finally { enMarcha = false; }
  };
  const primero = setTimeout(() => void correr(), primeroMs);
  const t = setInterval(() => void correr(), cadaMs);
  primero.unref();
  t.unref();
  return () => { clearTimeout(primero); clearInterval(t); };
}

export const CADA_BARRIDO_EVALUACIONES_MS = 60_000;
export const PRIMER_BARRIDO_EVALUACIONES_MS = 10_000;

/** `EVALUACION_BARRIDO=on|off`; sin definir, activo (en las pruebas el barrido se invoca a mano). */
export function barridoDeEvaluacionesActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EVALUACION_BARRIDO?.trim().toLowerCase() !== 'off' && env.NODE_ENV !== 'test';
}

/** Arranca las tareas que estén activas. Devuelve `detener`. */
export function iniciarTareasAsistente(env: NodeJS.ProcessEnv = process.env): () => void {
  const detener: (() => void)[] = [];
  if (sincronizacionActiva(env)) {
    detener.push(cada('la sincronización de modelos', PRIMERA_PASADA_MS, CADA_SYNC_MS, pasadaDeSync));
    console.log('[modelos] sincronización activa (cada 6 h)');
  }
  if (canaryActivo(env)) {
    detener.push(cada('el canary de la IA', PRIMERA_PASADA_CANARY_MS, CADA_CANARY_MS, pasadaDeCanary));
    console.log('[asistente] canary de la IA activo (cada 30 min)');
  }
  if (barridoDeEvaluacionesActivo(env)) {
    detener.push(cada('el barrido de evaluaciones', PRIMER_BARRIDO_EVALUACIONES_MS, CADA_BARRIDO_EVALUACIONES_MS, async () => {
      const r = await barrerEvaluaciones();
      if (r.reintentadas || r.abandonadas) console.log(`[evaluacion] barrido: ${r.reintentadas} reintentada(s), ${r.abandonadas} sin dueño retomada(s) o cerrada(s)`);
    }));
    console.log('[evaluacion] barrido de reintentos activo (cada minuto)');
  }
  // Misma cadencia: conversaciones de más de 90 días, y del bot de WhatsApp los mensajes de más de 7 días (idempotencia) y los vouchers pendientes vencidos.
  if (limpiezaActiva(env)) detener.push(cada('la limpieza de conversaciones', 5 * 60_000, 3_600_000, async () => { await limpiarConversaciones(); await limpiarCanales(); }));
  return () => detener.forEach((d) => d());
}
