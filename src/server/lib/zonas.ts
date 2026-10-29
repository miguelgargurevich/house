import { Prisma } from '@prisma/client';
import { ZONA_POR_DEFECTO } from '../../lib/paises';
import { prisma } from '../db';
import { hoyEn, inicioAnioEn, inicioMesEn, mesesHasta } from './fechas';

/**
 * El día de cada condominio es el de SU zona (`ComplejoHabitacional.zona_horaria`). Cuando una consulta cruza condominios (un admin con varios, el
 * panel, la mora de muchos recibos) no hay un solo «hoy»: `Reloj` calcula el de cada zona EN USO para un instante, y los filtros de abajo arman un
 * `OR` con un tramo por cada grupo de zonas que comparten día. Si todas comparten el mismo (lo normal: todo en una zona, o varias del mismo
 * desfase), el filtro es el de siempre, sin tramos. Lo que no tiene condominio (recibos viejos) cuenta con la hora de Lima.
 */
export interface Dia {
  /** Fecha de calendario (00:00 UTC) de hoy. */
  hoy: Date;
  /** Instante en que empezó el mes / el año en la zona. */
  inicioMes: Date;
  inicioAnio: Date;
}

export interface Reloj {
  ahora: Date;
  /** Zonas en uso (distintas); Lima siempre está (es la de lo que no tiene condominio). */
  zonas: string[];
  /** Las zonas que se pidieron, sin la de Lima de relleno. */
  propias: string[];
  /** Hoy en esa zona (Lima si no hay: lo que no tiene condominio). */
  hoy(zona?: string | null): Date;
  inicioMes(zona?: string | null): Date;
  inicioAnio(zona?: string | null): Date;
  /** El «hoy» más adelantado de las zonas propias (Lima si no hay ninguna): hasta dónde llega una serie de meses. */
  hoyMasReciente(): Date;
  /** Las zonas agrupadas por día: una sola entrada si todas comparten el mismo. Con `soloHoy` sólo cuenta el «hoy» (lo que usan los filtros de estado y de avisos). */
  grupos(soloHoy?: boolean): { dia: Dia; zonas: string[] }[];
}

export function relojDe(zonas: Iterable<string | null | undefined> = [], ahora: Date = new Date()): Reloj {
  const propias = [...new Set([...zonas].filter((z): z is string => !!z))].sort();
  const en = [...new Set([ZONA_POR_DEFECTO, ...propias])].sort();
  const hoy = new Map<string, Date>();
  const mes = new Map<string, Date>();
  const anio = new Map<string, Date>();
  const memo = <T>(m: Map<string, T>, zona: string, calcular: () => T): T => m.get(zona) ?? m.set(zona, calcular()).get(zona)!;
  const r: Reloj = {
    ahora,
    zonas: en,
    propias,
    hoy: (z) => memo(hoy, z || ZONA_POR_DEFECTO, () => hoyEn(z || ZONA_POR_DEFECTO, ahora)),
    inicioMes: (z) => memo(mes, z || ZONA_POR_DEFECTO, () => inicioMesEn(z || ZONA_POR_DEFECTO, ahora)),
    inicioAnio: (z) => memo(anio, z || ZONA_POR_DEFECTO, () => inicioAnioEn(z || ZONA_POR_DEFECTO, ahora)),
    hoyMasReciente: () => new Date(Math.max(...(propias.length ? propias : [ZONA_POR_DEFECTO]).map((z) => r.hoy(z).getTime()))),
    grupos: (soloHoy = false) => agrupar(r, (z) => ({ hoy: r.hoy(z), inicioMes: r.inicioMes(z), inicioAnio: r.inicioAnio(z) }), (d) => (soloHoy ? String(d.hoy.getTime()) : `${d.hoy.getTime()}|${d.inicioMes.getTime()}|${d.inicioAnio.getTime()}`)).map((g) => ({ dia: g.valor, zonas: g.zonas })),
  };
  return r;
}

