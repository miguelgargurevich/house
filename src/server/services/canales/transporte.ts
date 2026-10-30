import type { CanalBot } from './vinculos';

/** Lo que el canal sabe de un archivo recibido (imagen o documento). `fileId` sólo lo usa Telegram. */
export interface MedioEntrante { tipo: 'imagen' | 'documento'; mimetype: string | null; nombre: string | null; tamano: number | null; fileId?: string }

/** El archivo ya bajado: en base64 (Evolution) o en bytes (Telegram). */
export type MedioBajado = { base64: string } | { datos: Buffer };

/** El archivo supera el tope antes o durante la descarga. */
export class MedioMuyGrande extends Error {
  constructor() {
    super('medio demasiado grande');
  }
}

/** Un mensaje entrante ya interpretado, sin nada propio del canal. */
export interface MensajeEntrante {
  mensajeId: string;
  texto: string;
  medio: MedioEntrante | null;
  /** Audio, video, sticker, ubicación… algo que no sabemos leer. */
  otro: boolean;
  /** Telegram: el mensaje fue `/start` (con o sin código; el código ya viene en `texto`). */
  esStart?: boolean;
}

/**
 * Por dónde llega y se responde un mensaje. La capa común (`atenderMensaje`) no sabe de Evolution ni de Telegram: sólo de esto.
 * `empresaId`: WhatsApp = la de la instancia (el vínculo debe ser de ESA empresa); `null` = Telegram (bot global), la empresa sale del vínculo.
 */
export interface Transporte {
  canal: CanalBot;
  /** Número (WhatsApp) o `chat.id` (Telegram): la clave del vínculo. */
  identificador: string;
  empresaId: number | null;
  /** `complejoId`: la respuesta es del asistente de ese condominio (cuenta contra su tope de WhatsApp). Sin él, no cuenta ni se frena (códigos de vinculación). */
  responder(texto: string, opts?: { complejoId?: number | null }): Promise<void>;
  descargarMedio(medio: MedioEntrante): Promise<MedioBajado>;
}
