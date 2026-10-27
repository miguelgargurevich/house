import type { MedioEntrante, MensajeEntrante } from './transporte';

/** Un update de Telegram ya interpretado: de un chat PRIVADO y de una persona (no un bot). */
export interface EntranteTelegram extends MensajeEntrante {
  updateId: number;
  /** `chat.id` del chat privado (como texto): la clave del vínculo. */
  chatId: string;
}

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const cadena = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

/** `/start`, `/start 123456`, `/start@MiBot 123456` → lo que viene después (puede ir vacío); otro texto → null. */
export function leerStart(texto: string): string | null {
  const m = /^\/start(?:@\w{1,64})?(?:[ \t]+([\s\S]*))?$/i.exec(texto.trim());
  return m ? (m[1] ?? '').trim() : null;
}

/** La foto de mayor resolución de las que manda Telegram (varias copias del mismo archivo en distintos tamaños). */
function mejorFoto(fotos: unknown): MedioEntrante | null {
  if (!Array.isArray(fotos)) return null;
  let mejor: { fileId: string; area: number; tamano: number | null } | null = null;
  for (const crudo of fotos.slice(0, 20)) {
    const f = objeto(crudo);
    const fileId = cadena(f?.file_id);
    if (!f || !fileId || fileId.length > 256) continue;
    const area = (entero(f.width) ?? 0) * (entero(f.height) ?? 0);
    const tamano = entero(f.file_size);
    if (!mejor || area > mejor.area || (area === mejor.area && (tamano ?? 0) > (mejor.tamano ?? 0))) mejor = { fileId, area, tamano };
  }
  // Las fotos de Telegram siempre son JPEG.
  return mejor ? { tipo: 'imagen', mimetype: 'image/jpeg', nombre: null, tamano: mejor.tamano, fileId: mejor.fileId } : null;
}

/**
 * Interpreta el cuerpo del webhook de Telegram. `null` = ignorar: no es un `message` (ediciones, canales, callbacks…), el chat no es `private`
 * (grupos, supergrupos, canales), quien escribe es un bot, o el cuerpo es raro. Nunca lanza.
 */
export function interpretarUpdate(body: unknown): EntranteTelegram | null {
  const b = objeto(body);
  const updateId = entero(b?.update_id);
  const m = objeto(b?.message); // sólo `message`: `edited_message`, `channel_post`… no se miran
  const chat = objeto(m?.chat);
  const de = objeto(m?.from);
  const chatId = entero(chat?.id);
  if (updateId == null || !m || !chat || chat.type !== 'private' || chatId == null || chatId <= 0) return null;
  if (!de || de.is_bot === true || entero(de.id) == null) return null;

  const documento = objeto(m.document);
  const foto = mejorFoto(m.photo);
  let medio: MedioEntrante | null = foto;
  if (!medio && documento) {
    const fileId = cadena(documento.file_id);
    if (fileId && fileId.length <= 256) medio = { tipo: 'documento', mimetype: cadena(documento.mime_type), nombre: cadena(documento.file_name)?.slice(0, 200) ?? null, tamano: entero(documento.file_size), fileId };
  }
  const crudo = cadena(m.text) ?? cadena(m.caption) ?? '';
  const payload = medio ? null : leerStart(crudo);
  const texto = payload ?? crudo;
  const otro = !medio && !texto.trim() && payload == null;
  return { mensajeId: String(updateId), updateId, chatId: String(chatId), texto, medio, otro, ...(payload != null ? { esStart: true } : {}) };
}
