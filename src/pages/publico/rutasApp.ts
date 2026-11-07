// Prefijos de las rutas de la app (con sesión) y de los enlaces de un solo uso. Sin sesión, una dirección desconocida que empiece por uno de ellos va al
// inicio de sesión (un favorito viejo o un enlace compartido); cualquier otra desconocida es la página «No encontramos esta página».
// Debe coincidir con `PREFIJOS_PRIVADOS` del servidor (`src/server/seo/rutas.ts`, que responde 404 sólo a lo que no empieza por ellos): lo fija una prueba.
export const PREFIJOS_APP = ['/admin', '/superadmin', '/propietario', '/inquilino', '/junta', '/mantenimiento', '/limpieza', '/jardineria', '/seguridad', '/perfil', '/verificar-correo', '/invitacion'] as const;

export function esRutaDeLaApp(ruta: string): boolean {
  const p = ruta.toLowerCase().replace(/\/+$/, '') || '/';
  return PREFIJOS_APP.some(x => p === x || p.startsWith(`${x}/`));
}
