import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { decimalAString, filtroEstadoCargo, noPagado } from '../lib/cargos';
import { inicioAnioLima, inicioMesLima, mesesAtras } from '../lib/fechas';
import { listarMantenimientos } from '../lib/mantenimientos';
import { scopeCargos, scopePagos, scopeRecibos, scopeTareas, scopeUnidades } from '../lib/scope';
import { currentUser, type AuthUser } from '../middleware/auth';
import { forbidden } from '../errors';

/** Sólo los pagos validados cuentan como cobrado (uno en revisión o rechazado todavía no es dinero cobrado). */
const validado: Prisma.PagoWhereInput = { estado_validacion: 'validado' };
const sumaMonto = (v: { _sum: { monto: Prisma.Decimal | null } }) => decimalAString(v._sum.monto);

async function resumenAdmin(u: AuthUser) {
  const cargos = scopeCargos(u);
  const ahora = new Date();
  const meses = mesesAtras(6, ahora);
  const [recibos, pendientes, cobradoMes, morosos, unidades, tareas, pagado, pendiente, vencido, enRevision, porValidar, serie] = await Promise.all([
    prisma.recibo.count({ where: scopeRecibos(u) }),
    prisma.reciboConceptoUnidad.aggregate({ where: { AND: [cargos, noPagado] }, _sum: { monto: true } }),
    prisma.pago.aggregate({ where: { AND: [scopePagos(u), validado, { fecha_pago: { gte: inicioMesLima(ahora) } }] }, _sum: { monto: true } }),
    prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [cargos, filtroEstadoCargo('vencido')] } }),
    prisma.unidad.count({ where: scopeUnidades(u) }),
    prisma.tareaMantenimiento.count({ where: { AND: [scopeTareas(u), { estado: { not: 'completada' } }] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [cargos, filtroEstadoCargo('pagado')] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [cargos, filtroEstadoCargo('pendiente')] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [cargos, filtroEstadoCargo('vencido')] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [cargos, filtroEstadoCargo('en_revision')] } }),
    prisma.pago.count({ where: { AND: [scopePagos(u), { estado_validacion: 'por_validar' }] } }),
    Promise.all(
      meses.map(async (m) => {
        const [emitido, cobrado] = await Promise.all([
          prisma.reciboConceptoUnidad.aggregate({ where: { AND: [cargos, { reciboConcepto: { recibo: { anio: m.anio, mes: m.mes } } }] }, _sum: { monto: true } }),
          prisma.pago.aggregate({ where: { AND: [scopePagos(u), validado, { fecha_pago: { gte: m.desde, lt: m.hasta } }] }, _sum: { monto: true } }),
        ]);
        return { mes: m.clave, emitido: sumaMonto(emitido), cobrado: sumaMonto(cobrado) };
      }),
    ),
  ]);
  const base = {
    recibos_emitidos: recibos,
    cargos_pendientes_monto: sumaMonto(pendientes),
    cobrado_mes: sumaMonto(cobradoMes),
    morosos: morosos.length,
    unidades_total: unidades,
    tareas_abiertas: tareas,
    cobrado_por_mes: serie,
    estados: { pagado, pendiente, vencido, en_revision: enRevision },
    pagos_por_validar: porValidar,
  };
  if (u.rol !== 'superadmin') return base;
  const [empresas_total, usuarios_total] = await Promise.all([prisma.empresaAdministradora.count(), prisma.usuario.count()]);
  return { ...base, empresas_total, usuarios_total };
}

