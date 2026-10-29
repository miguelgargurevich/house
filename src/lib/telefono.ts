// Teléfonos de cualquier país. Lo usan el formulario (TelefonoInput), el servidor (zod, avisos, WhatsApp) y el script de normalización:
// un único criterio para que lo que el formulario acepta, el servidor también lo acepta.
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { CountryCode, PhoneNumber } from 'libphonenumber-js/max';

/** Sin «+» se asume Perú: así se leen los datos viejos y lo que escribe el bot. */
export const PAIS_POR_DEFECTO: CountryCode = 'PE';

/** Latinoamérica, España y EE. UU.: van primero en el selector. */
const PRIORITARIOS: CountryCode[] = ['AR', 'BO', 'BR', 'BZ', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'ES', 'GT', 'GY', 'HN', 'HT', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SR', 'SV', 'US', 'UY', 'VE'];

const valido = (p: PhoneNumber | undefined): PhoneNumber | null => (p?.isValid() ? p : null);

/** Con el prefijo a medias (`+1`, que sirve a varios países) el país más probable: EE. UU. antes que Puerto Rico. */
const paisDelPrefijo = (cc: string | undefined): CountryCode | undefined => (cc === '1' ? 'US' : PRIORITARIOS.find((c) => getCountryCallingCode(c) === cc));

/** Celular (móvil o «fijo o móvil», como muchos números de EE. UU.): lo único que sirve para WhatsApp, Yape o Plin. */
const esMovil = (p: PhoneNumber) => {
  const tipo = p.getType();
  return tipo === 'MOBILE' || tipo === 'FIXED_LINE_OR_MOBILE';
};

/**
 * Número válido de cualquier país. Con «+» (o «00») es internacional. Sin prefijo es peruano, y `51` + 9 dígitos
 * también es Perú, con su código (datos viejos y bots). `null` si no es un número válido.
 */
export function parsearTelefono(entrada: string | null | undefined): PhoneNumber | null {
  if (!entrada) return null;
  let d = entrada.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(d)) return null;
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (d.startsWith('+')) return valido(parsePhoneNumberFromString(d));
  if (/^51\d{9}$/.test(d)) return valido(parsePhoneNumberFromString(`+${d}`));
  return valido(parsePhoneNumberFromString(d, PAIS_POR_DEFECTO));
}

/** Como `parsearTelefono`, pero sólo acepta móviles. `null` para un fijo. */
export function parsearCelular(entrada: string | null | undefined): PhoneNumber | null {
  const p = parsearTelefono(entrada);
  return p && esMovil(p) ? p : null;
}

/** Lo que se guarda y se muestra: `+51 987 654 321`, `+56 9 6123 4567`. `null` si no es válido. */
export function formatearTelefono(entrada: string | null | undefined): string | null {
  return parsearTelefono(entrada)?.formatInternational() ?? null;
}

/** Dígitos E.164 sin «+» (`51987654321`): así se guardan los vínculos de WhatsApp. `null` si no es un celular válido. */
export function celularE164(entrada: string | null | undefined): string | null {
  const p = parsearCelular(entrada);
  return p ? p.number.slice(1) : null;
}

/**
 * País y número nacional (sólo dígitos) de un valor guardado o escrito, para pintar el campo.
 * Un valor parcial con «+» (lo que se escribe a medias) también sirve: el país sale del prefijo.
 */
export function desglosarTelefono(valor: string | null | undefined, paisActual: CountryCode = PAIS_POR_DEFECTO): { pais: CountryCode; nacional: string } {
  const v = (valor ?? '').trim();
  const completo = parsearTelefono(v);
  if (completo) return { pais: completo.country ?? paisActual, nacional: completo.nationalNumber };
  if (/^(\+|00)/.test(v)) {
    const ay = new AsYouType();
    ay.input(v.replace(/^00/, '+'));
    return { pais: ay.getCountry() ?? paisDelPrefijo(ay.getCallingCode()) ?? paisActual, nacional: ay.getNumber()?.nationalNumber ?? '' };
  }
  return { pais: paisActual, nacional: v.replace(/\D/g, '') };
}

/** El valor que recibe el formulario: `+51 987 654 321` si el número ya es completo; mientras se escribe, el prefijo y los dígitos. */
export function valorTelefono(pais: CountryCode, nacional: string): string {
  if (!nacional) return '';
  const cc = getCountryCallingCode(pais);
  return parsePhoneNumberFromString(`+${cc}${nacional}`)?.formatInternational() ?? `+${cc} ${nacional}`;
}

/** Los dígitos nacionales con el espaciado del país (`987 654 321`), mientras se escribe. */
export function formatoNacional(pais: CountryCode, nacional: string): string {
  return nacional ? new AsYouType(pais).input(nacional) : '';
}

export interface PaisTelefono { codigo: CountryCode; nombre: string; prefijo: string; bandera: string }

const nombres = new Intl.DisplayNames(['es'], { type: 'region' });
const banderaDe = (codigo: string) => [...codigo].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
const aPais = (codigo: CountryCode): PaisTelefono => ({ codigo, nombre: nombres.of(codigo) ?? codigo, prefijo: `+${getCountryCallingCode(codigo)}`, bandera: banderaDe(codigo) });
const porNombre = (a: PaisTelefono, b: PaisTelefono) => a.nombre.localeCompare(b.nombre, 'es');

/** Los países del selector: primero los de Latinoamérica, España y EE. UU.; después el resto, por nombre. */
export function paisesTelefono(): { prioritarios: PaisTelefono[]; resto: PaisTelefono[] } {
  const prioritarios = PRIORITARIOS.map(aPais).sort(porNombre);
  const marcados = new Set<string>(PRIORITARIOS);
  const resto = getCountries().filter((c) => !marcados.has(c)).map(aPais).sort(porNombre);
  return { prioritarios, resto };
}