/** El reloj de las zonas que hay hoy en la base (una consulta chica: un renglón por zona distinta), o sólo las de `donde`. `ahora` se inyecta en las pruebas. */
export async function relojDeCondominios(ahora: Date = new Date(), donde: Prisma.ComplejoHabitacionalWhereInput = {}): Promise<Reloj> {
  const zonas = await prisma.complejoHabitacional.findMany({ where: donde, distinct: ['zona_horaria'], select: { zona_horaria: true } });
  return relojDe(zonas.map((z) => z.zona_horaria), ahora);
}

/** El reloj de las zonas de los condominios de unos recibos (el alcance de quien consulta). */
export const relojDeRecibos = (recibos: Prisma.ReciboWhereInput, ahora: Date = new Date()): Promise<Reloj> => relojDeCondominios(ahora, { recibos: { some: recibos } });

/** Zona de un condominio por su id (Lima si no existe o no se dice: así nacieron todos). */
export async function zonaDeComplejo(complejoId: number | null | undefined): Promise<string> {
  if (complejoId == null) return ZONA_POR_DEFECTO;
  const c = await prisma.complejoHabitacional.findUnique({ where: { id: complejoId }, select: { zona_horaria: true } });
  return c?.zona_horaria ?? ZONA_POR_DEFECTO;
}

/** Zonas de varios condominios: `Map<id, zona>` (los que no existen no salen). */
export async function zonasDeComplejos(ids: Iterable<number>): Promise<Map<number, string>> {
  const lista = [...new Set(ids)];
  if (!lista.length) return new Map();
  const cs = await prisma.complejoHabitacional.findMany({ where: { id: { in: lista } }, select: { id: true, zona_horaria: true } });
  return new Map(cs.map((c) => [c.id, c.zona_horaria]));
}

/** Zona de una persona: la de su condominio (por su ficha) o, si no tiene, la del condominio de su primera unidad; Lima si ninguno (superadmin, admin sin condominio). */
export async function zonaDeUsuario(u: { id: number; complejo_id?: number | null }): Promise<string> {
  if (u.complejo_id != null) return zonaDeComplejo(u.complejo_id);
  const un = await prisma.unidad.findFirst({ where: { OR: [{ propietario_id: u.id }, { inquilino_id: u.id }], complejo_id: { not: null } }, orderBy: { id: 'asc' }, select: { complejo: { select: { zona_horaria: true } } } });
  return un?.complejo?.zona_horaria ?? ZONA_POR_DEFECTO;
}

/** Zona de un recibo = la de su condominio (Lima si no tiene). */
export async function zonaDeRecibo(reciboId: number): Promise<string> {
  const r = await prisma.recibo.findUnique({ where: { id: reciboId }, select: { complejo: { select: { zona_horaria: true } } } });
  return r?.complejo?.zona_horaria ?? ZONA_POR_DEFECTO;
}

// ---------- Filtros que dependen del día de la zona ----------

/** Agrupa las zonas del reloj por el valor que `de` les calcula (zonas con el mismo valor van juntas). */
function agrupar<V>(reloj: Reloj, de: (zona: string) => V, clave: (v: V) => string): { valor: V; zonas: string[] }[] {
  const porClave = new Map<string, { valor: V; zonas: string[] }>();
  for (const z of reloj.zonas) {
    const valor = de(z);
    const g = porClave.get(clave(valor)) ?? porClave.set(clave(valor), { valor, zonas: [] }).get(clave(valor))!;
    g.zonas.push(z);
  }
  return [...porClave.values()];
}

/** Los recibos de un grupo de zonas. El grupo de Lima también se queda con los recibos sin condominio y con los de una zona que el reloj aún no conocía. */
function reciboEnGrupo(reloj: Reloj, zonas: string[]): Prisma.ReciboWhereInput {
  const propias: Prisma.ReciboWhereInput = { complejo: { zona_horaria: { in: zonas } } };
  if (!zonas.includes(ZONA_POR_DEFECTO)) return propias;
  return { OR: [propias, { complejo_id: null }, { complejo: { zona_horaria: { notIn: reloj.zonas } } }] };
}

/**
 * Arma un filtro que depende de la zona: `f(valor)` por cada grupo de zonas que comparten `valor` (el día de hoy, los límites de un mes…), cada
 * uno acotado a los recibos de esas zonas (`via` lleva ese filtro de recibos a la tabla que se consulta). Con un solo grupo devuelve `f(valor)` tal cual.
 */