async function resumenResidente(u: AuthUser) {
  const propias = u.rol === 'propietario' ? { propietario_id: u.id } : { inquilino_id: u.id };
  const mios: Prisma.ReciboConceptoUnidadWhereInput = { unidad: propias };
  const [deuda, vencidos, enRevision, proximo, pagadoAnio] = await Promise.all([
    prisma.reciboConceptoUnidad.aggregate({ where: { AND: [mios, noPagado] }, _sum: { monto: true } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [mios, filtroEstadoCargo('vencido')] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [mios, filtroEstadoCargo('en_revision')] } }),
    prisma.reciboConceptoUnidad.findFirst({
      where: { AND: [mios, filtroEstadoCargo('pendiente')] },
      orderBy: [{ reciboConcepto: { recibo: { fecha_vencimiento: 'asc' } } }, { id: 'asc' }],
      select: { id: true, monto: true, reciboConcepto: { select: { recibo: { select: { fecha_vencimiento: true } } } } },
    }),
    prisma.pago.aggregate({ where: { reciboConceptoUnidad: mios, ...validado, fecha_pago: { gte: inicioAnioLima() } }, _sum: { monto: true } }),
  ]);
  // Lo mismo, a nivel mantenimiento (un recibo por departamento y mes): lo que el vecino ve y paga.
  const unidadIds = (await prisma.unidad.findMany({ where: propias, select: { id: true } })).map((x) => x.id);
  const una = { page: 1, pageSize: 1, orden: { campo: 'vencimiento', dir: 'asc' } } as const;
  const [mVencidos, mRevision, mPendiente, mParcial] = await Promise.all([
    listarMantenimientos({ unidadIds, estado: 'vencido' }, una),
    listarMantenimientos({ unidadIds, estado: 'en_revision' }, una),
    listarMantenimientos({ unidadIds, estado: 'pendiente' }, una),
    listarMantenimientos({ unidadIds, estado: 'parcial' }, una),
  ]);
  const sig = [...mPendiente.items, ...mParcial.items].sort((a, b) => a.fecha_vencimiento.getTime() - b.fecha_vencimiento.getTime())[0];
  return {
    deuda_total: sumaMonto(deuda),
    vencidos,
    en_revision: enRevision,
    mantenimientos_vencidos: mVencidos.total,
    mantenimientos_en_revision: mRevision.total,
    proximo_mantenimiento: sig ? { recibo_id: sig.recibo_id, unidad_id: sig.unidad_id, titulo: sig.titulo, monto: sig.saldo, fecha: sig.fecha_vencimiento } : null,
    proximo_vencimiento: proximo ? { cargo_id: proximo.id, monto: decimalAString(proximo.monto), fecha: proximo.reciboConcepto?.recibo?.fecha_vencimiento ?? null } : null,
    pagado_ano: sumaMonto(pagadoAnio),
  };
}

async function resumenMantenimiento(u: AuthUser) {
  const where = (estado: string) => ({ asignado_id: u.id, estado });
  const [tareas_pendientes, en_progreso, completadas] = await Promise.all([
    prisma.tareaMantenimiento.count({ where: where('pendiente') }),
    prisma.tareaMantenimiento.count({ where: where('en_progreso') }),
    prisma.tareaMantenimiento.count({ where: where('completada') }),
  ]);
  return { tareas_pendientes, en_progreso, completadas };
}

async function resumenSeguridad(u: AuthUser) {
  if (u.complejo_id == null) return { unidades_complejo: 0, complejo: null };
  const [unidades_complejo, complejo] = await Promise.all([
    prisma.unidad.count({ where: { complejo_id: u.complejo_id } }),
    prisma.complejoHabitacional.findUnique({ where: { id: u.complejo_id }, select: { id: true, nombre: true } }),
  ]);
  return { unidades_complejo, complejo };
}

export const dashboardRouter = Router();

dashboardRouter.get('/resumen', async (req, res) => {
  const u = currentUser(req);
  switch (u.rol) {
    case 'superadmin':
    case 'admin':
      return void res.json(await resumenAdmin(u));
    case 'propietario':
    case 'inquilino':
      return void res.json(await resumenResidente(u));
    case 'mantenimiento':
    case 'limpieza':
    case 'jardineria':
      return void res.json(await resumenMantenimiento(u));
    case 'seguridad':
      return void res.json(await resumenSeguridad(u));
    default:
      throw forbidden();
  }
});
