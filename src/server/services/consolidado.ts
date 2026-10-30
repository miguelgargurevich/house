/**
 * Consolidado del block: la «otra vista» que la administradora imprime en la cara de atrás de cada recibo — una tabla con TODOS los departamentos del
 * block, un concepto por columna, más TOTAL MANT, DEUDA ACUMULADA y TOTAL, y una fila de TOTALES. Es el mismo formato del Excel que se sube
 * (`lib/excelRecibos.ts`), así que el Excel que se descarga se puede volver a subir. Sólo lo ven la administración y la junta DE ESE block.
 *
 * Los montos salen con 2 decimales; las sumas (TOTAL MANT, TOTALES, TOTAL) se hacen con los cargos guardados, SIN redondear antes, y se redondean
 * una sola vez al final: así el total es siempre el de los cargos y no el de las celdas ya redondeadas.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { MONEDA_POR_DEFECTO } from '../../lib/paises';
import { notFound, invalid } from '../errors';
import { deudasAcumuladas } from '../lib/mantenimientos';
import { detalleMantenimiento, type DetalleMantenimiento } from './mantenimiento';

export interface ColumnaConsolidado {
  /** `ReciboConcepto.id`: una columna por concepto del recibo, en su orden (la multa por pago fuera de fecha, si el recibo la tiene, es una más). */
  id: number;
  nombre: string;
  es_recargo: boolean;
}

export interface FilaConsolidado {
  unidad_id: number;
  codigo: string;
  /** Nombre del block de la unidad («Block 1»); `null` si no tiene. */
  block: string | null;
  /** Número del departamento: lo que va después del último guion del código («B01-804» → «804»). */
  dpto: string;
  /** «Apellidos y Nombres» del propietario, tal como está guardado; vacío si el departamento no tiene propietario. */
  propietario: string;
  /** Un monto por columna, en el mismo orden que `conceptos` (0.00 si el departamento no tiene ese cargo). */
  montos: string[];
  total_mant: string;
  deuda_acumulada: string;
  total: string;
}

export interface Consolidado {
  recibo_id: number;
  empresa: string | null;
  condominio: string;
  /** Nombre del block del recibo (o el único block de las filas); `null` si el recibo mezcla blocks o el condominio no tiene. */
  block: string | null;
  mes: number;
  anio: number;
  fecha_vencimiento: Date;
  /** Moneda del condominio (ISO 4217): todos los montos van en ella. */
  moneda: string;
  conceptos: ColumnaConsolidado[];
  filas: FilaConsolidado[];
  totales: { montos: string[]; total_mant: string; deuda_acumulada: string; total: string };
}

export interface AlcanceConsolidado {
  /** Recibos que alcanza quien pregunta (`recibosDe`): si el recibo no está aquí → 404. */
  reciboWhere: Prisma.ReciboWhereInput;
  /** Unidades que alcanza (`unidadesDe`): la junta de un block sólo ve las de su block, aunque el recibo cobre a más. */
  unidadWhere: Prisma.UnidadWhereInput;
}

const dec = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const natural = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });

/** «B01-804» → «804»; «804» → «804». */
export const dptoDeCodigo = (codigo: string): string => codigo.split(/[^A-Za-z0-9]+/).filter(Boolean).pop() ?? codigo;

/** Tope de departamentos de un documento para imprimir (cada uno lleva su recibo completo). */
export const MAX_UNIDADES_IMPRESION = 500;

