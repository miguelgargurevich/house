/** Reglas de los archivos de comprobante: tipos admitidos, verificación de bytes y nombre seguro. */

export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number];
export const MAX_COMPROBANTE = 2 * 1024 * 1024;

const EXTENSION: Record<TipoComprobante, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

const empieza = (b: Uint8Array, firma: number[], desde = 0) => b.length >= desde + firma.length && firma.every((v, i) => b[desde + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Tipo real según los primeros bytes (el header `Content-Type` lo manda el cliente y no es de fiar). */
export function detectarTipo(b: Uint8Array): TipoComprobante | null {
  if (empieza(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (empieza(b, ascii('RIFF')) && empieza(b, ascii('WEBP'), 8)) return 'image/webp';
  if (empieza(b, ascii('%PDF-'))) return 'application/pdf';
  return null;
}

/** Nombre apto para guardar y para un header: sin rutas, sin caracteres de control ni de inversión de texto, máx. 100. */
export function sanearNombre(crudo: string | undefined, tipo: TipoComprobante): string {
  let n = crudo ?? '';
  try {
    n = decodeURIComponent(n);
  } catch {
    /* ya venía sin codificar */
  }
  n = (n.normalize('NFC').split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f"<>:*?|\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (n.length > 100) {
    const punto = n.lastIndexOf('.');
    const ext = punto > 0 && n.length - punto <= 6 ? n.slice(punto) : '';
    n = n.slice(0, 100 - ext.length) + ext;
  }
  return n || `comprobante.${EXTENSION[tipo]}`;
}

/** `Content-Disposition` en línea con `filename*` (RFC 5987) y un respaldo ASCII. */
export function dispositionInline(nombre: string): string {
  const ascii = nombre.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const codificado = encodeURIComponent(nombre).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${codificado}`;
}
