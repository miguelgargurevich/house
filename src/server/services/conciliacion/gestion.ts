// Lo que se ve y se hace sobre una cuenta ya importada: resumen, abonos con sus sugerencias, «vouchers sin abono», y vincular / desvincular / ignorar a mano.
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { conflict, invalid, notFound } from '../../errors';
import { diaEn } from '../../lib/fechas';
import { soloPrincipales } from '../mantenimiento';
import { alcanceDePagos, bloquearCuenta, cruzarEn, sanearCuenta, type CuentaDeConciliacion } from './cruce';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
const dec = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const dosDecimales = (v: Prisma.Decimal | number | string | null | undefined) => dec(v).toFixed(2);
const diaISO = (d: Date) => d.toISOString().slice(0, 10);

export const ESTADOS_MOVIMIENTO = ['conciliado', 'por_revisar', 'sin_pago', 'ignorado'] as const;
export type EstadoMovimiento = (typeof ESTADOS_MOVIMIENTO)[number];

export interface CuentaCompleta extends CuentaDeConciliacion { moneda: string; zona: string }

export interface PagoResumen {
  id: number;
  fecha_pago: string;
  total: string;
  metodo_pago: string | null;
  referencia: string | null;
  estado_validacion: string;
  unidad: { codigo: string; estructura: string | null } | null;
  pagador: string | null;
}

const seleccionPago = {
  id: true, monto: true, fecha_pago: true, metodo_pago: true, referencia: true, estado_validacion: true, grupo: true,
  usuario: { select: { nombre: true } },
  reciboConceptoUnidad: { select: { unidad: { select: { codigo: true, estructura: { select: { nombre: true } } } } } },
} satisfies Prisma.PagoSelect;

/** Resúmenes de pagos (principales) con su TOTAL de grupo y su fecha como día del condominio. */
export async function resumenesDePagos(db: Db, ids: number[], zona: string): Promise<Map<number, PagoResumen>> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return new Map();
  const pagos = await db.pago.findMany({ where: { id: { in: unicos } }, select: seleccionPago });
  const grupos = [...new Set(pagos.map((p) => p.grupo).filter((g): g is string => g != null))];
  const sumas = grupos.length ? await db.pago.groupBy({ by: ['grupo'], where: { grupo: { in: grupos } }, _sum: { monto: true } }) : [];
  const totales = new Map(sumas.map((s) => [s.grupo!, dec(s._sum.monto)]));
  return new Map(pagos.map((p) => {
    const u = p.reciboConceptoUnidad?.unidad;
    return [p.id, {
      id: p.id,
      fecha_pago: diaEn(p.fecha_pago, zona),
      total: dosDecimales(p.grupo != null ? (totales.get(p.grupo) ?? p.monto) : p.monto),
      metodo_pago: p.metodo_pago,
      referencia: p.referencia,
      estado_validacion: p.estado_validacion,
      unidad: u ? { codigo: u.codigo, estructura: u.estructura?.nombre ?? null } : null,
      pagador: p.usuario?.nombre ?? null,
    }];
  }));
}

// ---------- Abonos ----------
const seleccionMovimiento = { include: { vinculado_por: { select: { nombre: true } } } } satisfies Prisma.MovimientoBancarioDefaultArgs;
type MovimientoConDatos = Prisma.MovimientoBancarioGetPayload<typeof seleccionMovimiento>;

export async function formatearMovimientos(db: Db, filas: MovimientoConDatos[], zona: string) {
  const pagos = await resumenesDePagos(db, filas.flatMap((m) => [...(m.pago_id != null ? [m.pago_id] : []), ...(m.estado === 'por_revisar' ? m.candidatos : [])]), zona);
  return filas.map((m) => ({
    id: m.id,
    fecha: diaISO(m.fecha),
    descripcion: m.descripcion,
    monto: dosDecimales(m.monto),
    numero_operacion: m.numero_operacion,
    estado: m.estado as EstadoMovimiento,
    vinculo: m.vinculo,
    vinculado_at: m.vinculado_at,
    vinculado_por: m.vinculado_por?.nombre ?? null,
    motivo_ignorar: m.motivo_ignorar,
    pago: m.pago_id != null ? (pagos.get(m.pago_id) ?? null) : null,
    sugerencias: m.estado === 'por_revisar' ? m.candidatos.map((id) => pagos.get(id)).filter((p): p is PagoResumen => p != null) : [],
  }));
}

