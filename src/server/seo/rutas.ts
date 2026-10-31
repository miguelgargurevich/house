// Qué rutas son públicas e indexables y cuáles no. Todo lo que no está en `PUBLICAS` es privado o de un solo uso: `noindex`.

export const PUBLICAS = ['/', '/precios', '/registro', '/privacidad', '/terminos'] as const;
export type RutaPublica = (typeof PUBLICAS)[number];

/** Rutas con `noindex, follow` (la página de ingreso se rastrea para llegar a sus enlaces, pero no se indexa). El resto de lo no público es `noindex, nofollow`. */
const NOINDEX_SEGUIR = new Set(['/login']);

/** Prefijos que `robots.txt` no deja rastrear (áreas privadas, API y enlaces de un solo uso). `/login` NO va: se rastrea para ver su `noindex`. */
export const PREFIJOS_PRIVADOS = ['/api/', '/admin', '/superadmin', '/propietario', '/inquilino', '/junta', '/mantenimiento', '/limpieza', '/jardineria', '/seguridad', '/perfil', '/verificar-correo', '/invitacion'] as const;

/** `/precios/` y `/precios` son la misma página; el resto de la ruta se compara tal cual (sin mayúsculas, sin barra final). */
export function normalizarRuta(path: string): string {
  const p = (path || '/').toLowerCase();
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p;
}

export const esPublica = (ruta: string): ruta is RutaPublica => (PUBLICAS as readonly string[]).includes(ruta);

/** `X-Robots-Tag` / `<meta robots>` de una ruta NO pública. */
export const robotsPrivado = (ruta: string): string => (NOINDEX_SEGUIR.has(ruta) ? 'noindex, follow' : 'noindex, nofollow');
