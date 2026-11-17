/**
 * ¿Es una ruta de ESTE sitio? Empieza con «/», no con «//» (que el navegador toma por otro sitio), no trae `\` (algunos navegadores lo leen como «/») ni
 * caracteres de control, y no es larguísima. Lo que empieza con «/» no puede ser «https:»: sin esquema posible. Es la única puerta por la que un aviso push
 * (que viene de fuera) puede mover la pantalla: cualquier otra cosa se ignora. Hay una copia en `public/sw.js` (el service worker no puede importar).
 */
export function esRutaInterna(ruta: unknown): ruta is string {
  if (typeof ruta !== 'string' || ruta.length > 2000) return false;
  if (!ruta.startsWith('/') || ruta.startsWith('//')) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\\\u0000-\u001f\u007f]/.test(ruta);
}
