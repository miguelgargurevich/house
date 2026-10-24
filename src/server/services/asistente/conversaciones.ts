// Conversaciones del asistente. El historial que ve el modelo lo arma el SERVIDOR desde la base (el cliente sólo manda el mensaje
// nuevo) y el contenido sólo lo lee su dueño: ni el superadmin. Retención: 90 días.
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { cooldownDeps } from '../../lib/cooldown';
import { isProduction } from '../../config';
import type { MensajeTurno } from './proveedor';

export const HISTORIAL_MENSAJES = 20; // 10 turnos (pregunta + respuesta)
export const HISTORIAL_CARACTERES = 6000;
export const MAX_CONVERSACIONES_LISTA = 20;
export const RETENCION_DIAS = 90;
const sinConversacion = () => new HttpError(404, 'Conversación no encontrada');
const TITULO_MAX = 60;
const TITULO_PALABRAS = 8;

/** Primeras palabras del primer mensaje. */
export function tituloDe(mensaje: string): string {
  const palabras = mensaje.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  let t = palabras.slice(0, TITULO_PALABRAS).join(' ');
  if (t.length > TITULO_MAX) t = `${t.slice(0, TITULO_MAX - 1).trimEnd()}…`;
  else if (palabras.length > TITULO_PALABRAS) t += '…';
  return t || 'Conversación';
}

/** La conversación del usuario o una nueva. Una ajena responde 404 (no se revela que existe). */
export async function obtenerOCrear(usuarioId: number, conversacionId: string | undefined, primerMensaje: string): Promise<{ id: string; nueva: boolean }> {
  if (conversacionId) {
    const c = await prisma.conversacionIA.findFirst({ where: { id: conversacionId, usuario_id: usuarioId }, select: { id: true } });
    if (!c) throw sinConversacion();
    return { id: c.id, nueva: false };
  }
  const c = await prisma.conversacionIA.create({ data: { usuario_id: usuarioId, titulo: tituloDe(primerMensaje) }, select: { id: true } });
  return { id: c.id, nueva: true };
}

/**
 * Historial para el modelo: los últimos 10 turnos, con tope de ~6 000 caracteres (los más viejos se descartan). Sólo mensajes buenos:
 * los fallidos y las respuestas de contingencia no son «lo que dijo el modelo». Empieza siempre con un mensaje del usuario y los roles alternan.
 */
export async function historialDe(conversacionId: string): Promise<MensajeTurno[]> {
  const filas = await prisma.mensajeIA.findMany({
    where: { conversacion_id: conversacionId, estado: 'ok', modo: null },
    orderBy: { id: 'desc' },
    take: HISTORIAL_MENSAJES,
    select: { rol: true, contenido: true },
  });
  const elegidos: MensajeTurno[] = [];
  let total = 0;
  for (const f of filas) { // del más nuevo al más viejo
    if (total + f.contenido.length > HISTORIAL_CARACTERES && elegidos.length > 0) break;
    total += f.contenido.length;
    elegidos.push({ rol: f.rol === 'assistant' ? 'assistant' : 'user', texto: f.contenido.length > HISTORIAL_CARACTERES ? f.contenido.slice(0, HISTORIAL_CARACTERES) : f.contenido });
  }
  elegidos.reverse();
  const salida = unirSeguidos(elegidos);
  while (salida.length && salida[0]!.rol !== 'user') salida.shift();
  return salida;
}

/** Une mensajes seguidos del mismo rol (p. ej. una pregunta cuya respuesta falló y la siguiente): los proveedores esperan que los roles alternen. */
export function unirSeguidos(mensajes: MensajeTurno[]): MensajeTurno[] {
  const salida: MensajeTurno[] = [];
  for (const m of mensajes) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.rol === m.rol) { if (ultimo.texto !== m.texto) ultimo.texto += `\n\n${m.texto}`; } // un «Reintentar» repite la misma pregunta: no se duplica
    else salida.push({ ...m });
  }
  return salida;
}

export const guardarMensajeUsuario = (conversacionId: string, contenido: string) =>
  prisma.mensajeIA.create({ data: { conversacion_id: conversacionId, rol: 'user', contenido }, select: { id: true } });

export interface MetricasMensaje {
  proveedor?: string | null;
  modelo?: string | null;
  latencia_ms?: number | null;
  tokens_entrada?: number | null;
  tokens_salida?: number | null;
  estado: 'ok' | 'error';
  error_codigo?: string | null;
  modo?: 'contingencia' | null;
}

export async function guardarMensajeAsistente(conversacionId: string, contenido: string, m: MetricasMensaje) {
  const [fila] = await prisma.$transaction([
    prisma.mensajeIA.create({
      data: {
        conversacion_id: conversacionId, rol: 'assistant', contenido,
        proveedor: m.proveedor ?? null, modelo: m.modelo ?? null, latencia_ms: m.latencia_ms ?? null,
        tokens_entrada: m.tokens_entrada ?? null, tokens_salida: m.tokens_salida ?? null,
        estado: m.estado, error_codigo: m.error_codigo ?? null, modo: m.modo ?? null,
      },
      select: { id: true },
    }),
    prisma.conversacionIA.update({ where: { id: conversacionId }, data: { updated_at: new Date(cooldownDeps.ahora()) }, select: { id: true } }),
  ]);
  return fila;
}

export const listarDe = (usuarioId: number) =>
  prisma.conversacionIA.findMany({ where: { usuario_id: usuarioId }, orderBy: { updated_at: 'desc' }, take: MAX_CONVERSACIONES_LISTA, select: { id: true, titulo: true, created_at: true, updated_at: true } });

/** Mensajes de una conversación PROPIA. Las métricas (proveedor, modelo, latencia) sólo salen para el superadmin. */
export async function detalleDe(usuarioId: number, id: string, conMetricas: boolean) {
  const c = await prisma.conversacionIA.findFirst({
    where: { id, usuario_id: usuarioId },
    select: { id: true, titulo: true, created_at: true, updated_at: true, mensajes: { orderBy: { id: 'asc' }, select: { id: true, rol: true, contenido: true, estado: true, error_codigo: true, modo: true, created_at: true, proveedor: true, modelo: true, latencia_ms: true } } },
  });
  if (!c) throw sinConversacion();
  return {
    ...c,
    mensajes: c.mensajes.map(({ proveedor, modelo, latencia_ms, ...resto }) => (conMetricas ? { ...resto, proveedor, modelo, latencia_ms } : resto)),
  };
}

export async function borrarDe(usuarioId: number, id: string): Promise<void> {
  const r = await prisma.conversacionIA.deleteMany({ where: { id, usuario_id: usuarioId } });
  if (r.count === 0) throw sinConversacion();
}

/** Borra las conversaciones sin actividad desde hace más de 90 días. */
export async function limpiarConversaciones(ahora = new Date(cooldownDeps.ahora())): Promise<number> {
  const limite = new Date(ahora.getTime() - RETENCION_DIAS * 86_400_000);
  const r = await prisma.conversacionIA.deleteMany({ where: { updated_at: { lt: limite } } });
  return r.count;
}

/** `ASISTENTE_LIMPIEZA=on|off`; sin definir, activa sólo en producción. */
export function limpiezaActiva(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.ASISTENTE_LIMPIEZA?.trim().toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return isProduction(env);
}
