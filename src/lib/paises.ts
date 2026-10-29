/**
 * Catálogo de países y monedas, compartido por el frontend (`src/ui`, `src/pages`) y el servidor (`src/server`): no importa nada de ninguno
 * de los dos, así que el mismo archivo los sirve a ambos. Cada condominio lleva su `pais` (código ISO 3166-1 alfa-2) y su `moneda`
 * (ISO 4217); el país propone la moneda, pero se puede cambiar.
 *
 * `zona_horaria` es la zona IANA que se propone al crear un condominio del país (la hora de sus vencimientos, mora y avisos; `zonas` son las
 * que ofrece el selector donde el país tiene varias). `impuesto` es referencia para la fase siguiente (IGV/IVA): hoy nadie lo usa.
 */

export interface Moneda {
  /** ISO 4217. */
  codigo: string;
  simbolo: string;
  /** En español, para listas y mensajes: «Sol peruano». */
  nombre: string;
  /** En plural y en minúsculas, para frases: «Últimos 6 meses, en dólares». */
  plural: string;
  /** Decimales con los que se muestra y se cobra (CLP y PYG no tienen centavos). */
  decimales: number;
  /** Cómo se escriben los miles y los decimales en esa moneda (`Intl`). */
  locale: string;
  /** `despues`: «1.234,50 €» (el euro); `antes`: «S/ 1,234.50». */
  posicion: 'antes' | 'despues';
}

export interface Impuesto {
  /** «IGV», «IVA», «ITBIS»… */
  nombre: string;
  /** Tasa general en porcentaje (18 = 18 %). */
  tasa: number;
}

export interface Pais {
  /** ISO 3166-1 alfa-2. */
  codigo: string;
  nombre: string;
  /** Emoji de la bandera. */
  bandera: string;
  /** Moneda que se propone al elegir el país (código de `MONEDAS`). */
  moneda: string;
  /** IANA. La que se propone al crear un condominio del país. */
  zona_horaria: string;
  /** Todas las zonas IANA del país (la de arriba incluida) para el selector del condominio. */
  zonas: readonly string[];
  /** Impuesto general al consumo de referencia; `null` donde no hay uno nacional (EE. UU.: cambia por estado). */
  impuesto: Impuesto | null;
}

export const MONEDAS: readonly Moneda[] = [
  { codigo: 'PEN', simbolo: 'S/', nombre: 'Sol peruano', plural: 'soles', decimales: 2, locale: 'es-PE', posicion: 'antes' },
  { codigo: 'USD', simbolo: 'US$', nombre: 'Dólar estadounidense', plural: 'dólares', decimales: 2, locale: 'en-US', posicion: 'antes' },
  { codigo: 'EUR', simbolo: '€', nombre: 'Euro', plural: 'euros', decimales: 2, locale: 'es-ES', posicion: 'despues' },
  { codigo: 'CLP', simbolo: '$', nombre: 'Peso chileno', plural: 'pesos chilenos', decimales: 0, locale: 'es-CL', posicion: 'antes' },
  { codigo: 'COP', simbolo: '$', nombre: 'Peso colombiano', plural: 'pesos colombianos', decimales: 0, locale: 'es-CO', posicion: 'antes' },
  { codigo: 'MXN', simbolo: '$', nombre: 'Peso mexicano', plural: 'pesos mexicanos', decimales: 2, locale: 'es-MX', posicion: 'antes' },
  { codigo: 'ARS', simbolo: '$', nombre: 'Peso argentino', plural: 'pesos argentinos', decimales: 2, locale: 'es-AR', posicion: 'antes' },
  { codigo: 'BOB', simbolo: 'Bs', nombre: 'Boliviano', plural: 'bolivianos', decimales: 2, locale: 'es-BO', posicion: 'antes' },
  { codigo: 'UYU', simbolo: '$U', nombre: 'Peso uruguayo', plural: 'pesos uruguayos', decimales: 2, locale: 'es-UY', posicion: 'antes' },
  { codigo: 'PYG', simbolo: '₲', nombre: 'Guaraní paraguayo', plural: 'guaraníes', decimales: 0, locale: 'es-PY', posicion: 'antes' },
  { codigo: 'GTQ', simbolo: 'Q', nombre: 'Quetzal guatemalteco', plural: 'quetzales', decimales: 2, locale: 'es-GT', posicion: 'antes' },
  { codigo: 'CRC', simbolo: '₡', nombre: 'Colón costarricense', plural: 'colones', decimales: 2, locale: 'es-CR', posicion: 'antes' },
  { codigo: 'DOP', simbolo: 'RD$', nombre: 'Peso dominicano', plural: 'pesos dominicanos', decimales: 2, locale: 'es-DO', posicion: 'antes' },
  { codigo: 'BRL', simbolo: 'R$', nombre: 'Real brasileño', plural: 'reales', decimales: 2, locale: 'pt-BR', posicion: 'antes' },
  { codigo: 'HNL', simbolo: 'L', nombre: 'Lempira hondureño', plural: 'lempiras', decimales: 2, locale: 'es-HN', posicion: 'antes' },
  { codigo: 'NIO', simbolo: 'C$', nombre: 'Córdoba nicaragüense', plural: 'córdobas', decimales: 2, locale: 'es-NI', posicion: 'antes' },
  { codigo: 'VES', simbolo: 'Bs.S', nombre: 'Bolívar venezolano', plural: 'bolívares', decimales: 2, locale: 'es-VE', posicion: 'antes' },
];

