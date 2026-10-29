/**
 * Catálogo de países y monedas, compartido por el frontend (`src/ui`, `src/pages`) y el servidor (`src/server`): no importa nada de ninguno
 * de los dos, así que el mismo archivo los sirve a ambos. Cada condominio lleva su `pais` (código ISO 3166-1 alfa-2) y su `moneda`
 * (ISO 4217); el país propone la moneda, pero se puede cambiar.
 *
 * `zona_horaria` e `impuesto` son referencia para las fases siguientes (hora de los avisos y vencimientos; IGV/IVA): hoy nadie los usa.
 */

export interface Moneda {
  /** ISO 4217. */
  codigo: string;
  simbolo: string;
  /** En español, para listas y mensajes: «Sol peruano». */
  nombre: string;
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
  /** IANA. */
  zona_horaria: string;
  /** Impuesto general al consumo de referencia; `null` donde no hay uno nacional (EE. UU.: cambia por estado). */
  impuesto: Impuesto | null;
}

export const MONEDAS: readonly Moneda[] = [
  { codigo: 'PEN', simbolo: 'S/', nombre: 'Sol peruano', decimales: 2, locale: 'es-PE', posicion: 'antes' },
  { codigo: 'USD', simbolo: 'US$', nombre: 'Dólar estadounidense', decimales: 2, locale: 'en-US', posicion: 'antes' },
  { codigo: 'EUR', simbolo: '€', nombre: 'Euro', decimales: 2, locale: 'es-ES', posicion: 'despues' },
  { codigo: 'CLP', simbolo: '$', nombre: 'Peso chileno', decimales: 0, locale: 'es-CL', posicion: 'antes' },
  { codigo: 'COP', simbolo: '$', nombre: 'Peso colombiano', decimales: 0, locale: 'es-CO', posicion: 'antes' },
  { codigo: 'MXN', simbolo: '$', nombre: 'Peso mexicano', decimales: 2, locale: 'es-MX', posicion: 'antes' },
  { codigo: 'ARS', simbolo: '$', nombre: 'Peso argentino', decimales: 2, locale: 'es-AR', posicion: 'antes' },
  { codigo: 'BOB', simbolo: 'Bs', nombre: 'Boliviano', decimales: 2, locale: 'es-BO', posicion: 'antes' },
  { codigo: 'UYU', simbolo: '$U', nombre: 'Peso uruguayo', decimales: 2, locale: 'es-UY', posicion: 'antes' },
  { codigo: 'PYG', simbolo: '₲', nombre: 'Guaraní paraguayo', decimales: 0, locale: 'es-PY', posicion: 'antes' },
  { codigo: 'GTQ', simbolo: 'Q', nombre: 'Quetzal guatemalteco', decimales: 2, locale: 'es-GT', posicion: 'antes' },
  { codigo: 'CRC', simbolo: '₡', nombre: 'Colón costarricense', decimales: 2, locale: 'es-CR', posicion: 'antes' },
  { codigo: 'DOP', simbolo: 'RD$', nombre: 'Peso dominicano', decimales: 2, locale: 'es-DO', posicion: 'antes' },
  { codigo: 'BRL', simbolo: 'R$', nombre: 'Real brasileño', decimales: 2, locale: 'pt-BR', posicion: 'antes' },
  { codigo: 'HNL', simbolo: 'L', nombre: 'Lempira hondureño', decimales: 2, locale: 'es-HN', posicion: 'antes' },
  { codigo: 'NIO', simbolo: 'C$', nombre: 'Córdoba nicaragüense', decimales: 2, locale: 'es-NI', posicion: 'antes' },
  { codigo: 'VES', simbolo: 'Bs.S', nombre: 'Bolívar venezolano', decimales: 2, locale: 'es-VE', posicion: 'antes' },
];

const pais = (codigo: string, nombre: string, bandera: string, moneda: string, zona_horaria: string, impuesto: Impuesto | null): Pais => ({ codigo, nombre, bandera, moneda, zona_horaria, impuesto });

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

export const CODIGOS_PAIS = PAISES.map((p) => p.codigo) as [string, ...string[]];
export const CODIGOS_MONEDA = MONEDAS.map((m) => m.codigo) as [string, ...string[]];

export const paisDe = (codigo: string | null | undefined): Pais | undefined => PAISES.find((p) => p.codigo === codigo);
export const monedaDe = (codigo: string | null | undefined): Moneda | undefined => MONEDAS.find((m) => m.codigo === codigo);

/** La moneda que se propone para un país (soles si no se conoce). */
export const monedaDelPais = (codigo: string | null | undefined): string => paisDe(codigo)?.moneda ?? MONEDA_POR_DEFECTO;

type Numerico = { toFixed(d: number): string } | number | string | null | undefined;

const formatos = new Map<string, Intl.NumberFormat>();
function formatoNumero(m: Moneda): Intl.NumberFormat {
  let f = formatos.get(m.codigo);
  if (!f) {
    f = new Intl.NumberFormat(m.locale, { minimumFractionDigits: m.decimales, maximumFractionDigits: m.decimales, useGrouping: 'always' });
    formatos.set(m.codigo, f);
  }
  return f;
}

/**
 * Monto con el símbolo, los decimales y los separadores de su moneda: `S/ 1,234.50`, `US$ 20.00`, `$ 1.234.568` (CLP, sin decimales),
 * `1.234,50 €`. Una moneda desconocida se muestra con su código. `espacio` es lo que separa el símbolo del número (el frontend usa un
 * espacio duro para que no se parta la línea; los textos del servidor, uno normal). Un valor no numérico cuenta como 0.
 *
 * Un `Decimal` de Prisma (o cualquier cosa con `toFixed`) se pasa por su texto exacto, sin convertirlo antes a `number`.
 */
export function formatoDinero(valor: Numerico, moneda: string | null | undefined, espacio = ' '): string {
  const m = monedaDe(moneda ?? MONEDA_POR_DEFECTO);
  const n = typeof valor === 'object' && valor !== null ? Number(valor.toFixed(m?.decimales ?? 2)) : Number(valor ?? 0);
  const x = Number.isFinite(n) ? n : 0;
  if (!m) return `${moneda} ${x.toFixed(2)}`.replace(' ', espacio);
  const num = formatoNumero(m).format(Math.abs(x));
  const signo = x < 0 && Number(num.replace(/[^\d]/g, '')) !== 0 ? '-' : '';
  return m.posicion === 'despues' ? `${signo}${num}${espacio}${m.simbolo}` : `${signo}${m.simbolo}${espacio}${num}`;
}

/** Cuántos decimales lleva una moneda (2 si no se conoce). */
export const decimalesDe = (moneda: string | null | undefined): number => monedaDe(moneda)?.decimales ?? 2;