async function construir(reciboId: number, alcance: AlcanceConsolidado): Promise<{ consolidado: Consolidado; conCargos: Set<number> }> {
  const recibo = await prisma.recibo.findFirst({
    where: { AND: [{ id: reciboId }, alcance.reciboWhere] },
    select: {
      id: true, mes: true, anio: true, fecha_vencimiento: true, complejo_id: true, estructura_id: true,
      complejo: { select: { nombre: true, moneda: true } },
      empresa: { select: { nombre: true } },
      estructura: { select: { nombre: true } },
      reciboConceptos: { orderBy: [{ orden: 'asc' }, { id: 'asc' }], select: { id: true, es_recargo: true, concepto: { select: { nombre: true } } } },
    },
  });
  if (!recibo) throw notFound();

  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: { reciboConcepto: { recibo_id: reciboId }, unidad: { is: alcance.unidadWhere } },
    select: { unidad_id: true, recibo_concepto_id: true, monto: true },
  });
  const conCargos = new Set(cargos.map((c) => c.unidad_id).filter((id): id is number => id != null));

  // Filas: los departamentos que el recibo cobra y, si el recibo es de un block, también los demás departamentos de ese block (en el Excel salen todos,
  // aunque este mes no tengan cargos: pueden deber de antes). Sin block, sólo si el condominio no tiene blocks.
  const sinBlocks = recibo.estructura_id == null && recibo.complejo_id != null && (await prisma.estructura.count({ where: { complejo_id: recibo.complejo_id } })) === 0;
  const delBlock: Prisma.UnidadWhereInput[] = recibo.complejo_id == null
    ? []
    : recibo.estructura_id != null || sinBlocks
      ? [{ complejo_id: recibo.complejo_id, estado: 'activa', ...(recibo.estructura_id != null ? { estructura_id: recibo.estructura_id } : {}), OR: [{ tipo: { equals: 'departamento', mode: 'insensitive' } }, { tipo: { equals: 'casa', mode: 'insensitive' } }] }]
      : [];
  const unidades = await prisma.unidad.findMany({
    where: { AND: [alcance.unidadWhere, { OR: [{ id: { in: [...conCargos] } }, ...delBlock] }] },
    select: { id: true, codigo: true, estructura: { select: { nombre: true } }, propietario: { select: { nombre: true } } },
  });
  unidades.sort((a, b) => natural(a.estructura?.nombre ?? '', b.estructura?.nombre ?? '') || natural(a.codigo, b.codigo) || a.id - b.id);

  const deudas = await deudasAcumuladas(unidades.map((u) => u.id), recibo.anio, recibo.mes);
  const columnas: ColumnaConsolidado[] = recibo.reciboConceptos.map((rc) => ({ id: rc.id, nombre: rc.concepto?.nombre ?? 'Concepto', es_recargo: rc.es_recargo }));
  const indice = new Map(columnas.map((c, i) => [c.id, i]));
  const sumas = new Map<number, Prisma.Decimal[]>(unidades.map((u) => [u.id, columnas.map(() => dec(0))]));
  for (const c of cargos) {
    const fila = c.unidad_id != null ? sumas.get(c.unidad_id) : undefined;
    const i = c.recibo_concepto_id != null ? indice.get(c.recibo_concepto_id) : undefined;
    if (fila && i != null) fila[i] = fila[i]!.plus(c.monto);
  }

  const totalColumnas = columnas.map(() => dec(0));
  let totalMant = dec(0);
  let totalDeuda = dec(0);
  const filas: FilaConsolidado[] = unidades.map((u) => {
    const montos = sumas.get(u.id)!;
    const mant = montos.reduce((s, m) => s.plus(m), dec(0));
    const deuda = dec(deudas.get(u.id));
    montos.forEach((m, i) => { totalColumnas[i] = totalColumnas[i]!.plus(m); });
    totalMant = totalMant.plus(mant);
    totalDeuda = totalDeuda.plus(deuda);
    return {
      unidad_id: u.id,
      codigo: u.codigo,
      block: u.estructura?.nombre ?? null,
      dpto: dptoDeCodigo(u.codigo),
      propietario: u.propietario?.nombre ?? '',
      montos: montos.map((m) => m.toFixed(2)),
      total_mant: mant.toFixed(2),
      deuda_acumulada: deuda.toFixed(2),
      total: mant.plus(deuda).toFixed(2),
    };
  });

  const blocks = [...new Set(filas.map((f) => f.block).filter((b): b is string => b != null))];
  return {
    conCargos,
    consolidado: {
      recibo_id: recibo.id,
      empresa: recibo.empresa?.nombre ?? null,
      condominio: recibo.complejo?.nombre ?? '',
      block: recibo.estructura?.nombre ?? (blocks.length === 1 ? blocks[0]! : null),
      mes: recibo.mes,
      anio: recibo.anio,
      fecha_vencimiento: recibo.fecha_vencimiento,
      moneda: recibo.complejo?.moneda ?? MONEDA_POR_DEFECTO,
      conceptos: columnas,
      filas,
      totales: { montos: totalColumnas.map((m) => m.toFixed(2)), total_mant: totalMant.toFixed(2), deuda_acumulada: totalDeuda.toFixed(2), total: totalMant.plus(totalDeuda).toFixed(2) },
    },
  };
}

/** El consolidado del block del recibo, sólo con los departamentos que `alcance` permite (404 si el recibo no está en su alcance). */
export async function armarConsolidado(reciboId: number, alcance: AlcanceConsolidado): Promise<Consolidado> {
  return (await construir(reciboId, alcance)).consolidado;
}

export interface ImpresionBlock {
  consolidado: Consolidado;
  /** El recibo de cada departamento con cargos (el mismo de «Ver / imprimir recibo»), en el orden del consolidado y SIN su historial de pagos. */
  recibos: DetalleMantenimiento[];
}

/** Lo necesario para imprimir «recibos del block»: por departamento su recibo y, a continuación, el consolidado (cara de atrás). */
export async function armarImpresion(reciboId: number, alcance: AlcanceConsolidado, tope = MAX_UNIDADES_IMPRESION): Promise<ImpresionBlock> {
  const { consolidado, conCargos } = await construir(reciboId, alcance);
  const unidades = consolidado.filas.filter((f) => conCargos.has(f.unidad_id)).map((f) => f.unidad_id);
  if (unidades.length > tope) throw invalid(`Son ${unidades.length} departamentos: imprime el recibo de cada block por separado (máximo ${tope} por documento)`);
  const recibos: DetalleMantenimiento[] = new Array(unidades.length);
  let siguiente = 0;
  // Pocas consultas a la vez: son ~15 por departamento y la Mac también atiende otras cosas.
  const trabajador = async () => {
    for (let i = siguiente++; i < unidades.length; i = siguiente++) {
      const d = await detalleMantenimiento(reciboId, unidades[i]!, { reciboWhere: alcance.reciboWhere, unidadWhere: alcance.unidadWhere, vista: 'completa' });
      recibos[i] = { ...d, pagos: [] };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, unidades.length) }, trabajador));
  return { consolidado, recibos };
}
