/**
 * Mora por pago fuera de fecha. Al crear el recibo de un mes (Excel o emisión manual) se mira el recibo del MES ANTERIOR DE LA MISMA TORRE: la
 * unidad que «pagó tarde» lleva una línea de mora en el recibo nuevo (monto configurable por condominio: `ComplejoHabitacional.mora_monto`).
 *
 * «Pagó tarde» = al cierre del día de vencimiento (inclusive, hora de Lima) la unidad NO tiene pagos con `fecha_pago` (la del voucher) ≤ vencimiento
 * que cubran el saldo de ese recibo. Cuentan los pagos validados y los por validar; el rechazado no. Si el recibo anterior aún no venció (hoy en
 * Lima ≤ vencimiento) nadie puede haber pagado tarde todavía: no se evalúa nada.
 *
 * Es idempotente porque se calcula al CREAR el recibo: reemplazar el recibo desde Excel borra sus cargos y vuelve a calcular, nunca suma.
 */
import { Prisma } from '@prisma/client';
import { hoyLima } from '../lib/fechas';
import { diaCalendario } from './fechaVoucher';
import { periodoTexto } from '../lib/periodo';
import { fechaTexto, solesTexto } from './avisos/plantillas';
import { moduloActivo } from './comercial/modulos';

type Tx = Prisma.TransactionClient;

export const CONCEPTO_MORA = 'Multa por pago fuera de fecha';
export const MORA_POR_DEFECTO = '20.00';

/** Reloj inyectable para pruebas (nunca se espera de verdad). */
export const moraDeps = { ahora: (): Date => new Date() };

/**
 * La mora automática es del plan Pro (capacidad `mora_automatica`): en Gratis el monto que se aplica es 0 y el recibo se emite igual, sin mora.
 * `configurado` es lo que el condominio tiene en `mora_monto` (no se borra al pasar a Gratis: al volver a Pro sigue ahí).
 */
export async function montoDeMoraAplicable(complejoId: number | null | undefined, configurado: Prisma.Decimal.Value | null | undefined): Promise<Prisma.Decimal> {
  return (await moduloActivo(complejoId, 'mora_automatica')) ? new Prisma.Decimal(configurado ?? 0) : new Prisma.Decimal(0);
}

/** ¿El concepto es la multa del Excel de la administradora («MULTA PAGO FUERA DE FECHA(ULTIMO DIA 2 CADA MES)») o una mora? */
export const esConceptoMora = (nombre: string | null | undefined): boolean => /\b(multa|mora)\b/i.test(nombre ?? '');

export interface UnidadConMora { id: number; codigo: string; torre: string | null }

export interface EvaluacionMora {
  /** El recibo del mes anterior de esa torre; `null` si no existe (primer recibo, o mes sin recibo). */
  anterior: { id: number; mes: number; anio: number; fecha_vencimiento: Date } | null;
  /** `true` si el anterior aún no venció: no se evaluó a nadie. */
  aunNoVence: boolean;
  /** Unidades (de las pedidas) que pagaron tarde. */
  tarde: Set<number>;
}

/**
 * Qué unidades de `unidadIds` pagaron tarde el recibo del mes anterior de la torre. Una unidad sin cargos en ese recibo no debe nada: no es mora.
 * Un cargo `pagado` sin ningún `Pago` (dato anterior al flujo de pagos) cuenta por la fecha del propio cargo; sin fecha, se le da el beneficio de la duda.
 */
