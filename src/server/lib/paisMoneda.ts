import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../middleware/auth';
import { scopeComplejos, scopeRecibos } from './scope';
import { CODIGOS_MONEDA, CODIGOS_PAIS, MONEDA_POR_DEFECTO, PAIS_POR_DEFECTO, esZonaHoraria, monedaDe, monedaDelPais, paisDe, zonaDelPais } from '../../lib/paises';
import { prisma } from '../db';
import { conflict } from '../errors';
import { z } from '../validation';

/** País (ISO 3166-1 alfa-2) y moneda (ISO 4217) del catálogo `src/lib/paises.ts`; cualquier otro código → 422. */
export const paisSchema = z.enum(CODIGOS_PAIS, { error: 'País inválido' });
export const monedaSchema = z.enum(CODIGOS_MONEDA, { error: 'Moneda inválida' });

/** Zona horaria IANA de un condominio: cualquiera que `Intl` conozca (el selector ofrece las del país, pero un condominio puede estar en otra). */
export const zonaSchema = z.string({ error: 'Zona horaria inválida' }).refine(esZonaHoraria, 'Zona horaria inválida (usa una zona IANA, p. ej. America/Lima)');

/** País con el que nace un condominio: el pedido, si no el de su empresa, si no Perú. */
export async function paisInicial(pedido: string | undefined, empresa_id: number | null | undefined): Promise<string> {
  if (pedido) return pedido;
  if (empresa_id == null) return PAIS_POR_DEFECTO;
  const e = await prisma.empresaAdministradora.findUnique({ where: { id: empresa_id }, select: { pais: true } });
  return paisDe(e?.pais)?.codigo ?? PAIS_POR_DEFECTO;
}

/** Moneda con la que nace un condominio: la pedida o, si no, la de su país. */
export const monedaInicial = (pedida: string | undefined, pais: string): string => pedida ?? monedaDelPais(pais);

/** Zona con la que nace un condominio: la pedida o, si no, la de su país. */
export const zonaInicial = (pedida: string | undefined, pais: string): string => pedida ?? zonaDelPais(pais);

/** La moneda de un condominio con recibos ya no cambia (sus montos quedarían en otra unidad). Sin recibos o sin cambio, no hace nada. */
export async function verificarCambioDeMoneda(complejo_id: number, actual: string, nueva: string | undefined): Promise<void> {
  if (nueva === undefined || nueva === actual) return;
  if ((await prisma.recibo.count({ where: { complejo_id } })) > 0) throw conflict(`Este condominio ya tiene recibos en ${monedaDe(actual)?.codigo ?? actual}; no se puede cambiar`);
}

/** Moneda de un recibo = la de su condominio (soles si no tiene condominio). */
export async function monedaDeRecibo(recibo_id: number): Promise<string> {
  const r = await prisma.recibo.findUnique({ where: { id: recibo_id }, select: { complejo: { select: { moneda: true } } } });
  return r?.complejo?.moneda ?? MONEDA_POR_DEFECTO;
}

/** Moneda de un condominio por su id (soles si no existe o viene vacía: así nacieron todos). */
export async function monedaDeComplejo(complejo_id: number | null | undefined): Promise<string> {
  if (complejo_id == null) return MONEDA_POR_DEFECTO;
  const c = await prisma.complejoHabitacional.findUnique({ where: { id: complejo_id }, select: { moneda: true } });
  return c?.moneda ?? MONEDA_POR_DEFECTO;
}

// ---------- Montos por moneda ----------
// Nunca se suman montos de monedas distintas. Los agregados que cruzan condominios se calculan UNA VEZ POR MONEDA con estos filtros; si todo
// el alcance es de una sola moneda, no cambia nada (se devuelve esa moneda y los mismos totales de siempre).

/** Recibos de los condominios de esa moneda (los recibos sin condominio, viejos, cuentan como soles: así nacieron todos). */
export const reciboEnMoneda = (m: string): Prisma.ReciboWhereInput =>
  m === MONEDA_POR_DEFECTO ? { OR: [{ complejo: { moneda: m } }, { complejo_id: null }] } : { complejo: { moneda: m } };
export const cargoEnMoneda = (m: string): Prisma.ReciboConceptoUnidadWhereInput => ({ reciboConcepto: { recibo: reciboEnMoneda(m) } });
export const pagoEnMoneda = (m: string): Prisma.PagoWhereInput => ({ reciboConceptoUnidad: cargoEnMoneda(m) });

/** Las monedas (ordenadas) de los recibos que cumplen el filtro y de los condominios del alcance; sin ninguno, soles. */
export async function monedasDelAlcance(recibos: Prisma.ReciboWhereInput, complejos: Prisma.ComplejoHabitacionalWhereInput = {}): Promise<string[]> {
  const [r, c] = await Promise.all([
    prisma.recibo.findMany({ where: recibos, distinct: ['complejo_id'], select: { complejo: { select: { moneda: true } } } }),
    prisma.complejoHabitacional.findMany({ where: complejos, distinct: ['moneda'], select: { moneda: true } }),
  ]);
  const set = new Set<string>([...r.map((x) => x.complejo?.moneda ?? MONEDA_POR_DEFECTO), ...c.map((x) => x.moneda)]);
  return set.size ? [...set].sort() : [MONEDA_POR_DEFECTO];
}

/**
 * Las monedas (ordenadas) de lo que esta persona alcanza: la administración, sus condominios y recibos; el residente, los de sus unidades;
 * el personal y la junta, el de su condominio. Es la `moneda` que etiqueta las respuestas de las herramientas del asistente y del MCP.
 */
export async function monedasDeUsuario(u: AuthUser): Promise<string[]> {
  if (u.rol === 'superadmin' || u.rol === 'admin') return monedasDelAlcance(scopeRecibos(u), scopeComplejos(u));
  if (u.rol === 'propietario' || u.rol === 'inquilino') {
    const propias: Prisma.UnidadWhereInput = u.rol === 'propietario' ? { propietario_id: u.id } : { inquilino_id: u.id };
    return monedasDelAlcance({ reciboConceptos: { some: { reciboConceptoUnidades: { some: { unidad: propias } } } } }, { unidades: { some: propias } });
  }
  return u.complejo_id != null ? monedasDelAlcance({ complejo_id: u.complejo_id }, { id: u.complejo_id }) : [MONEDA_POR_DEFECTO];
}

/** Corre `calcular` una vez por moneda → `{ PEN: …, USD: … }`. */
export async function porMoneda<T>(monedas: string[], calcular: (moneda: string) => Promise<T>): Promise<Record<string, T>> {
  return Object.fromEntries(await Promise.all(monedas.map(async (m) => [m, await calcular(m)] as const)));
}
