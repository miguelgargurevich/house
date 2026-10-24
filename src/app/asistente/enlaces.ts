// Enlaces del Markdown de las respuestas: SÓLO rutas internas de la app y https. Cualquier otro esquema (javascript:, data:, http:, mailto:…)
// se descarta y queda como texto. Sin HTML crudo (react-markdown no lo interpreta) y sin imágenes.
export type Enlace = { tipo: 'interno'; ruta: string } | { tipo: 'externo'; url: string } | { tipo: 'descartado' };

// Una ruta interna: letras, números, guion y barra; opcionalmente con ?consulta y #ancla simples.
const RUTA_INTERNA = /^\/(?!\/)[A-Za-z0-9\-_/]*(\?[A-Za-z0-9\-_=&%.]*)?(#[A-Za-z0-9\-_]*)?$/;

export function clasificarEnlace(href: string | undefined | null): Enlace {
  const h = (href ?? '').trim();
  // eslint-disable-next-line no-control-regex -- justamente se buscan caracteres de control
  if (!h || /[\u0000-\u001f\u007f\\]/.test(h)) return { tipo: 'descartado' };
  if (h.startsWith('/')) return RUTA_INTERNA.test(h) ? { tipo: 'interno', ruta: h } : { tipo: 'descartado' };
  try {
    const u = new URL(h);
    if (u.protocol === 'https:' && u.hostname && !u.username && !u.password) return { tipo: 'externo', url: u.toString() };
  } catch { /* no es una URL */ }
  return { tipo: 'descartado' };
}