/** Países con varias zonas horarias: las IANA que se ofrecen (la primera es la que se propone). El resto tiene una sola. */
const ZONAS_VARIAS: Record<string, readonly string[]> = {
  MX: ['America/Mexico_City', 'America/Cancun', 'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana'],
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
  BR: ['America/Sao_Paulo', 'America/Fortaleza', 'America/Manaus', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha'],
  AR: ['America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba', 'America/Argentina/Salta', 'America/Argentina/Mendoza', 'America/Argentina/Ushuaia'],
  CL: ['America/Santiago', 'America/Punta_Arenas', 'Pacific/Easter'],
  EC: ['America/Guayaquil', 'Pacific/Galapagos'],
  ES: ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'],
};

const pais = (codigo: string, nombre: string, bandera: string, moneda: string, zona_horaria: string, impuesto: Impuesto | null): Pais => ({ codigo, nombre, bandera, moneda, zona_horaria, zonas: ZONAS_VARIAS[codigo] ?? [zona_horaria], impuesto });

export const PAISES: readonly Pais[] = [
  pais('PE', 'Perú', '🇵🇪', 'PEN', 'America/Lima', { nombre: 'IGV', tasa: 18 }),
  pais('AR', 'Argentina', '🇦🇷', 'ARS', 'America/Argentina/Buenos_Aires', { nombre: 'IVA', tasa: 21 }),
  pais('BO', 'Bolivia', '🇧🇴', 'BOB', 'America/La_Paz', { nombre: 'IVA', tasa: 13 }),
  pais('BR', 'Brasil', '🇧🇷', 'BRL', 'America/Sao_Paulo', null),
  pais('CL', 'Chile', '🇨🇱', 'CLP', 'America/Santiago', { nombre: 'IVA', tasa: 19 }),
  pais('CO', 'Colombia', '🇨🇴', 'COP', 'America/Bogota', { nombre: 'IVA', tasa: 19 }),
  pais('CR', 'Costa Rica', '🇨🇷', 'CRC', 'America/Costa_Rica', { nombre: 'IVA', tasa: 13 }),
  pais('DO', 'República Dominicana', '🇩🇴', 'DOP', 'America/Santo_Domingo', { nombre: 'ITBIS', tasa: 18 }),
  pais('EC', 'Ecuador', '🇪🇨', 'USD', 'America/Guayaquil', { nombre: 'IVA', tasa: 15 }),
  pais('SV', 'El Salvador', '🇸🇻', 'USD', 'America/El_Salvador', { nombre: 'IVA', tasa: 13 }),
  pais('ES', 'España', '🇪🇸', 'EUR', 'Europe/Madrid', { nombre: 'IVA', tasa: 21 }),
  pais('US', 'Estados Unidos', '🇺🇸', 'USD', 'America/New_York', null),
  pais('GT', 'Guatemala', '🇬🇹', 'GTQ', 'America/Guatemala', { nombre: 'IVA', tasa: 12 }),
  pais('HN', 'Honduras', '🇭🇳', 'HNL', 'America/Tegucigalpa', { nombre: 'ISV', tasa: 15 }),
  pais('MX', 'México', '🇲🇽', 'MXN', 'America/Mexico_City', { nombre: 'IVA', tasa: 16 }),
  pais('NI', 'Nicaragua', '🇳🇮', 'NIO', 'America/Managua', { nombre: 'IVA', tasa: 15 }),
  pais('PA', 'Panamá', '🇵🇦', 'USD', 'America/Panama', { nombre: 'ITBMS', tasa: 7 }),
  pais('PY', 'Paraguay', '🇵🇾', 'PYG', 'America/Asuncion', { nombre: 'IVA', tasa: 10 }),
  pais('UY', 'Uruguay', '🇺🇾', 'UYU', 'America/Montevideo', { nombre: 'IVA', tasa: 22 }),
  pais('VE', 'Venezuela', '🇻🇪', 'VES', 'America/Caracas', { nombre: 'IVA', tasa: 16 }),
];

export const PAIS_POR_DEFECTO = 'PE';
export const MONEDA_POR_DEFECTO = 'PEN';
/** La hora con la que nacieron todos los condominios (y la de lo que no tiene condominio): Lima. */
export const ZONA_POR_DEFECTO = 'America/Lima';

export const CODIGOS_PAIS = PAISES.map((p) => p.codigo) as [string, ...string[]];
export const CODIGOS_MONEDA = MONEDAS.map((m) => m.codigo) as [string, ...string[]];

export const paisDe = (codigo: string | null | undefined): Pais | undefined => PAISES.find((p) => p.codigo === codigo);
export const monedaDe = (codigo: string | null | undefined): Moneda | undefined => MONEDAS.find((m) => m.codigo === codigo);

/** La moneda que se propone para un país (soles si no se conoce). */
export const monedaDelPais = (codigo: string | null | undefined): string => paisDe(codigo)?.moneda ?? MONEDA_POR_DEFECTO;

/** La zona horaria que se propone para un país (la de Lima si no se conoce). */
export const zonaDelPais = (codigo: string | null | undefined): string => paisDe(codigo)?.zona_horaria ?? ZONA_POR_DEFECTO;

/** Las zonas que ofrece el selector de un país (sólo la de Lima si no se conoce). */
export const zonasDe = (codigo: string | null | undefined): readonly string[] => paisDe(codigo)?.zonas ?? [ZONA_POR_DEFECTO];

/**
 * ¿Es una zona IANA que `Intl` conoce («America/Lima», «UTC»)? Se exige la forma `Region/Ciudad`: `Intl` también acepta desfases sueltos
 * («+05:00») que no respetan el horario de verano, y esos no sirven como zona de un condominio.
 */
export function esZonaHoraria(zona: unknown): zona is string {
  if (typeof zona !== 'string' || !/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+)+)$/.test(zona)) return false;
  try {
    new Intl.DateTimeFormat('es', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

type Numerico = { toFixed(d: number): string } | number | string | null | undefined;

const formatos = new Map<string, Intl.NumberFormat>();
function formatoNumero(m: Moneda, decimales: number): Intl.NumberFormat {
  const clave = `${m.codigo}:${decimales}`;
  let f = formatos.get(clave);
  if (!f) {
    f = new Intl.NumberFormat(m.locale, { minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: 'always' as unknown as boolean }) // 'always' es de ES2023: el motor lo entiende aunque el tipo del navegador aún no;
    formatos.set(clave, f);
  }
  return f;
}

/**
 * Monto con el símbolo, los decimales y los separadores de su moneda: `S/ 1,234.50`, `US$ 20.00`, `$ 1.234.568` (CLP, sin decimales),
 * `1.234,50 €`. Una moneda desconocida se muestra con su código. `espacio` es lo que separa el símbolo del número (el frontend usa un
 * espacio duro para que no se parta la línea; los textos del servidor, uno normal). Un valor no numérico cuenta como 0.
 *
 * Un `Decimal` de Prisma (o cualquier cosa con `toFixed`) se pasa por su texto exacto, sin convertirlo antes a `number`.
 * `sinCerosDeMas`: un monto entero sale sin decimales (`S/ 20`, no `S/ 20.00`), para frases como «una mora de S/ 20».
 */
export function formatoDinero(valor: Numerico, moneda: string | null | undefined, espacio = ' ', sinCerosDeMas = false): string {
  const m = monedaDe(moneda ?? MONEDA_POR_DEFECTO);
  const n = typeof valor === 'object' && valor !== null ? Number(valor.toFixed(m?.decimales ?? 2)) : Number(valor ?? 0);
  const x = Number.isFinite(n) ? n : 0;
  if (!m) return `${moneda} ${x.toFixed(2)}`.replace(' ', espacio);
  const num = formatoNumero(m, sinCerosDeMas && Number.isInteger(x) ? 0 : m.decimales).format(Math.abs(x));
  const signo = x < 0 && Number(num.replace(/[^\d]/g, '')) !== 0 ? '-' : '';
  return m.posicion === 'despues' ? `${signo}${num}${espacio}${m.simbolo}` : `${signo}${m.simbolo}${espacio}${num}`;
}

/** Cuántos decimales lleva una moneda (2 si no se conoce). */
export const decimalesDe = (moneda: string | null | undefined): number => monedaDe(moneda)?.decimales ?? 2;

/** «soles», «dólares», «pesos chilenos»: la moneda en plural para una frase (el código si no está en el catálogo). */
export const monedaEnPlural = (codigo: string | null | undefined): string => monedaDe(codigo ?? MONEDA_POR_DEFECTO)?.plural ?? String(codigo);

/** El símbolo de una moneda para un rótulo («Monto (US$)»); soles si no se dice, el código si no está en el catálogo. */
export const simboloDe = (codigo: string | null | undefined): string => monedaDe(codigo || MONEDA_POR_DEFECTO)?.simbolo ?? String(codigo);
