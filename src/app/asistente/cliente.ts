// Cliente del chat en streaming (`POST /api/ai-chat/stream`). Con sesión por cookie: `credentials: same-origin` y `X-CSRF-Token`.
// Sin React ni `api.ts` (que depende de Vite): `fetch` y el token CSRF se inyectan, así se prueba con node:test.
import { errorDeEvento, errorDeExcepcion, errorDeRespuesta } from './errores';
import { leerSse } from './sse';
import type { ErrorChat } from './tipos';

export interface PeticionChat {
  message: string;
  conversacion_id?: string | null;
  ruta?: string;
  [ajuste: string]: unknown;
}

export type EventoCliente =
  | { tipo: 'meta'; conversacion_id: string }
  | { tipo: 'delta'; texto: string }
  | { tipo: 'fin'; modelo: string | null; proveedor: string | null; latencia_ms: number | null; modo: 'contingencia' | null }
  | { tipo: 'error'; error: ErrorChat };

export interface DepsCliente {
  fetch: typeof fetch;
  csrf: () => Record<string, string>;
  /** Se llama si el servidor responde 401 (la sesión se perdió). */
  sesionPerdida?: () => void;
  base?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

/** Emite los eventos del turno. Nunca lanza: cualquier fallo sale como un evento `error` (y termina). Cancelar con `signal` cierra la conexión. */
export async function* enviarMensaje(deps: DepsCliente, peticion: PeticionChat, signal?: AbortSignal): AsyncGenerator<EventoCliente, void, void> {
  let r: Response;
  try {
    r = await deps.fetch(`${deps.base ?? ''}/api/ai-chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...deps.csrf() },
      body: JSON.stringify(peticion),
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if (signal?.aborted) return;
    yield { tipo: 'error', error: errorDeExcepcion(e) };
    return;
  }

  if (!r.ok || !r.body) {
    // Errores previos al stream: JSON normal ({ error: { code, message } } o { error: 'texto' }).
    const cuerpo = obj(await r.json().catch(() => ({})));
    const e = cuerpo.error;
    const mensaje = typeof e === 'string' ? e : str(obj(e).message) ?? undefined;
    if (r.status === 401) deps.sesionPerdida?.();
    yield { tipo: 'error', error: errorDeRespuesta(r.status, mensaje) };
    return;
  }

  let terminoBien = false;
  try {
    for await (const ev of leerSse(r.body)) {
      const d = obj(ev.datos);
      if (ev.evento === 'meta') { const id = str(d.conversacion_id); if (id) yield { tipo: 'meta', conversacion_id: id }; }
      else if (ev.evento === 'delta') { const t = str(d.texto); if (t) yield { tipo: 'delta', texto: t }; }
      else if (ev.evento === 'done') {
        terminoBien = true;
        yield { tipo: 'fin', modelo: str(d.modelo), proveedor: str(d.proveedor), latencia_ms: typeof d.latencia_ms === 'number' ? d.latencia_ms : null, modo: d.modo === 'contingencia' ? 'contingencia' : null };
      } else if (ev.evento === 'error') {
        terminoBien = true;
        yield { tipo: 'error', error: errorDeEvento(str(d.codigo) ?? '', str(d.mensaje) ?? '') };
      }
    }
  } catch (e) {
    if (signal?.aborted) return;
    yield { tipo: 'error', error: errorDeExcepcion(e) };
    return;
  }
  // La conexión se cerró sin `done` ni `error`: la respuesta quedó a medias.
  if (!terminoBien && !signal?.aborted) yield { tipo: 'error', error: errorDeEvento('cortada', '') };
}