function segunZona<V, W>(reloj: Reloj, de: (zona: string) => V, clave: (v: V) => string, f: (v: V) => W, via: (r: Prisma.ReciboWhereInput) => W): W {
  const grupos = agrupar(reloj, de, clave);
  if (grupos.length === 1) return f(grupos[0]!.valor);
  return { OR: grupos.map((g) => ({ AND: [via(reciboEnGrupo(reloj, g.zonas)), f(g.valor)] })) } as W;
}

/** Cómo se agrupan las zonas según lo que use el filtro: `soloHoy` (estados, avisos) o también el inicio del mes y del año («cobrado este mes»). */
const deHoy = (reloj: Reloj, soloHoy: boolean) => ({
  de: (z: string): Dia => ({ hoy: reloj.hoy(z), inicioMes: reloj.inicioMes(z), inicioAnio: reloj.inicioAnio(z) }),
  clave: (d: Dia) => (soloHoy ? String(d.hoy.getTime()) : `${d.hoy.getTime()}|${d.inicioMes.getTime()}|${d.inicioAnio.getTime()}`),
});
const viaCargo = (recibo: Prisma.ReciboWhereInput): Prisma.ReciboConceptoUnidadWhereInput => ({ reciboConcepto: { recibo } });
const viaPago = (recibo: Prisma.ReciboWhereInput): Prisma.PagoWhereInput => ({ reciboConceptoUnidad: { reciboConcepto: { recibo } } });

/** Filtro de recibos según el «hoy» de la zona de su condominio (`f` sólo debe usar `hoy`). */
export const reciboSegunZona = (reloj: Reloj, f: (d: Dia) => Prisma.ReciboWhereInput): Prisma.ReciboWhereInput => segunZona(reloj, deHoy(reloj, true).de, deHoy(reloj, true).clave, f, (r) => r);

/** Filtro de cargos según el «hoy» de la zona del condominio de su recibo (`f` sólo debe usar `hoy`). */
export const cargoSegunZona = (reloj: Reloj, f: (d: Dia) => Prisma.ReciboConceptoUnidadWhereInput): Prisma.ReciboConceptoUnidadWhereInput => segunZona(reloj, deHoy(reloj, true).de, deHoy(reloj, true).clave, f, viaCargo);

/** Filtro de pagos según el día, el mes o el año de la zona del condominio del recibo de su cargo. */
export const pagoSegunZona = (reloj: Reloj, f: (d: Dia) => Prisma.PagoWhereInput): Prisma.PagoWhereInput => segunZona(reloj, deHoy(reloj, false).de, deHoy(reloj, false).clave, f, viaPago);

/** Los pagos cuya `fecha_pago` cae en el mes (`anio`, `mes` 1–12) de la zona del condominio de su recibo: el mismo instante puede ser de octubre en Lima y de noviembre en Madrid. */
export function pagoEnMes(reloj: Reloj, anio: number, mes: number): Prisma.PagoWhereInput {
  return segunZona(reloj, (z) => mesesHasta(1, anio, mes, z)[0]!, (m) => `${m.desde.getTime()}|${m.hasta.getTime()}`, (m) => ({ fecha_pago: { gte: m.desde, lt: m.hasta } }), viaPago);
}

/**
 * El «hoy» en SQL crudo: `columnaZona` es la columna `zona_horaria` del condominio del recibo (puede venir NULL en un LEFT JOIN: es Lima).
 * Con un solo grupo es el parámetro de siempre; con varios, un `CASE` por zona.
 */
export function sqlHoy(reloj: Reloj, columnaZona: Prisma.Sql): Prisma.Sql {
  const grupos = reloj.grupos(true);
  if (grupos.length === 1) return Prisma.sql`${grupos[0]!.dia.hoy}`;
  const lima = grupos.find((g) => g.zonas.includes(ZONA_POR_DEFECTO))!;
  const tramos = grupos.filter((g) => g !== lima).map((g) => Prisma.sql`WHEN ${columnaZona} IN (${Prisma.join(g.zonas)}) THEN ${g.dia.hoy}`);
  return Prisma.sql`CASE ${Prisma.join(tramos, ' ')} ELSE ${lima.dia.hoy} END`;
}
