// Escapado de TODO dato que viene de la base (nombre de plan, descripción, viñetas…) antes de ponerlo en el HTML estático.

const ENTIDADES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Para texto y atributos HTML (y XML): `&`, `<`, `>` y las dos comillas. */
export const esc = (valor: unknown): string => String(valor ?? '').replace(/[&<>"']/g, (c) => ENTIDADES[c]);

/**
 * JSON listo para ir DENTRO de `<script type="application/ld+json">`: `<`, `>` y `&` salen como `\uXXXX` (un `</script>` en un nombre de plan no
 * cierra el script) y los separadores de línea (U+2028 y U+2029) también. `JSON.parse` del resultado devuelve el mismo objeto.
 */
const PELIGROSOS = new RegExp('[<>&' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']', 'g');
export const jsonSeguro = (objeto: unknown): string =>
  JSON.stringify(objeto).replace(PELIGROSOS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Texto de una sola línea y sin espacios duros (para `<meta content>`), recortado en palabra a `max` caracteres. */
export function textoMeta(texto: string, max: number): string {
  const limpio = texto.replace(/[\s\u00a0]+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max - 1);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(' '), 1)).replace(/[\s,;:.]+$/, '')}…`;
}
