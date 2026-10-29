import { Prisma } from '@prisma/client';
import { ZONA_POR_DEFECTO } from '../../lib/paises';
import { prisma } from '../db';
import { hoyEn, inicioAnioEn, inicioMesEn } from './fechas';

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
  /** Zonas en uso (distintas); Lima siempre está. */
  zonas: string[];
  /** Hoy en esa zona (Lima si no hay: lo que no tiene condominio). */
  hoy(zona?: string | null): Date;
  inicioMes(zona?: string | null): Date;
  inicioAnio(zona?: string | null): Date;
  /** Las zonas agrupadas por día: una sola entrada si todas comparten el mismo. */
  grupos(): { dia: Dia; zonas: string[] }[];
}

export function relojDe(zonas: Iterable<string | null | undefined> = [], ahora: Date = new Date()): Reloj {
  const en = [...new Set([ZONA_POR_DEFECTO, ...[...zonas].filter((z): z is string => !!z)])].sort();
  const hoy = new Map<string, Date>();
  const mes = new Map<string, Date>();
  const anio = new Map<string, Date>();
  const memo = <T>(m: Map<string, T>, zona: string, calcular: () => T): T => m.get(zona) ?? m.set(zona, calcular()).get(zona)!;
  const r: Reloj = {
    ahora,
    zonas: en,
    hoy: (z) => memo(hoy, z || ZONA_POR_DEFECTO, () => hoyEn(z || ZONA_POR_DEFECTO, ahora)),
    inicioMes: (z) => memo(mes, z || ZONA_POR_DEFECTO, () => inicioMesEn(z || ZONA_POR_DEFECTO, ahora)),
    inicioAnio: (z) => memo(anio, z || ZONA_POR_DEFECTO, () => inicioAnioEn(z || ZONA_POR_DEFECTO, ahora)),
    grupos: () => {
      const porClave = new Map<string, { dia: Dia; zonas: string[] }>();
      for (const z of en) {
        const dia: Dia = { hoy: r.hoy(z), inicioMes: r.inicioMes(z), inicioAnio: r.inicioAnio(z) };
        const clave = `${dia.hoy.getTime()}|${dia.inicioMes.getTime()}|${dia.inicioAnio.getTime()}`;
        const g = porClave.get(clave) ?? porClave.set(clave, { dia, zonas: [] }).get(clave)!;
        g.zonas.push(z);
      }
      return [...porClave.values()];
    },
  };
  return r;
}

/** El reloj de las zonas que hay hoy en la base (una consulta chica: un renglón por zona distinta). `ahora` se inyecta en las pruebas. */
export async function relojDeCondominios(ahora: Date = new Date()): Promise<Reloj> {
  const zonas = await prisma.complejoHabitacional.findMany({ distinct: ['zona_horaria'], select: { zona_horaria: true } });
  return relojDe(zonas.map((z) => z.zona_horaria), ahora);
}

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

/** Zona de un recibo = la de su condominio (Lima si no tiene). */
export async function zonaDeRecibo(reciboId: number): Promise<string> {
  const r = await prisma.recibo.findUnique({ where: { id: reciboId }, select: { complejo: { select: { zona_horaria: true } } } });
  return r?.complejo?.zona_horaria ?? ZONA_POR_DEFECTO;
}

// ---------- Filtros que dependen del día de la zona ----------

/** Los recibos de un grupo de zonas. El grupo de Lima también se queda con los recibos sin condominio y con los de una zona que el reloj aún no conocía. */
function reciboEnGrupo(reloj: Reloj, zonas: string[]): Prisma.ReciboWhereInput {
  const propias: Prisma.ReciboWhereInput = { complejo: { zona_horaria: { in: zonas } } };
  if (!zonas.includes(ZONA_POR_DEFECTO)) return propias;
  return { OR: [propias, { complejo_id: null }, { complejo: { zona_horaria: { notIn: reloj.zonas } } }] };
}

/**
 * Arma un filtro que depende del día de la zona: `f(día)` por cada grupo de zonas con el mismo día, cada uno acotado a los recibos de esas zonas
 * (`via` lleva ese filtro de recibos a la tabla que se consulta). Con un solo grupo devuelve `f(día)` tal cual.
 */
function segunZona<W>(reloj: Reloj, f: (d: Dia) => W, via: (r: Prisma.ReciboWhereInput) => W): W {
  const grupos = reloj.grupos();
  if (grupos.length === 1) return f(grupos[0]!.dia);
  return { OR: grupos.map((g) => ({ AND: [via(reciboEnGrupo(reloj, g.zonas)), f(g.dia)] })) } as W;
}

/** Filtro de recibos según el día de la zona de su condominio. */
export const reciboSegunZona = (reloj: Reloj, f: (d: Dia) => Prisma.ReciboWhereInput): Prisma.ReciboWhereInput => segunZona(reloj, f, (r) => r);

/** Filtro de cargos según el día de la zona del condominio de su recibo. */
export const cargoSegunZona = (reloj: Reloj, f: (d: Dia) => Prisma.ReciboConceptoUnidadWhereInput): Prisma.ReciboConceptoUnidadWhereInput =>
  segunZona(reloj, f, (recibo) => ({ reciboConcepto: { recibo } }));

/** Filtro de pagos según el día de la zona del condominio del recibo de su cargo. */
export const pagoSegunZona = (reloj: Reloj, f: (d: Dia) => Prisma.PagoWhereInput): Prisma.PagoWhereInput =>
  segunZona(reloj, f, (recibo) => ({ reciboConceptoUnidad: { reciboConcepto: { recibo } } }));

/**
 * El «hoy» en SQL crudo: `columnaZona` es la columna `zona_horaria` del condominio del recibo (puede venir NULL en un LEFT JOIN: es Lima).
 * Con un solo grupo es el parámetro de siempre; con varios, un `CASE` por zona.
 */
export function sqlHoy(reloj: Reloj, columnaZona: Prisma.Sql): Prisma.Sql {
  const grupos = reloj.grupos();
  if (grupos.length === 1) return Prisma.sql`${grupos[0]!.dia.hoy}`;
  const lima = grupos.find((g) => g.zonas.includes(ZONA_POR_DEFECTO))!;
  const tramos = grupos.filter((g) => g !== lima).map((g) => Prisma.sql`WHEN ${columnaZona} IN (${Prisma.join(g.zonas)}) THEN ${g.dia.hoy}`);
  return Prisma.sql`CASE ${Prisma.join(tramos, ' ')} ELSE ${lima.dia.hoy} END`;
}
