/**
 * Revisión de la mora por la administración: (1) la vista previa de quién pagó tarde ANTES de emitir el recibo del mes, (2) quitar una multa ya cargada
 * (la administradora acordó no cobrarla) y (3) el aviso «según el voucher pagó a tiempo; tiene la multa de …» junto al pago.
 *
 * La vista no calcula nada propio: llama a `evaluarMora` (`services/mora.ts`), la misma función que usa la emisión, así que lo que se ve aquí es
 * exactamente lo que se cobrará. El aviso también: «pagó a tiempo» es el veredicto de `evaluarMora` sobre el recibo del pago.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict } from '../errors';
import { hoyEn } from '../lib/fechas';
import { periodoTexto } from '../lib/periodo';
import { ZONA_POR_DEFECTO } from '../../lib/paises';
import { diaCalendario } from './fechaVoucher';
import { esConceptoMora, evaluarMora, motivoMora, type DetalleMoraUnidad } from './mora';

// ---------- 1. Vista previa de morosos ----------
export interface TorreAEvaluar { estructuraId: number | null; torre: string | null; unidades: number[] }

export interface VistaMoraUnidad extends DetalleMoraUnidad { unidad_id: number; codigo: string }
export interface VistaMoraTorre {
  estructura_id: number | null;
  torre: string | null;
  anterior: { id: number; mes: number; anio: number; fecha_vencimiento: Date } | null;
  aun_no_vence: boolean;
  unidades: VistaMoraUnidad[];
}
export interface VistaMora {
  complejo_id: number;
  mes: number;
  anio: number;
  /** `false` en el plan Gratis (sin mora automática) o con el monto en 0: la emisión no agregará multas. */
  aplica: boolean;
  monto: string;
  torres: VistaMoraTorre[];
  resumen: { a_tiempo: number; tarde: number; sin_deuda: number; revisar: number };
}