export async function listarMovimientos(cuenta: CuentaCompleta, f: { estado?: EstadoMovimiento; q?: string; page: number; pageSize: number }) {
  const where: Prisma.MovimientoBancarioWhereInput = {
    medio_pago_id: cuenta.id,
    ...(f.estado ? { estado: f.estado } : {}),
    ...(f.q ? { OR: [{ descripcion: { contains: f.q, mode: 'insensitive' } }, { numero_operacion: { contains: f.q, mode: 'insensitive' } }, ...(/^\d+([.,]\d{1,2})?$/.test(f.q) ? [{ monto: new Prisma.Decimal(f.q.replace(',', '.')) }] : [])] } : {}),
  };
  // Un abono «conciliado» cuyo pago se borró vuelve a «sin pago» antes de listar (idempotente).
  await prisma.$transaction((tx) => sanearCuenta(tx, cuenta.id));
  const [total, filas] = await Promise.all([
    prisma.movimientoBancario.count({ where }),
    prisma.movimientoBancario.findMany({ where, ...seleccionMovimiento, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
  ]);
  return { items: await formatearMovimientos(prisma, filas, cuenta.zona), total, page: f.page, pageSize: f.pageSize };
}

// ---------- Vouchers sin abono ----------
/**
 * Pagos VALIDADOS dentro de los días que cubren los extractos de la cuenta que no tienen ningún abono: alguien subió un voucher y el dinero no aparece en el
 * banco. No cuentan los pagos en efectivo (no pasan por la cuenta), los de un block que tiene su propia cuenta cuando ésta es la del condominio, ni los que están
 * entre las sugerencias de un abono «por revisar» (ésos faltan por vincular, no por llegar).
 */
export async function vouchersSinAbono(cuenta: CuentaCompleta, opts: { limite?: number } = {}) {
  const extractos = await prisma.extractoBancario.findMany({ where: { medio_pago_id: cuenta.id, fecha_desde: { not: null }, fecha_hasta: { not: null } }, select: { fecha_desde: true, fecha_hasta: true } });
  const vacio = { cantidad: 0, monto: '0.00', items: [] as PagoResumen[] };
  if (!extractos.length) return vacio;
  const rangos = extractos.map((e) => [e.fecha_desde!.getTime(), e.fecha_hasta!.getTime()] as const);
  const minimo = Math.min(...rangos.map((r) => r[0]));
  const maximo = Math.max(...rangos.map((r) => r[1]));
  const DIA = 86_400_000;
  const [propias, revisables] = await Promise.all([
    cuenta.estructura_id == null
      ? prisma.medioPago.findMany({ where: { complejo_id: cuenta.complejo_id, estructura_id: { not: null }, tipo: 'banco', activo: true }, select: { estructura_id: true } })
      : Promise.resolve([]),
    prisma.movimientoBancario.findMany({ where: { medio_pago_id: cuenta.id, estado: 'por_revisar' }, select: { candidatos: true } }),
  ]);
  const bloquesPropios = propias.map((m) => m.estructura_id!);
  const enRevision = new Set(revisables.flatMap((m) => m.candidatos));
  const pagos = await prisma.pago.findMany({
    where: {
      AND: [
        soloPrincipales,
        alcanceDePagos(cuenta),
        { estado_validacion: 'validado', metodo_pago: { not: 'efectivo' }, movimientoBancario: { is: null }, fecha_pago: { gte: new Date(minimo - 2 * DIA), lte: new Date(maximo + 2 * DIA) } },
        // Un pago sin block (estructura null) también cuenta: por eso el `OR` explícito y no un `NOT … IN`.
        ...(bloquesPropios.length ? [{ OR: [{ reciboConceptoUnidad: { unidad: { estructura_id: null } } }, { reciboConceptoUnidad: { unidad: { estructura_id: { notIn: bloquesPropios } } } }] }] : []),
      ],
    },
    select: { id: true, fecha_pago: true },
    orderBy: [{ fecha_pago: 'asc' }, { id: 'asc' }],
  });
  const ids = pagos
    .filter((p) => !enRevision.has(p.id))
    .filter((p) => { const d = Date.parse(`${diaEn(p.fecha_pago, cuenta.zona)}T00:00:00Z`); return rangos.some(([a, b]) => d >= a && d <= b); })
    .map((p) => p.id);
  if (!ids.length) return vacio;
  const resumenes = await resumenesDePagos(prisma, ids, cuenta.zona);
  const todos = ids.map((id) => resumenes.get(id)).filter((p): p is PagoResumen => p != null);
  return { cantidad: todos.length, monto: dosDecimales(todos.reduce((s, p) => s.plus(p.total), dec(0))), items: todos.slice(0, opts.limite ?? 100) };
}

// ---------- Resumen ----------
export async function resumenDeCuenta(cuenta: CuentaCompleta) {
  await prisma.$transaction((tx) => sanearCuenta(tx, cuenta.id));
  const [grupos, extractos, sinAbono] = await Promise.all([
    prisma.movimientoBancario.groupBy({ by: ['estado'], where: { medio_pago_id: cuenta.id }, _count: { _all: true }, _sum: { monto: true } }),
    prisma.extractoBancario.findMany({ where: { medio_pago_id: cuenta.id }, select: { fecha_desde: true, fecha_hasta: true } }),
    vouchersSinAbono(cuenta, { limite: 0 }),
  ]);
  const de = (e: EstadoMovimiento) => { const g = grupos.find((x) => x.estado === e); return { cantidad: g?._count._all ?? 0, monto: dosDecimales(g?._sum.monto) }; };
  const todos = ESTADOS_MOVIMIENTO.map(de);
  const desde = extractos.flatMap((e) => (e.fecha_desde ? [e.fecha_desde.getTime()] : []));
  const hasta = extractos.flatMap((e) => (e.fecha_hasta ? [e.fecha_hasta.getTime()] : []));
  return {
    moneda: cuenta.moneda,
    conciliados: de('conciliado'),
    por_revisar: de('por_revisar'),
    sin_pago: de('sin_pago'),
    ignorados: de('ignorado'),
    total: { cantidad: todos.reduce((s, x) => s + x.cantidad, 0), monto: dosDecimales(todos.reduce((s, x) => s.plus(x.monto), dec(0))) },
    vouchers_sin_abono: { cantidad: sinAbono.cantidad, monto: sinAbono.monto },
    extractos: extractos.length,
    rango: desde.length ? { desde: diaISO(new Date(Math.min(...desde))), hasta: diaISO(new Date(Math.max(...hasta))) } : null,
  };
}

// ---------- Acciones a mano ----------
const cargarMovimiento = async (tx: Tx, cuenta: CuentaCompleta, id: number) => {
  const m = await tx.movimientoBancario.findFirst({ where: { id, medio_pago_id: cuenta.id } });
  if (!m) throw notFound('Movimiento');
  return m;
};

/** Pagos que se pueden vincular a mano a un abono de la cuenta: del alcance de la cuenta, no rechazados y sin otro abono. Los de monto igual y fecha cercana, primero. */
export async function buscarPagos(cuenta: CuentaCompleta, movimiento: { fecha: Date; monto: Prisma.Decimal }, q: string | undefined) {
  const pagos = await prisma.pago.findMany({
    where: {
      AND: [
        soloPrincipales,
        alcanceDePagos(cuenta),
        { estado_validacion: { in: ['por_validar', 'validado'] }, movimientoBancario: { is: null } },
        ...(q ? [{ OR: [{ referencia: { contains: q, mode: 'insensitive' as const } }, { reciboConceptoUnidad: { unidad: { codigo: { contains: q, mode: 'insensitive' as const } } } }] }] : []),
      ],
    },
    select: { id: true, fecha_pago: true },
    orderBy: { fecha_pago: 'desc' },
    take: q ? 40 : 200,
  });
  const resumenes = await resumenesDePagos(prisma, pagos.map((p) => p.id), cuenta.zona);
  const dia = movimiento.fecha.getTime();
  const lista = [...resumenes.values()].map((p) => ({ p, igual: dec(p.total).equals(movimiento.monto), lejos: Math.abs(Date.parse(`${p.fecha_pago}T00:00:00Z`) - dia) }));
  lista.sort((a, b) => Number(b.igual) - Number(a.igual) || a.lejos - b.lejos || a.p.id - b.p.id);
  return lista.slice(0, 20).map((x) => x.p);
}

/** El pago que representa a otro: si es un concepto de un grupo, su principal. */
async function principalDe(tx: Tx, pagoId: number): Promise<number | null> {
  const p = await tx.pago.findUnique({ where: { id: pagoId }, select: { id: true, grupo: true, grupo_principal: true } });
  if (!p) return null;
  if (p.grupo == null || p.grupo_principal) return p.id;
  return (await tx.pago.findFirst({ where: { grupo: p.grupo, grupo_principal: true }, select: { id: true } }))?.id ?? null;
}

export async function vincular(cuenta: CuentaCompleta, movimientoId: number, pagoId: number, usuarioId: number) {
  return prisma.$transaction(async (tx) => {
    await bloquearCuenta(tx, cuenta.id);
    const m = await cargarMovimiento(tx, cuenta, movimientoId);
    if (m.estado === 'conciliado') throw conflict('Este abono ya está conciliado: desvincúlalo primero');
    if (m.estado === 'ignorado') throw conflict('Este abono está ignorado: quítale el «ignorar» (desvincular) antes de vincularlo');
    const principal = await principalDe(tx, pagoId);
    const pago = principal == null ? null : await tx.pago.findFirst({ where: { AND: [{ id: principal }, soloPrincipales, alcanceDePagos(cuenta)] }, select: { id: true, estado_validacion: true, movimientoBancario: { select: { id: true } } } });
    if (!pago) throw notFound('Pago');
    if (pago.estado_validacion === 'rechazado') throw invalid('Un pago rechazado no se concilia con un abono', { pago_id: 'Pago rechazado' });
    if (pago.movimientoBancario) throw conflict('Ese pago ya está conciliado con otro abono');
    await tx.movimientoBancario.update({ where: { id: m.id }, data: { estado: 'conciliado', pago_id: pago.id, vinculo: 'manual', manual: true, vinculado_por_id: usuarioId, vinculado_at: new Date(), motivo_ignorar: null, candidatos: [] } });
    await cruzarEn(tx, cuenta); // lo que sugería este pago a otros abonos se recalcula
    return { movimiento_id: m.id, pago_id: pago.id, monto: dosDecimales(m.monto) };
  }, { timeout: 30_000 });
}

/** Suelta el vínculo (o el «ignorar»): el abono queda «sin pago» y el cruce automático ya no lo toca; se vincula a mano o se ignora. */
export async function desvincular(cuenta: CuentaCompleta, movimientoId: number) {
  return prisma.$transaction(async (tx) => {
    await bloquearCuenta(tx, cuenta.id);
    const m = await cargarMovimiento(tx, cuenta, movimientoId);
    if (m.estado !== 'conciliado' && m.estado !== 'ignorado') throw conflict('Este abono no está conciliado ni ignorado');
    await tx.movimientoBancario.update({ where: { id: m.id }, data: { estado: 'sin_pago', pago_id: null, vinculo: null, manual: true, vinculado_por_id: null, vinculado_at: null, motivo_ignorar: null, candidatos: [] } });
    await cruzarEn(tx, cuenta); // el pago liberado puede encajar con otro abono
    return { movimiento_id: m.id, pago_id: m.pago_id, estado_anterior: m.estado };
  }, { timeout: 30_000 });
}

export async function ignorar(cuenta: CuentaCompleta, movimientoId: number, motivo: string, usuarioId: number) {
  return prisma.$transaction(async (tx) => {
    await bloquearCuenta(tx, cuenta.id);
    const m = await cargarMovimiento(tx, cuenta, movimientoId);
    if (m.estado === 'conciliado') throw conflict('Este abono está conciliado con un pago: desvincúlalo antes de ignorarlo');
    await tx.movimientoBancario.update({ where: { id: m.id }, data: { estado: 'ignorado', pago_id: null, vinculo: null, manual: true, vinculado_por_id: usuarioId, vinculado_at: new Date(), motivo_ignorar: motivo, candidatos: [] } });
    await cruzarEn(tx, cuenta);
    return { movimiento_id: m.id, monto: dosDecimales(m.monto) };
  }, { timeout: 30_000 });
}
