// Qué rutas son públicas e indexables y cuáles no. Todo lo que no está en `PUBLICAS` es privado o de un solo uso: `noindex`.

export const PUBLICAS = ['/', '/precios', '/registro', '/contacto', '/libro-de-reclamaciones', '/app', '/privacidad', '/terminos'] as const;
export type RutaPublica = (typeof PUBLICAS)[number];

/** Rutas con `noindex, follow` (la página de ingreso se rastrea para llegar a sus enlaces, pero no se indexa). El resto de lo no público es `noindex, nofollow`. */
const NOINDEX_SEGUIR = new Set(['/login', '/demo', '/eliminar-cuenta']);

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

/**
 * ¿La ruta no es de nadie? Ni pública, ni el ingreso, ni de la app (las áreas privadas, los enlaces de un solo uso y la API se reconocen por su prefijo).
 * A una ruta así el servidor le responde 404 de verdad (con `noindex`): la pantalla «No encontramos esta página». Las rutas de la app, con o sin sesión, siguen
 * respondiendo 200 y es la propia app la que decide (login o su pantalla).
 */
export function esDesconocida(ruta: string): boolean {
  // `/demo` (la entrada por rol de la instancia de demostración) es de la app: 200 aunque no se indexe; con 404 la vista previa del enlace en WhatsApp falla.
  // `/eliminar-cuenta` es la página que pide Google Play («cómo eliminar tu cuenta»): pública, 200 y sin indexar.
  if (esPublica(ruta) || NOINDEX_SEGUIR.has(ruta)) return false;
  return !PREFIJOS_PRIVADOS.some((p) => {
    const base = p.replace(/\/$/, '');
    return ruta === base || ruta.startsWith(`${base}/`);
  });
}