export async function evaluarMora(tx: Tx, o: { complejoId: number; estructuraId: number | null; mes: number; anio: number; unidadIds: number[] }): Promise<EvaluacionMora> {
  const mes = o.mes === 1 ? 12 : o.mes - 1;
  const anio = o.mes === 1 ? o.anio - 1 : o.anio;
  const anterior = await tx.recibo.findFirst({
    where: { complejo_id: o.complejoId, estructura_id: o.estructuraId, mes, anio },
    select: { id: true, mes: true, anio: true, fecha_vencimiento: true },
    orderBy: { id: 'asc' },
  });
  const vacio: EvaluacionMora = { anterior, aunNoVence: false, tarde: new Set() };
  if (!anterior || o.unidadIds.length === 0) return vacio;
  const vence = diaCalendario(anterior.fecha_vencimiento).getTime(); // fecha sin hora: no se pasa por `hoyLima`
  if (hoyLima(moraDeps.ahora()).getTime() <= vence) return { ...vacio, aunNoVence: true };
  const cargos = await tx.reciboConceptoUnidad.findMany({
    where: { unidad_id: { in: o.unidadIds }, reciboConcepto: { recibo_id: anterior.id } },
    select: { unidad_id: true, monto: true, estado_pago: true, fecha_pago: true, pagos: { where: { estado_validacion: { not: 'rechazado' } }, select: { monto: true, fecha_pago: true } } },
  });
  const tarde = new Set<number>();
  for (const c of cargos) {
    if (c.unidad_id == null) continue;
    let cubierto: boolean;
    if (c.pagos.length === 0) {
      cubierto = c.estado_pago === 'pagado' ? c.fecha_pago == null || hoyLima(c.fecha_pago).getTime() <= vence : new Prisma.Decimal(c.monto).lte(0);
    } else {
      const aTiempo = c.pagos.filter((p) => hoyLima(p.fecha_pago).getTime() <= vence).reduce((s, p) => s.plus(p.monto), new Prisma.Decimal(0));
      cubierto = aTiempo.gte(c.monto);
    }
    if (!cubierto) tarde.add(c.unidad_id);
  }
  return { ...vacio, tarde };
}

/** «pago fuera de fecha del recibo de octubre»: el motivo que ve el residente en su línea de mora. */
export const motivoMora = (a: { mes: number; anio: number }): string => `Pago fuera de fecha del recibo de ${periodoTexto(a.mes, a.anio)}`;

/** `S/ 20` (sin decimales si es entero) o `S/ 20.50`. */
export function montoMoraTexto(monto: Prisma.Decimal): string {
  return monto.isInteger() ? `S/ ${monto.toFixed(0)}` : solesTexto(monto);
}

/** Lo que se devuelve al admin: cuántos departamentos recibieron mora, cuáles, y el mensaje listo para mostrar. */
export interface InformeMora {
  monto: string;
  cantidad: number;
  departamentos: { recibo_id: number; torre: string | null; unidad_id: number; codigo: string }[];
  mensaje: string | null;
}

export function informeDeMora(monto: Prisma.Decimal, porRecibo: { reciboId: number; torre: string | null; unidades: UnidadConMora[] }[]): InformeMora {
  const departamentos = porRecibo.flatMap((r) => r.unidades.map((u) => ({ recibo_id: r.reciboId, torre: r.torre, unidad_id: u.id, codigo: u.codigo })));
  const n = departamentos.length;
  if (n === 0) return { monto: monto.toFixed(2), cantidad: 0, departamentos, mensaje: null };
  const codigos = departamentos.map((d) => d.codigo).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const lista = codigos.length > 20 ? `${codigos.slice(0, 20).join(', ')}… y ${codigos.length - 20} más` : codigos.join(', ');
  return { monto: monto.toFixed(2), cantidad: n, departamentos, mensaje: `Se agregó mora de ${montoMoraTexto(monto)} a ${n} ${n === 1 ? 'departamento' : 'departamentos'}: ${lista}` };
}

/**
 * Crea la línea de mora de un recibo para las unidades que pagaron tarde. Con `reciboConceptoId` (la columna de multa que ya trae el Excel) usa
 * ese concepto; sin él crea (o reutiliza) el concepto «Multa por pago fuera de fecha» de la empresa y lo agrega al recibo como recargo.
 */
