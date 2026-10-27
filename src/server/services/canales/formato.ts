import { ENLACE_APP } from '../avisos/plantillas';

/**
 * Markdown del asistente → texto de WhatsApp. Enlaces internos `[Mis pagos](/propietario/pagos)` → «House › Mis pagos» (el chat no
 * abre rutas); enlaces externos → «texto (url)». Negritas `**x**` → `*x*`, títulos → `*título*`, viñetas `*` → `-` (para no chocar con la negrita).
 */
export function aTextoWhatsapp(md: string): string {
  let t = md.replace(/\r\n/g, '\n');
  t = t.replace(/```[a-z]*\n?([\s\S]*?)```/gi, (_m, c: string) => c.trim()); // bloques de código → su contenido
  t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, texto: string, url: string) => {
    if (url.startsWith('/') || url.startsWith(ENLACE_APP)) return `House › ${texto}`;
    return texto === url ? url : `${texto} (${url})`;
  });
  t = t.replace(/^[ \t]*[*+][ \t]+/gm, '- '); // viñetas
  t = t.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, '*$1*'); // títulos
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/__([^_\n]+)__/g, '*$1*'); // negritas
  t = t.replace(/~~([^~\n]+)~~/g, '~$1~'); // tachado
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** Quita acentos y mayúsculas para reconocer los comandos simples («Menú», «DESVINCULAR»). */
export const comandoDe = (texto: string): string =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

/**
 * Markdown del asistente → TEXTO PLANO para Telegram (sin `parse_mode`: ninguna etiqueta ni marca del usuario o de la IA se interpreta, así que no hay
 * inyección de HTML). Mismos enlaces y viñetas que WhatsApp, pero sin negritas ni títulos con asteriscos.
 */
export function aTextoPlano(md: string): string {
  return aTextoWhatsapp(md)
    .replace(/^\*([^*\n]+)\*$/gm, '$1') // títulos
    .replace(/\*([^*\n]+)\*/g, '$1') // negritas
    .replace(/~([^~\n]+)~/g, '$1');
}
