import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { decimalAString, filtroEstadoCargo } from '../lib/cargos';
import { inicioAnioLima, inicioMesLima, mesesAtras } from '../lib/fechas';
import { scopeCargos, scopePagos, scopeRecibos, scopeTareas, scopeUnidades } from '../lib/scope';
import { currentUser, type AuthUser } from '../middleware/auth';
import { forbidden } from '../errors';

const noPagado: Prisma.ReciboConceptoUnidadWhereInput = { OR: [{ estado_pago: null }, { estado_pago: { not: 'pagado' } }] };
const sumaMonto = (v: { _sum: { monto: Prisma.Decimal | null } }) => decimalAString(v._sum.monto);

async function resumenAdmin(u: AuthUser) {
  const cargos = scopeCargos(u);
  const ahora = new Date();
  const meses = mesesAtras(6, ahora);
  const [recibos, pendientes, cobradoMes, morosos, unidades, tareas, pagado, pendiente, vencido, serie] = await Promise.all([
    prisma.recibo.count({ where: scopeRecibos(u) }),
    prisma.reciboConceptoUnidad.aggregate({ where: { AND: [cargos, noPagado] }, _sum: { monto: true } }),
    prisma.pago.aggregate({ where: { AND: [scopePagos(u), { fecha_pago: { gte: inicioMesLima(ahora) } }] }, _sum: { monto: true } }),
    prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [cargos, filtroEstadoCargo('vencido')] } }),
    prisma.unidad.count({ where: scopeUnidades(u) }),
    prisma.tareaMantenimiento.count({ where: { AND: [scopeTareas(u), { estado: { not: 'completada' } }] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [cargos, filtroEstadoCargo('pagado')] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [cargos, filtroEstadoCargo('pendiente')] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [cargos, filtroEstadoCargo('vencido')] } }),
    Promise.all(
      meses.map(async (m) => {
        const [emitido, cobrado] = await Promise.all([
          prisma.reciboConceptoUnidad.aggregate({ where: { AND: [cargos, { reciboConcepto: { recibo: { anio: m.anio, mes: m.mes } } }] }, _sum: { monto: true } }),
          prisma.pago.aggregate({ where: { AND: [scopePagos(u), { fecha_pago: { gte: m.desde, lt: m.hasta } }] }, _sum: { monto: true } }),
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
    estados: { pagado, pendiente, vencido },
  };
  if (u.rol !== 'superadmin') return base;
  const [empresas_total, usuarios_total] = await Promise.all([prisma.empresaAdministradora.count(), prisma.usuario.count()]);
  return { ...base, empresas_total, usuarios_total };
}

async function resumenResidente(u: AuthUser) {
  const propias = u.rol === 'propietario' ? { propietario_id: u.id } : { inquilino_id: u.id };
  const mios: Prisma.ReciboConceptoUnidadWhereInput = { unidad: propias };
  const [deuda, vencidos, proximo, pagadoAnio] = await Promise.all([
    prisma.reciboConceptoUnidad.aggregate({ where: { AND: [mios, noPagado] }, _sum: { monto: true } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [mios, filtroEstadoCargo('vencido')] } }),
    prisma.reciboConceptoUnidad.findFirst({
      where: { AND: [mios, filtroEstadoCargo('pendiente')] },
      orderBy: [{ reciboConcepto: { recibo: { fecha_vencimiento: 'asc' } } }, { id: 'asc' }],
      select: { id: true, monto: true, reciboConcepto: { select: { recibo: { select: { fecha_vencimiento: true } } } } },
    }),
    prisma.pago.aggregate({ where: { reciboConceptoUnidad: mios, fecha_pago: { gte: inicioAnioLima() } }, _sum: { monto: true } }),
  ]);
  return {
    deuda_total: sumaMonto(deuda),
    vencidos,
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
      return void res.json(await resumenMantenimiento(u));
    case 'seguridad':
      return void res.json(await resumenSeguridad(u));
    default:
      throw forbidden();
  }
});
