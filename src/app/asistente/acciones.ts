// Lógica pura de las acciones sobre los mensajes (sin React ni red): volver a un mensaje, regenerar, nombrar, buscar y exportar.
import type { ConversacionResumen, MensajeChat } from './tipos';

export const TITULO_MAX = 80;

function ultimoUsuario(mensajes: MensajeChat[]): MensajeChat | undefined {
  for (let i = mensajes.length - 1; i >= 0; i--) if (mensajes[i]!.rol === 'user') return mensajes[i];
  return undefined;
}

export interface Reescritura {
  /** Lo que queda en la vista: todo lo anterior al mensaje. */
  restantes: MensajeChat[];
  /** El texto del mensaje, que vuelve al campo. */
  texto: string;
  /** Desde qué mensaje de la base hay que borrar (inclusive); `null` si ese mensaje nunca llegó a guardarse. */
  desdeIdServidor: number | null;
}

/**
 * «Editar» un mensaje del usuario: se quita ESE mensaje y todo lo posterior (no desde el siguiente: si no, «editar» sería «duplicar») y su
 * texto vuelve al campo. Sólo los mensajes del usuario se pueden reescribir.
 */
export function reescribir(mensajes: MensajeChat[], id: string): Reescritura | null {
  const i = mensajes.findIndex((m) => m.id === id);
  const m = mensajes[i];
  if (!m || m.rol !== 'user') return null;
  return { restantes: mensajes.slice(0, i), texto: m.texto, desdeIdServidor: m.idServidor ?? null };
}

/** Regenerar la última respuesta (o reintentar un error) es reescribir el último mensaje del usuario y reenviarlo tal cual. */
export function paraRegenerar(mensajes: MensajeChat[]): Reescritura | null {
  const m = ultimoUsuario(mensajes);
  return m ? reescribir(mensajes, m.id) : null;
}

/** Último mensaje que la persona envió (↑ en el campo vacío). */
export const ultimoEnviado = (mensajes: MensajeChat[]): string | null => ultimoUsuario(mensajes)?.texto ?? null;

/** ¿Se puede regenerar? Sólo el último mensaje del asistente, ya terminado (o con error) y sin un turno en curso. */
export const puedeRegenerar = (mensajes: MensajeChat[], i: number, ocupado: boolean): boolean => {
  const m = mensajes[i];
  return !ocupado && !!m && m.rol === 'assistant' && i === mensajes.length - 1 && m.estado !== 'transmitiendo' && mensajes.some((x) => x.rol === 'user');
};

/** Título válido para guardar, o el motivo por el que no. Mismas reglas que el servidor (1–80, sin HTML ni control). */
export function validarTitulo(crudo: string): { ok: true; titulo: string } | { ok: false; motivo: string } {
  const titulo = crudo.trim();
  if (!titulo) return { ok: false, motivo: 'Escribe un título.' };
  if (titulo.length > TITULO_MAX) return { ok: false, motivo: `Máximo ${TITULO_MAX} caracteres.` };
  if (/[<>]/.test(titulo)) return { ok: false, motivo: 'No uses < ni >.' };
  if (/\p{Cc}/u.test(titulo)) return { ok: false, motivo: 'El título tiene caracteres no válidos.' };
  return { ok: true, titulo };
}

const sinTildes = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Filtra por título, sin distinguir mayúsculas ni tildes; vacío = todas. */
export function filtrarConversaciones(lista: ConversacionResumen[], consulta: string): ConversacionResumen[] {
  const q = sinTildes(consulta.trim());
  return q ? lista.filter((c) => sinTildes(c.titulo).includes(q)) : lista;
}

/** Nombre de archivo seguro (minúsculas, guiones, sin tildes ni símbolos) para la descarga. */
export function nombreArchivoDe(titulo: string, fecha: Date): string {
  const base = sinTildes(titulo).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'conversacion';
  const dia = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Lima' }).format(fecha); // el mismo día que dice el encabezado (Lima, no UTC)
  return `${base}-${dia}.md`;
}

/** La conversación como Markdown: sólo lo que se ve (sin métricas del modelo ni ids). Los mensajes sin texto no salen. */
export function exportarMarkdown(titulo: string, mensajes: MensajeChat[], fecha: Date): string {
  const cuerpo = mensajes
    .filter((m) => m.texto.trim() && m.estado !== 'transmitiendo')
    .map((m) => `## ${m.rol === 'user' ? 'Tú' : 'Asistente'}\n\n${m.texto.trim()}`)
    .join('\n\n');
  const dia = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' }).format(fecha);
  return `# ${titulo.replace(/\s+/g, ' ').trim() || 'Conversación'}\n\n_Exportada de House el ${dia}._\n\n${cuerpo}\n`;
}