/** Qué pasaría al emitir el recibo de `mes/anio` en cada torre de `plan`: por departamento del recibo anterior, a tiempo, tarde o sin deuda, con sus pagos. */
export async function vistaDeMora(o: { complejoId: number; mes: number; anio: number; monto: Prisma.Decimal; plan: TorreAEvaluar[] }): Promise<VistaMora> {
  const resumen = { a_tiempo: 0, tarde: 0, sin_deuda: 0, revisar: 0 };
  const todas = o.plan.flatMap((g) => g.unidades);
  const codigos = new Map((await prisma.unidad.findMany({ where: { id: { in: todas } }, select: { id: true, codigo: true } })).map((u) => [u.id, u.codigo]));
  const torres: VistaMoraTorre[] = [];
  for (const g of o.plan) {
    const ev = await prisma.$transaction((tx) => evaluarMora(tx, { complejoId: o.complejoId, estructuraId: g.estructuraId, mes: o.mes, anio: o.anio, unidadIds: g.unidades }));
    const unidades = [...ev.detalle.entries()]
      .map(([unidad_id, x]) => ({ unidad_id, codigo: codigos.get(unidad_id) ?? '', ...x }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
    for (const u of unidades) {
      resumen[u.estado]++;
      if (u.revisar) resumen.revisar++;
    }
    torres.push({ estructura_id: g.estructuraId, torre: g.torre, anterior: ev.anterior, aun_no_vence: ev.aunNoVence, unidades });
  }
  return { complejo_id: o.complejoId, mes: o.mes, anio: o.anio, aplica: o.monto.gt(0), monto: o.monto.toFixed(2), torres, resumen };
}

// ---------- 2. Quitar la multa ----------
export interface MultaQuitada { monto: string; codigo: string; cargos: number }

/**
 * Quita la(s) línea(s) de multa de un departamento en un recibo. Sólo si ninguna está pagada, en revisión ni tiene pagos (un pago rechazado no cuenta).
 * Sin pagos la línea se borra; con pagos rechazados queda en 0.00 con el motivo, para no dejar esos pagos sin cargo. Todo o nada; 409 si no hay multa o ya se cobró.
 */
export async function quitarMulta(o: { reciboId: number; unidadId: number; motivo: string }): Promise<MultaQuitada> {
  return prisma.$transaction(async (tx) => {
    const cargos = await tx.reciboConceptoUnidad.findMany({
      where: { unidad_id: o.unidadId, reciboConcepto: { recibo_id: o.reciboId } },
      select: { id: true, monto: true, estado_pago: true, unidad: { select: { codigo: true } }, reciboConcepto: { select: { concepto: { select: { nombre: true } } } }, pagos: { select: { estado_validacion: true } } },
    });
    const multas = cargos.filter((c) => esConceptoMora(c.reciboConcepto?.concepto?.nombre) && new Prisma.Decimal(c.monto).gt(0));
    if (multas.length === 0) throw conflict('Este departamento no tiene multa en este recibo');
    for (const m of multas) {
      if (m.estado_pago === 'pagado') throw conflict('La multa ya está pagada: no se puede quitar');
      if (m.estado_pago === 'en_revision' || m.pagos.some((p) => p.estado_validacion === 'por_validar')) throw conflict('La multa tiene un pago en revisión: valídalo o recházalo primero');
      if (m.pagos.some((p) => p.estado_validacion !== 'rechazado')) throw conflict('La multa ya tiene pagos registrados: no se puede quitar');
    }
    let total = new Prisma.Decimal(0);
    for (const m of multas) {
      // Atómico: si alguien la cobró mientras tanto, la condición ya no se cumple y no se toca.
      const abierta = { OR: [{ estado_pago: null }, { estado_pago: { notIn: ['pagado', 'en_revision'] } }], pagos: { none: { estado_validacion: { not: 'rechazado' } } } } satisfies Prisma.ReciboConceptoUnidadWhereInput;
      const r = m.pagos.length === 0
        ? await tx.reciboConceptoUnidad.deleteMany({ where: { id: m.id, ...abierta } })
        : await tx.reciboConceptoUnidad.updateMany({ where: { id: m.id, ...abierta }, data: { monto: 0, observaciones: `Multa quitada: ${o.motivo}` } });
      if (r.count !== 1) throw conflict('La multa cambió mientras la quitabas: recarga e inténtalo de nuevo');
      total = total.plus(m.monto);
    }
    return { monto: total.toFixed(2), codigo: multas[0]!.unidad?.codigo ?? '', cargos: multas.length };
  });
}

// ---------- 3. Aviso junto al pago ----------
export interface AvisoMulta {
  texto: string;
  /** El recibo donde está la multa (el del mes siguiente): ahí se quita. */
  recibo_id: number;
  unidad_id: number;
  monto: string;
}

export interface PagoParaAviso { id: number; estado_validacion: string; fecha_pago: Date; fecha_origen: string; recibo_id: number | null; unidad_id: number | null }

/** Sólo la fecha del voucher (o la que una persona corrigió) respalda decir «pagó a tiempo»: la declarada o la que no se pudo leer, no. */
const ORIGENES_CONFIABLES = ['voucher', 'manual'];

/**
 * Para cada pago: si, según la fecha de su voucher, el departamento pagó a tiempo el recibo del pago y aun así tiene la multa de ese recibo en el recibo
 * del mes siguiente, todavía sin cobrar, devuelve el aviso. «Pagó a tiempo» = el veredicto de `evaluarMora` (el de la emisión) sobre ese recibo.
 * Sin multa por quitar (pagada, en revisión, ya quitada) no hay aviso. El pago rechazado no cuenta. Una consulta por lote; el cálculo sólo para quien ya tiene multa.
 */
export async function avisosDeMulta(pagos: PagoParaAviso[]): Promise<Map<number, AvisoMulta>> {
  const salida = new Map<number, AvisoMulta>();
  const candidatos = pagos.filter((p) => p.estado_validacion !== 'rechazado' && ORIGENES_CONFIABLES.includes(p.fecha_origen) && p.recibo_id != null && p.unidad_id != null);
  if (candidatos.length === 0) return salida;
  const recibos = new Map((await prisma.recibo.findMany({
    where: { id: { in: [...new Set(candidatos.map((p) => p.recibo_id!))] } },
    select: { id: true, mes: true, anio: true, complejo_id: true, estructura_id: true, fecha_vencimiento: true, complejo: { select: { zona_horaria: true } } },
  })).map((r) => [r.id, r]));
  // Sólo los pagos de fecha ≤ vencimiento (en el día del condominio, como lo cuenta la mora).
  const aTiempo = candidatos.filter((p) => {
    const r = recibos.get(p.recibo_id!);
    return r != null && r.complejo_id != null && hoyEn(r.complejo?.zona_horaria ?? ZONA_POR_DEFECTO, p.fecha_pago).getTime() <= diaCalendario(r.fecha_vencimiento).getTime();
  });
  if (aTiempo.length === 0) return salida;
  const siguiente = (r: { mes: number; anio: number }) => (r.mes === 12 ? { mes: 1, anio: r.anio + 1 } : { mes: r.mes + 1, anio: r.anio });
  const pares = new Map<string, { recibo: NonNullable<ReturnType<typeof recibos.get>>; unidadId: number }>();
  for (const p of aTiempo) pares.set(`${p.recibo_id}|${p.unidad_id}`, { recibo: recibos.get(p.recibo_id!)!, unidadId: p.unidad_id! });
  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: {
      AND: [
        { OR: [...pares.values()].map(({ recibo, unidadId }) => ({ unidad_id: unidadId, reciboConcepto: { recibo: { complejo_id: recibo.complejo_id, estructura_id: recibo.estructura_id, ...siguiente(recibo) } } })) },
        { OR: [{ estado_pago: null }, { estado_pago: { notIn: ['pagado', 'en_revision'] } }] },
        { pagos: { none: { estado_validacion: { not: 'rechazado' } } } },
        { monto: { gt: 0 } },
      ],
    },
    select: { id: true, unidad_id: true, monto: true, observaciones: true, reciboConcepto: { select: { recibo_id: true, concepto: { select: { nombre: true } }, recibo: { select: { complejo_id: true, estructura_id: true, mes: true, anio: true } } } } },
  });
  // La multa de ESE recibo: la del sistema lleva su motivo; la que la administradora puso a mano (Excel) no lleva ninguno. La de otro mes no es de este recibo.
  const multaDe = new Map<string, { reciboId: number; monto: Prisma.Decimal }>();
  for (const par of pares.values()) {
    const sig = siguiente(par.recibo);
    const c = cargos.find((x) => x.unidad_id === par.unidadId && x.reciboConcepto?.recibo?.complejo_id === par.recibo.complejo_id && x.reciboConcepto?.recibo?.estructura_id === par.recibo.estructura_id
      && x.reciboConcepto?.recibo?.mes === sig.mes && x.reciboConcepto?.recibo?.anio === sig.anio && esConceptoMora(x.reciboConcepto?.concepto?.nombre) && (x.observaciones == null || x.observaciones === motivoMora(par.recibo)));
    if (c?.reciboConcepto?.recibo_id != null) multaDe.set(`${par.recibo.id}|${par.unidadId}`, { reciboId: c.reciboConcepto.recibo_id, monto: new Prisma.Decimal(c.monto) });
  }
  if (multaDe.size === 0) return salida;
  // Confirmar con el mismo cálculo de la emisión: ¿esa unidad pagó a tiempo el recibo?
  const porRecibo = new Map<number, number[]>();
  for (const k of multaDe.keys()) {
    const [r, u] = k.split('|').map(Number) as [number, number];
    porRecibo.set(r, [...(porRecibo.get(r) ?? []), u]);
  }
  const aTiempoSegunEvaluacion = new Set<string>();
  for (const [reciboId, unidadIds] of porRecibo) {
    const r = recibos.get(reciboId)!;
    const ev = await prisma.$transaction((tx) => evaluarMora(tx, { complejoId: r.complejo_id!, estructuraId: r.estructura_id, ...siguiente(r), unidadIds }));
    if (ev.anterior?.id !== reciboId || ev.aunNoVence) continue;
    for (const id of unidadIds) if (ev.detalle.get(id)?.estado === 'a_tiempo') aTiempoSegunEvaluacion.add(`${reciboId}|${id}`);
  }
  for (const p of aTiempo) {
    const k = `${p.recibo_id}|${p.unidad_id}`;
    const multa = multaDe.get(k);
    if (!multa || !aTiempoSegunEvaluacion.has(k)) continue;
    const r = recibos.get(p.recibo_id!)!;
    salida.set(p.id, { texto: `Según el voucher pagó a tiempo; tiene la multa de ${periodoTexto(r.mes, r.anio)}.`, recibo_id: multa.reciboId, unidad_id: p.unidad_id!, monto: multa.monto.toFixed(2) });
  }
  return salida;
}

/** Agrega `aviso_multa` (o `null`) a los pagos que ve quien administra o la junta: la forma de lista y de detalle de un pago (`recibo` y `unidad` aplanados). */
export async function conAvisoMulta<T extends { id: number; estado_validacion: string; fecha_pago: Date; fecha_origen: string; unidad?: { id: number } | null; recibo?: { id: number } | null }>(items: T[]): Promise<(T & { aviso_multa: AvisoMulta | null })[]> {
  const avisos = await avisosDeMulta(items.map((p) => ({ id: p.id, estado_validacion: p.estado_validacion, fecha_pago: p.fecha_pago, fecha_origen: p.fecha_origen, recibo_id: p.recibo?.id ?? null, unidad_id: p.unidad?.id ?? null })));
  return items.map((p) => ({ ...p, aviso_multa: avisos.get(p.id) ?? null }));
}
