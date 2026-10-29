/**
 * Lecturas de agua por departamento: lo que se carga para el recibo de una torre y lo que muestra el recibo (impreso y del residente).
 * Las cuentas y las reglas viven en `lib/agua.ts` (puras); aquí está el acceso a la base. El alcance (qué recibo y qué departamentos alcanza
 * quien llama) lo decide el router y llega como `unidadWhere`.
 */
import { Prisma } from '@prisma/client';
import { MONEDA_POR_DEFECTO } from '../../lib/paises';
import { prisma } from '../db';
import { notFound } from '../errors';
import {
  INVALIDO, alertaAgua, cuentaLectura, errorLectura, esConceptoAgua, leerArchivoLecturas, leerFactor, leerFecha, leerLectura,
  type DatosLectura, type FilaArchivo,
} from '../lib/agua';
import { codigoEncajaConDpto, normalizarTexto } from '../lib/excelRecibos';
import { versionImagen } from './imagenes';
import { correoEfectivo, selectCorreoBlock } from './juntas';

const D = Prisma.Decimal;

export interface UnidadAgua { id: number; codigo: string; propietario: string | null }

export interface LecturaVista {
  fecha_anterior: Date;
  lectura_anterior: string;
  fecha_actual: Date;
  lectura_actual: string;
  factor: string;
  consumo_m3: string;
  monto: string;
  tiene_foto: boolean;
}

export interface FilaAgua {
  unidad: UnidadAgua;
  /** La lectura guardada de este mes; `null` si todavía no se cargó. */
  lectura: LecturaVista | null;
  /** Lo que se precarga como «anterior» (la lectura actual del mes previo de esa unidad); `null` si no hay. */
  anterior: { fecha: Date; lectura: string; factor: string } | null;
  /** Lo que el recibo cobra por el concepto «AGUA DPTO.» (suma de esos cargos); `null` si el departamento no lo tiene. */
  agua_recibo: string | null;
  /** Aviso si el agua del recibo y la de la lectura no cuadran (sólo avisa). */
  alerta: string | null;
}

const vista = (l: { fecha_anterior: Date; lectura_anterior: Prisma.Decimal; fecha_actual: Date; lectura_actual: Prisma.Decimal; factor: Prisma.Decimal; foto_tipo_mime: string | null }): LecturaVista => ({
  fecha_anterior: l.fecha_anterior,
  lectura_anterior: l.lectura_anterior.toFixed(3),
  fecha_actual: l.fecha_actual,
  lectura_actual: l.lectura_actual.toFixed(3),
  factor: l.factor.toFixed(4),
  ...cuentaLectura(l),
  tiene_foto: l.foto_tipo_mime != null,
});

/** Cargos de agua del departamento (suma) por unidad, de un recibo. */
async function cargosDeAgua(reciboId: number, unidadIds: number[]): Promise<Map<number, Prisma.Decimal>> {
  const mapa = new Map<number, Prisma.Decimal>();
  if (!unidadIds.length) return mapa;
  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: { unidad_id: { in: unidadIds }, reciboConcepto: { recibo_id: reciboId } },
    select: { unidad_id: true, monto: true, reciboConcepto: { select: { concepto: { select: { nombre: true } } } } },
  });
  for (const c of cargos) {
    if (c.unidad_id == null || !esConceptoAgua(c.reciboConcepto?.concepto?.nombre)) continue;
    mapa.set(c.unidad_id, (mapa.get(c.unidad_id) ?? new D(0)).plus(c.monto));
  }
  return mapa;
}

/** La lectura más reciente de cada unidad en un recibo ANTERIOR al periodo dado (mes previo, o el último que tenga). */
async function lecturasPrevias(unidadIds: number[], anio: number, mes: number) {
  const mapa = new Map<number, { fecha: Date; lectura: string; factor: string }>();
  if (!unidadIds.length) return mapa;
  const filas = await prisma.lecturaAgua.findMany({
    where: { unidad_id: { in: unidadIds }, recibo: { OR: [{ anio: { lt: anio } }, { anio, mes: { lt: mes } }] } },
    orderBy: [{ recibo: { anio: 'desc' } }, { recibo: { mes: 'desc' } }, { id: 'desc' }],
    distinct: ['unidad_id'],
    select: { unidad_id: true, fecha_actual: true, lectura_actual: true, factor: true },
  });
  for (const f of filas) mapa.set(f.unidad_id, { fecha: f.fecha_actual, lectura: f.lectura_actual.toFixed(3), factor: f.factor.toFixed(4) });
  return mapa;
}