export async function crearLineaDeMora(tx: Tx, o: { reciboId: number; empresaId: number | null; monto: Prisma.Decimal; unidadIds: number[]; motivo: string; reciboConceptoId?: number }): Promise<void> {
  // Idempotente: una unidad que ya tiene la mora de ESE motivo en el recibo no la recibe otra vez (llamarla dos veces no suma dos moras).
  const ya = await tx.reciboConceptoUnidad.findMany({ where: { unidad_id: { in: o.unidadIds }, observaciones: o.motivo, reciboConcepto: { recibo_id: o.reciboId } }, select: { unidad_id: true } });
  const hechas = new Set(ya.map((c) => c.unidad_id));
  const unidadIds = o.unidadIds.filter((id) => !hechas.has(id));
  if (unidadIds.length === 0) return;
  let reciboConceptoId = o.reciboConceptoId;
  if (reciboConceptoId == null) {
    const concepto =
      (await tx.concepto.findFirst({ where: { nombre: CONCEPTO_MORA, empresa_id: o.empresaId, activo: true } })) ??
      (await tx.concepto.create({ data: { nombre: CONCEPTO_MORA, empresa_id: o.empresaId, tipo_monto: 'fijo', activo: true } }));
    const { _max } = await tx.reciboConcepto.aggregate({ where: { recibo_id: o.reciboId }, _max: { orden: true } });
    const rc = await tx.reciboConcepto.create({ data: { recibo_id: o.reciboId, concepto_id: concepto.id, monto: 0, es_recargo: true, orden: (_max.orden ?? 0) + 1 } });
    reciboConceptoId = rc.id;
  }
  await tx.reciboConceptoUnidad.createMany({
    data: unidadIds.map((unidad_id) => ({ recibo_concepto_id: reciboConceptoId!, unidad_id, monto: o.monto, estado_pago: 'pendiente', observaciones: o.motivo })),
  });
}

/**
 * Evalúa y agrega la mora a UN recibo recién creado (el de una torre). `respetar` son las unidades cuyo recibo ya trae una multa mayor que 0 (la del
 * Excel de la administradora): esa se respeta y no se duplica. `reciboConceptoId` es la columna de multa del propio recibo, si la tiene.
 * Devuelve las unidades con mora agregada y, si corresponde, un aviso en español (el recibo anterior aún no vence).
 */
export async function agregarMora(
  tx: Tx,
  o: { reciboId: number; complejoId: number; estructuraId: number | null; empresaId: number | null; mes: number; anio: number; unidadIds: number[]; monto: Prisma.Decimal; respetar?: Set<number>; reciboConceptoId?: number },
): Promise<{ unidades: UnidadConMora[]; aviso: string | null }> {
  if (o.monto.lte(0) || o.unidadIds.length === 0) return { unidades: [], aviso: null };
  const ev = await evaluarMora(tx, o);
  if (ev.aunNoVence && ev.anterior) {
    return { unidades: [], aviso: `El recibo de ${periodoTexto(ev.anterior.mes, ev.anterior.anio)} vence el ${fechaTexto(ev.anterior.fecha_vencimiento)}: aún no se puede saber quién pagó tarde, así que no se agregó mora` };
  }
  const ids = [...ev.tarde].filter((id) => !o.respetar?.has(id));
  if (!ids.length || !ev.anterior) return { unidades: [], aviso: null };
  await crearLineaDeMora(tx, { reciboId: o.reciboId, empresaId: o.empresaId, monto: o.monto, unidadIds: ids, motivo: motivoMora(ev.anterior), reciboConceptoId: o.reciboConceptoId });
  const filas = await tx.unidad.findMany({ where: { id: { in: ids } }, select: { id: true, codigo: true, estructura: { select: { nombre: true } } } });
  return { unidades: filas.map((u) => ({ id: u.id, codigo: u.codigo, torre: u.estructura?.nombre ?? null })), aviso: null };
}
