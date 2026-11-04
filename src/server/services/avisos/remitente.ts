// Remitente de los correos de Torre. Sale de la base (`ConfiguracionComercial.correo_remitente`) y, si está vacío, de la variable MAIL_FROM.
// El NOMBRE visible dice el condominio cuando el aviso es de uno («Condominio Los Libertadores vía Torre <avisos@torrecondominios.com>»);
// la DIRECCIÓN nunca cambia: sólo se puede enviar desde un dominio verificado en Resend.

const DIRECCION = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
/** Largo máximo del nombre visible: los clientes de correo lo recortan y un nombre kilométrico parece spam. */
const MAX_NOMBRE = 80;

/** Nombre y dirección de un remitente: `avisos@x.pe` o `Nombre <avisos@x.pe>` (el nombre puede ir entre comillas). `null` si no tiene ese formato. */
export function parsearRemitente(texto: string | null | undefined): { nombre: string | null; direccion: string } | null {
  const t = (texto ?? '').trim();
  if (!t || /[\r\n\0]/.test(t)) return null;
  if (DIRECCION.test(t) && t.length <= 254) return { nombre: null, direccion: t };
  const m = /^(.*)<([^<>\s]+)>$/.exec(t);
  if (!m) return null;
  const direccion = m[2]!;
  if (!DIRECCION.test(direccion) || direccion.length > 254) return null;
  let nombre = m[1]!.trim();
  if (/^".*"$/.test(nombre)) nombre = nombre.slice(1, -1).replace(/\\(.)/g, '$1').trim();
  else if (/[<>"]/.test(nombre)) return null; // un nombre sin comillas no puede traer < > "
  if (nombre.length > MAX_NOMBRE) return null;
  return { nombre: nombre || null, direccion };
}

/** Mensaje de error para la pantalla si el texto no es un remitente válido; `null` si lo es. */
export const MENSAJE_REMITENTE = 'Escribe una dirección (avisos@tudominio.com) o «Nombre <avisos@tudominio.com>»';
export function errorDeRemitente(texto: string): string | null {
  return parsearRemitente(texto) ? null : MENSAJE_REMITENTE;
}

/** Deja el nombre en una sola línea, sin los caracteres que separan campos o rompen la cabecera `From`. */
const limpiarNombre = (n: string): string => n.replace(/[\u0000-\u001f\u007f<>"\\,;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE);

/** `Nombre <dir>`; sin nombre, sólo la dirección. El nombre va entre comillas sólo si trae signos que la cabecera `From` no admite sueltos (punto, paréntesis, @…): letras, números y espacios van tal cual. */
const armar = (nombre: string | null, direccion: string): string => {
  if (!nombre) return direccion;
  return /^[\p{L}\p{N} !#$%&'*+/=?^_`{|}~-]+$/u.test(nombre) ? `${nombre} <${direccion}>` : `"${nombre}" <${direccion}>`;
};

/** Nombre visible de un aviso de condominio: «Los Libertadores vía Torre». */
export const nombreViaTorre = (condominio: string): string => limpiarNombre(`${condominio} vía Torre`);

/**
 * El `From` del correo. Primero lo configurado en la base, si no MAIL_FROM; `null` si no hay ninguno (el canal no está configurado).
 * Sin `condominio`, el remitente sale tal como está configurado. Con `condominio`, el nombre pasa a ser «<condominio> vía Torre» y la dirección queda
 * igual (también si lo configurado era sólo una dirección). Un remitente guardado con un formato roto no se usa: cae a MAIL_FROM en vez de dejar de enviar.
 */
export function resolverRemitente(env: NodeJS.ProcessEnv, remitenteBd?: string | null, condominio?: string | null): string | null {
  const fuente = parsearRemitente(remitenteBd) ? remitenteBd!.trim() : env.MAIL_FROM?.trim() || null;
  const base = parsearRemitente(fuente);
  // MAIL_FROM con un formato que no reconocemos: se manda tal cual, como siempre (no se le puede cambiar el nombre).
  if (!base) return fuente;
  const nombreCondo = condominio?.trim() ? nombreViaTorre(condominio) : '';
  if (nombreCondo) return armar(nombreCondo, base.direccion);
  return fuente;
}