/** Departamentos que el recibo cobra (los que tienen cargos en él) y que alcanza quien llama. */
async function unidadesDelRecibo(reciboId: number, unidadWhere: Prisma.UnidadWhereInput) {
  return prisma.unidad.findMany({
    where: { AND: [{ reciboConceptoUnidades: { some: { reciboConcepto: { recibo_id: reciboId } } } }, unidadWhere] },
    select: { id: true, codigo: true, propietario: { select: { nombre: true } } },
    orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
    take: 2000,
  });
}

export interface AguaDelRecibo {
  /** Moneda del condominio: el monto de cada lectura, el del recibo y el factor (por m³) van en ella. */
  moneda: string;
  recibo: { id: number; mes: number; anio: number; fecha_corte_agua: Date | null; estructura: { id: number; nombre: string | null; correo_vouchers: string | null } | null };
  /** El factor más usado en este recibo; si aún no hay lecturas, el del mes anterior. Sirve de sugerencia al cargar. */
  factor_sugerido: string | null;
  items: FilaAgua[];
}

/** Una fila por departamento del recibo, con su lectura, la precarga de la anterior y el cruce con el concepto de agua. */
export async function aguaDelRecibo(reciboId: number, o: { reciboWhere: Prisma.ReciboWhereInput; unidadWhere: Prisma.UnidadWhereInput }): Promise<AguaDelRecibo> {
  const recibo = await prisma.recibo.findFirst({
    where: { AND: [{ id: reciboId }, o.reciboWhere] },
    select: { id: true, mes: true, anio: true, fecha_corte_agua: true, estructura: { select: { id: true, nombre: true, ...selectCorreoBlock } }, complejo: { select: { moneda: true } } },
  });
  if (!recibo) throw notFound();
  const moneda = recibo.complejo?.moneda ?? MONEDA_POR_DEFECTO;
  const unidades = await unidadesDelRecibo(reciboId, o.unidadWhere);
  const ids = unidades.map((u) => u.id);
  const [lecturas, previas, aguaRecibo] = await Promise.all([
    prisma.lecturaAgua.findMany({ where: { recibo_id: reciboId, unidad_id: { in: ids } }, omit: { foto_datos: true } }),
    lecturasPrevias(ids, recibo.anio, recibo.mes),
    cargosDeAgua(reciboId, ids),
  ]);
  const porUnidad = new Map(lecturas.map((l) => [l.unidad_id, l]));
  const items: FilaAgua[] = unidades.map((u) => {
    const l = porUnidad.get(u.id);
    const lectura = l ? vista(l) : null;
    const recibido = aguaRecibo.get(u.id) ?? null;
    return {
      unidad: { id: u.id, codigo: u.codigo, propietario: u.propietario?.nombre ?? null },
      lectura,
      anterior: previas.get(u.id) ?? null,
      agua_recibo: recibido?.toFixed(2) ?? null,
      alerta: lectura ? alertaAgua(lectura.monto, recibido, moneda) : null,
    };
  });
  const factores = new Map<string, number>();
  for (const f of items) { const x = f.lectura?.factor ?? f.anterior?.factor; if (x) factores.set(x, (factores.get(x) ?? 0) + 1); }
  const sugerido = [...factores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const cabecera = { id: recibo.id, mes: recibo.mes, anio: recibo.anio, fecha_corte_agua: recibo.fecha_corte_agua, estructura: recibo.estructura ? { id: recibo.estructura.id, nombre: recibo.estructura.nombre, correo_vouchers: correoEfectivo(recibo.estructura) } : null }; // sin `complejo`: la moneda va arriba. El correo es el efectivo (junta vigente o, si no, el del block)
  return { recibo: cabecera, moneda, factor_sugerido: sugerido, items };
}

export type EntradaLectura = { unidad_id: number } & DatosLectura;
export interface ErrorFila { fila?: number; dpto: string; mensaje: string }

/** Guarda (crea o reemplaza) las lecturas de ese recibo, una por departamento. La foto ya cargada se conserva. */
export async function guardarLecturas(reciboId: number, entradas: EntradaLectura[], o: { unidadWhere: Prisma.UnidadWhereInput; usuarioId: number }): Promise<{ guardadas: number; errores: ErrorFila[] }> {
  const unidades = await unidadesDelRecibo(reciboId, o.unidadWhere);
  const codigo = new Map(unidades.map((u) => [u.id, u.codigo]));
  const errores: ErrorFila[] = [];
  const validas: EntradaLectura[] = [];
  for (const e of entradas) {
    const cod = codigo.get(e.unidad_id);
    if (cod == null) { errores.push({ dpto: String(e.unidad_id), mensaje: 'El departamento no pertenece a este recibo' }); continue; }
    const campos = errorLectura(e);
    if (campos) { errores.push({ dpto: cod, mensaje: Object.values(campos).join('. ') }); continue; }
    validas.push(e);
  }
  await prisma.$transaction(validas.map(({ unidad_id, ...datos }) => prisma.lecturaAgua.upsert({
    where: { unidad_id_recibo_id: { unidad_id, recibo_id: reciboId } },
    create: { unidad_id, recibo_id: reciboId, ...datos, registrado_por_id: o.usuarioId },
    update: { ...datos, registrado_por_id: o.usuarioId },
    select: { id: true },
  })));
  return { guardadas: validas.length, errores };
}

const claveCodigo = (s: string) => normalizarTexto(s).toUpperCase().replace(/[^A-Z0-9]+/g, '');

/** Departamento del recibo que nombra la celda «Dpto»: el código completo («B01-804») o sólo el número («804»). Hay que ver exactamente uno. */
export function unidadDeDpto<T extends { codigo: string }>(unidades: T[], dpto: string): { unidad?: T; motivo?: 'ninguna' | 'varias' } {
  const exactas = unidades.filter((u) => claveCodigo(u.codigo) === claveCodigo(dpto));
  const coinciden = exactas.length ? exactas : unidades.filter((u) => codigoEncajaConDpto(u.codigo, dpto));
  if (coinciden.length === 1) return { unidad: coinciden[0] };
  return { motivo: coinciden.length ? 'varias' : 'ninguna' };
}

export interface ResultadoImportacion { filas: number; guardadas: number; errores: ErrorFila[] }

/**
 * Carga lecturas desde un Excel/CSV: una fila por departamento. Las filas válidas se guardan; las que no, se devuelven con su motivo (no se
 * guarda nada «a medias» dentro de una fila). Un departamento repetido en el archivo se rechaza completo: no se adivina cuál vale.
 * Lo que falta en la fila (lectura y fecha anteriores, factor) se completa con la lectura del mes previo y el `factor` dado aparte.
 */
export async function importarLecturas(reciboId: number, archivo: Buffer, o: { unidadWhere: Prisma.UnidadWhereInput; usuarioId: number; factor?: Prisma.Decimal | null }): Promise<ResultadoImportacion> {
  const filas = leerArchivoLecturas(archivo);
  const recibo = await prisma.recibo.findUniqueOrThrow({ where: { id: reciboId }, select: { mes: true, anio: true } });
  const unidades = await unidadesDelRecibo(reciboId, o.unidadWhere);
  const previas = await lecturasPrevias(unidades.map((u) => u.id), recibo.anio, recibo.mes);
  const errores: ErrorFila[] = [];

  // Qué filas nombran a cada departamento (para rechazar los repetidos aunque unas digan «804» y otras «B01-804»).
  const resueltas = filas.map((f: FilaArchivo) => ({ f, ...unidadDeDpto(unidades, f.dpto) }));
  const filasDe = new Map<number, number[]>();
  for (const r of resueltas) if (r.unidad) filasDe.set(r.unidad.id, [...(filasDe.get(r.unidad.id) ?? []), r.f.fila]);

  const entradas: EntradaLectura[] = [];
  for (const { f, unidad, motivo } of resueltas) {
    const falla = (mensaje: string) => errores.push({ fila: f.fila, dpto: f.dpto, mensaje });
    if (!unidad) { falla(motivo === 'varias' ? 'Hay varios departamentos que coinciden' : 'No existe ese departamento en este recibo'); continue; }
    const repetidas = filasDe.get(unidad.id)!;
    if (repetidas.length > 1) { falla(`El departamento aparece ${repetidas.length} veces en el archivo (filas ${repetidas.join(', ')}); deja una sola`); continue; }
    const prev = previas.get(unidad.id);
    const la = leerLectura(f.lectura_anterior);
    const lc = leerLectura(f.lectura_actual);
    const fa = f.fecha_anterior === '' || f.fecha_anterior == null ? null : leerFecha(f.fecha_anterior);
    const fc = f.fecha_actual === '' || f.fecha_actual == null ? null : leerFecha(f.fecha_actual);
    const fx = leerFactor(f.factor);
    if (la === INVALIDO || lc === INVALIDO) { falla('La lectura debe ser un número (ej. 1430.897)'); continue; }
    if (fx === INVALIDO) { falla('El factor debe ser un número (ej. 4.93)'); continue; }
    if ((f.fecha_anterior !== '' && f.fecha_anterior != null && !fa) || (f.fecha_actual !== '' && f.fecha_actual != null && !fc)) { falla('Fecha inválida (usa día/mes/año, ej. 10/10/2026)'); continue; }
    const anterior = la ?? (prev ? new D(prev.lectura) : null);
    const fechaAnterior = fa ?? prev?.fecha ?? null;
    const factor = fx ?? o.factor ?? null;
    if (lc == null) { falla('Falta la lectura actual'); continue; }
    if (anterior == null || fechaAnterior == null) { falla('Falta la lectura o la fecha anterior (y no hay lectura del mes previo)'); continue; }
    if (!fc) { falla('Falta la fecha actual'); continue; }
    if (factor == null) { falla('Falta el factor (ponlo en el archivo o en el formulario)'); continue; }
    const datos: DatosLectura = { fecha_anterior: fechaAnterior, lectura_anterior: anterior, fecha_actual: fc, lectura_actual: lc, factor };
    const campos = errorLectura(datos);
    if (campos) { falla(Object.values(campos).join('. ')); continue; }
    entradas.push({ unidad_id: unidad.id, ...datos });
  }
  const { guardadas } = await guardarLecturas(reciboId, entradas, o);
  return { filas: filas.length, guardadas, errores };
}

/** Datos para la plantilla: un renglón por departamento con la lectura y la fecha anteriores ya puestas. */
export async function filasDePlantilla(reciboId: number, o: { reciboWhere: Prisma.ReciboWhereInput; unidadWhere: Prisma.UnidadWhereInput }) {
  const agua = await aguaDelRecibo(reciboId, o);
  return agua.items.map((f) => ({
    codigo: f.unidad.codigo,
    fecha_anterior: f.lectura?.fecha_anterior ?? f.anterior?.fecha ?? null,
    lectura_anterior: f.lectura?.lectura_anterior ?? f.anterior?.lectura ?? null,
    factor: f.lectura?.factor ?? f.anterior?.factor ?? null,
  }));
}

// ---------- Para el recibo de un departamento ----------
export interface AguaDeMantenimiento extends LecturaVista {
  /** URL de la foto del contómetro (con alcance de quien la pide), o `null` si no hay. */
  foto_url: string | null;
}

/** La lectura del departamento en el recibo, para el detalle del mantenimiento. `fotoBase` = ruta (según quién mira) a la que se agrega `/foto`. */
export async function aguaDeMantenimiento(reciboId: number, unidadId: number, fotoBase: string): Promise<AguaDeMantenimiento | null> {
  const l = await prisma.lecturaAgua.findUnique({ where: { unidad_id_recibo_id: { unidad_id: unidadId, recibo_id: reciboId } }, omit: { foto_datos: true } });
  if (!l) return null;
  return { ...vista(l), foto_url: l.foto_tipo_mime ? `${fotoBase}/foto?v=${versionImagen(l.updated_at)}` : null };
}
