// Un turno del asistente de punta a punta: conversación, historial, contexto verificado, motor (con rotación) y métricas.
// Lo usan `POST /api/ai-chat` (respuesta completa) y `POST /api/ai-chat/stream` (SSE): misma lógica, distinta salida.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../../errors';
import type { AuthUser } from '../../middleware/auth';
import { MENSAJE_CORTO } from '../modelos/seleccion';
import { construirCadena } from '../rotacion';
import type { AjustesAplicados } from '../../lib/parametrosChat';
import { construirContexto, respuestaContingencia, type DatosContexto } from './contexto';
import { guardarMensajeAsistente, guardarMensajeUsuario, historialDe, nombreAmigableDeModelo, obtenerOCrear, unirSeguidos } from './conversaciones';
import { ejecutar, type CausaFallo } from './motor';
import type { Turno } from './proveedor';

let systemPrompt: string | undefined;
export function leerSystemPrompt(): string {
  systemPrompt ??= fs.readFileSync(path.join(process.cwd(), 'src', 'config', 'ai-system-prompt.txt'), 'utf8');
  return systemPrompt;
}
/** Sólo para pruebas. */
export const olvidarSystemPrompt = () => { systemPrompt = undefined; };

export const MENSAJES_ERROR: Record<CausaFallo | 'cortada', { status: number; mensaje: string }> = {
  sin_configurar: { status: 500, mensaje: 'La IA no está configurada en el servidor. Contacta al administrador.' },
  saturada: { status: 429, mensaje: 'La IA está saturada o se superó la cuota. Intenta nuevamente en unos minutos.' },
  fallo: { status: 503, mensaje: 'El servicio de IA no pudo responder. Intenta de nuevo más tarde.' },
  modelo_fijo: { status: 503, mensaje: 'El modelo elegido no respondió; prueba con Auto.' },
  cancelado: { status: 499, mensaje: 'Se canceló la consulta.' },
  cortada: { status: 502, mensaje: 'La respuesta se cortó. Puedes reintentar.' },
};

export interface Preparado {
  conversacionId: string;
  /** Id del mensaje del usuario recién guardado (el panel lo usa para «volver a este mensaje»). */
  mensajeId: number;
  turno: Turno;
  datos: DatosContexto;
  ajustes: AjustesAplicados;
  mensajeCorto: boolean;
}

/**
 * Todo lo que puede fallar ANTES de responder: hay IA configurada, la conversación es del usuario, se guarda el mensaje y se arma el
 * historial (en el servidor) y el contexto verificado. Lanza `HttpError` (500 sin IA, 404 conversación ajena).
 */
export async function prepararTurno(user: AuthUser, mensaje: string, ajustes: AjustesAplicados, opts: { conversacionId?: string; ruta?: string }): Promise<Preparado> {
  if ((await construirCadena()).length === 0) throw new HttpError(500, MENSAJES_ERROR.sin_configurar.mensaje);
  const { id } = await obtenerOCrear(user.id, opts.conversacionId, mensaje);
  const historial = await historialDe(id); // ANTES de guardar el mensaje nuevo
  const guardado = await guardarMensajeUsuario(id, mensaje);
  const { datos, bloque } = await construirContexto(user, opts.ruta);
  let sistema: string;
  try {
    sistema = `${leerSystemPrompt()}\n\n${bloque}`;
  } catch {
    console.error('[ai-chat] no se pudo leer el prompt de sistema');
    throw new HttpError(500, 'No se pudo preparar la consulta a la IA.');
  }
  return {
    conversacionId: id,
    mensajeId: guardado.id,
    turno: { sistema, mensajes: unirSeguidos([...historial, { rol: 'user', texto: mensaje }]) },
    datos,
    ajustes,
    mensajeCorto: mensaje.length < MENSAJE_CORTO,
  };
}

