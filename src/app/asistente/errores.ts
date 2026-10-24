// Errores del asistente por CAUSA, con texto claro y sin jerga. Lo que dice el proveedor jamás llega aquí (el servidor ya lo resumió).
import type { ErrorChat } from './tipos';

export const MENSAJE_ERROR = {
  no_configurado: 'El asistente todavía no está configurado. Avisa a la administración.',
  saturado: 'El asistente está muy ocupado ahora mismo. Prueba de nuevo en unos minutos.',
  limite_uso: 'Hiciste muchas consultas seguidas. Espera unos minutos y vuelve a intentar.',
  sin_conexion: 'No hay conexión. Revisa tu internet e inténtalo otra vez.',
  tiempo: 'La respuesta tardó demasiado. Inténtalo de nuevo.',
  caido: 'El asistente no está disponible por ahora. Inténtalo en unos minutos.',
  cortada: 'La respuesta se cortó. Puedes reintentar.',
  sesion: 'Tu sesión venció. Vuelve a entrar para seguir usando el asistente.',
  otro: 'No pude responder esta vez. Inténtalo de nuevo.',
} as const;

/** Del código de estado (y del texto que mandó el servidor) a una causa. Los mensajes propios del servidor (validación, modelo fijo) se respetan. */
export function errorDeRespuesta(status: number, mensajeServidor?: string): ErrorChat {
  if (status === 401) return { causa: 'sesion', mensaje: MENSAJE_ERROR.sesion };
  if (status === 429) return /saturad|cuota/i.test(mensajeServidor ?? '') ? { causa: 'saturado', mensaje: MENSAJE_ERROR.saturado } : { causa: 'limite_uso', mensaje: MENSAJE_ERROR.limite_uso };
  if (status === 504 || status === 408) return { causa: 'tiempo', mensaje: MENSAJE_ERROR.tiempo };
  if (status === 500 && /no está configurada/i.test(mensajeServidor ?? '')) return { causa: 'no_configurado', mensaje: MENSAJE_ERROR.no_configurado };
  if (/no respondió; prueba con Auto/i.test(mensajeServidor ?? '')) return { causa: 'modelo', mensaje: mensajeServidor! };
  if (status === 400 || status === 404 || status === 422) return { causa: 'otro', mensaje: mensajeServidor && mensajeServidor.length < 160 ? mensajeServidor : MENSAJE_ERROR.otro };
  if (status >= 500) return { causa: 'caido', mensaje: MENSAJE_ERROR.caido };
  return { causa: 'otro', mensaje: MENSAJE_ERROR.otro };
}

/** De un evento `error` del stream. */
export function errorDeEvento(codigo: string, mensaje: string): ErrorChat {
  switch (codigo) {
    case 'cortada': return { causa: 'cortada', mensaje: MENSAJE_ERROR.cortada };
    case 'sin_configurar': return { causa: 'no_configurado', mensaje: MENSAJE_ERROR.no_configurado };
    case 'saturada': return { causa: 'saturado', mensaje: MENSAJE_ERROR.saturado };
    case 'modelo_fijo': return { causa: 'modelo', mensaje };
    case 'fallo': return { causa: 'caido', mensaje: MENSAJE_ERROR.caido };
    default: return { causa: 'otro', mensaje: MENSAJE_ERROR.otro };
  }
}

/** De una excepción de `fetch`/lectura (sin respuesta del servidor). */
export function errorDeExcepcion(e: unknown): ErrorChat {
  const nombre = e instanceof Error ? e.name : '';
  if (nombre === 'TimeoutError') return { causa: 'tiempo', mensaje: MENSAJE_ERROR.tiempo };
  if (nombre === 'TypeError') return { causa: 'sin_conexion', mensaje: MENSAJE_ERROR.sin_conexion }; // fetch sin red, o la conexión se cayó a medias
  return { causa: 'otro', mensaje: MENSAJE_ERROR.otro };
}
