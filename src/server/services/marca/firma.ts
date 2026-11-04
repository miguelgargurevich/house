// URL pública del logo para los correos. Un correo se abre sin sesión, así que el logo necesita una dirección que cualquiera con el enlace pueda pedir.
// El logo no es secreto, pero no se deja adivinar: la dirección lleva una firma (HMAC del id de la empresa con el secreto del servidor), así nadie
// recorre ids 1, 2, 3… para bajar los logos de todas las empresas. La firma es del id, NO de la versión: un correo viejo sigue mostrando el logo vigente
// de esa empresa (`v` sólo evita que el cliente de correo guarde en caché el anterior). Con otro secreto de servidor las direcciones viejas dejan de
// servir: el correo muestra el nombre en su lugar.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { JWT_SECRET } from '../../config';
import { ENLACE_APP } from '../avisos/plantillas';

const firmaDe = (empresaId: number): string => createHmac('sha256', JWT_SECRET).update(`marca-logo:${empresaId}`).digest('base64url').slice(0, 22);

/** ¿La firma de la URL corresponde a esa empresa? Comparación en tiempo constante. */
export function firmaDeLogoValida(empresaId: number, firma: unknown): boolean {
  if (typeof firma !== 'string' || firma.length > 64) return false;
  const esperada = Buffer.from(firmaDe(empresaId));
  const dada = Buffer.from(firma);
  return dada.length === esperada.length && timingSafeEqual(dada, esperada);
}

export const RUTA_PUBLICA_LOGO = '/api/publico/marca';

/** `https://…/api/publico/marca/12/logo?f=<firma>&v=<versión>`: absoluta, porque un correo no admite rutas relativas. */
export function urlPublicaDeLogo(empresaId: number, version: string): string {
  return `${ENLACE_APP}${RUTA_PUBLICA_LOGO}/${empresaId}/logo?f=${firmaDe(empresaId)}&v=${encodeURIComponent(version)}`;
}