export type EventoTurno =
  | { tipo: 'delta'; texto: string }
  | { tipo: 'fin'; modelo: string | null; proveedor: string | null; latencia_ms: number; modo: 'contingencia' | null; texto: string }
  | { tipo: 'error'; codigo: CausaFallo | 'cortada'; mensaje: string; parcial: string };

/**
 * Ejecuta el turno ya preparado y guarda la respuesta con sus métricas. Emite `delta`s y termina con `fin` o `error`.
 * Si NINGUNA ruta de IA responde (y no se pidió un modelo fijo), contesta con la contingencia armada por código.
 */
export async function* ejecutarTurno(prep: Preparado, opts: { stream: boolean; signal?: AbortSignal }): AsyncGenerator<EventoTurno, void, void> {
  const { ajustes } = prep;
  const gen = ejecutar({
    turno: prep.turno,
    parametros: ajustes.parametros,
    esfuerzo: ajustes.esfuerzo,
    modeloFijo: ajustes.modeloFijo ?? undefined,
    stream: opts.stream,
    mensajeCorto: prep.mensajeCorto,
    signal: opts.signal,
  });
  let r = await gen.next();
  while (!r.done) {
    yield { tipo: 'delta', texto: r.value };
    r = await gen.next();
  }
  const res = r.value;
  if (res.tipo === 'ok') {
    await guardarMensajeAsistente(prep.conversacionId, res.texto, { proveedor: res.proveedor, modelo: res.modelo, latencia_ms: res.latencia_ms, tokens_entrada: res.tokens_entrada, tokens_salida: res.tokens_salida, estado: 'ok' }, prep.mensajeId);
    yield { tipo: 'fin', modelo: res.modelo, proveedor: res.proveedor, latencia_ms: res.latencia_ms, modo: null, texto: res.texto };
    return;
  }

  // ---- No hubo respuesta completa ----
  if (res.causa === 'cancelado') {
    if (res.parcial) await guardarMensajeAsistente(prep.conversacionId, res.parcial, { proveedor: res.proveedor, modelo: res.modelo, latencia_ms: res.latencia_ms, estado: 'error', error_codigo: 'cancelado' }, prep.mensajeId);
    return;
  }
  if (res.parcial) {
    // Falló a mitad del stream: el cliente ya recibió texto; se guarda el parcial y se avisa.
    await guardarMensajeAsistente(prep.conversacionId, res.parcial, { proveedor: res.proveedor, modelo: res.modelo, latencia_ms: res.latencia_ms, estado: 'error', error_codigo: 'cortada' }, prep.mensajeId);
    yield { tipo: 'error', codigo: 'cortada', mensaje: MENSAJES_ERROR.cortada.mensaje, parcial: res.parcial };
    return;
  }
  if (res.causa === 'modelo_fijo') {
    const mensaje = `El modelo ${await nombreAmigableDeModelo(res.modelo)} no respondió; prueba con Auto.`;
    await guardarMensajeAsistente(prep.conversacionId, '', { estado: 'error', error_codigo: 'modelo_fijo', latencia_ms: res.latencia_ms }, prep.mensajeId);
    yield { tipo: 'error', codigo: 'modelo_fijo', mensaje, parcial: '' };
    return;
  }
  if (res.causa === 'sin_configurar') {
    yield { tipo: 'error', codigo: 'sin_configurar', mensaje: MENSAJES_ERROR.sin_configurar.mensaje, parcial: '' };
    return;
  }
  // Ninguna ruta sana: contingencia sin IA, con los datos verificados del usuario.
  const texto = respuestaContingencia(prep.datos);
  await guardarMensajeAsistente(prep.conversacionId, texto, { estado: 'ok', modo: 'contingencia', latencia_ms: res.latencia_ms, error_codigo: res.causa }, prep.mensajeId);
  yield { tipo: 'delta', texto };
  yield { tipo: 'fin', modelo: null, proveedor: null, latencia_ms: res.latencia_ms, modo: 'contingencia', texto };
}
