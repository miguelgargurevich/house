import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { decimalAString, filtroEstadoCargo, noPagado } from '../lib/cargos';
import { hoyLima, inicioAnioLima, inicioMesLima, mesesHasta } from '../lib/fechas';
import { listarMantenimientos, type EstadoMantenimiento } from '../lib/mantenimientos';
import { MONEDA_POR_DEFECTO } from '../../lib/paises';
import { cargoEnMoneda, monedasDelAlcance, pagoEnMoneda, porMoneda } from '../lib/paisMoneda';
import { scopeCargos, scopeComplejos, scopeEstructuras, scopePagos, scopeRecibos, scopeTareas, scopeUnidades } from '../lib/scope';
import { currentUser, type AuthUser } from '../middleware/auth';
import { forbidden } from '../errors';
import { idSchema, parse, z } from '../validation';

/** Sólo los pagos validados cuentan como cobrado (uno en revisión o rechazado todavía no es dinero cobrado). */
const validado: Prisma.PagoWhereInput = { estado_validacion: 'validado' };
const sumaMonto = (v: { _sum: { monto: Prisma.Decimal | null } }) => decimalAString(v._sum.monto);

/** Filtro opcional del panel: un condominio y/o una torre (cada torre tiene su propio recibo). */
const filtroPanel = z.object({ complejo_id: idSchema.optional(), estructura_id: idSchema.optional() });
type FiltroPanel = z.infer<typeof filtroPanel>;

/** Los estados del bloque «Estado de mantenimientos»: los mismos que usa la lista de mantenimientos. */
const ESTADOS_PANEL = ['pagado', 'pendiente', 'parcial', 'vencido', 'en_revision'] as const satisfies readonly EstadoMantenimiento[];
type EstadosPanel = Record<(typeof ESTADOS_PANEL)[number], number>;

/**
 * Cuenta mantenimientos (un departamento en un mes) por estado, con la misma regla que la lista. Antes se contaban cargos:
 * un departamento con dos conceptos en el mismo recibo daba dos.
 */
async function contarEstados(unidadIds: number[]): Promise<EstadosPanel> {
  const cuentas = await Promise.all(ESTADOS_PANEL.map((estado) => listarMantenimientos({ unidadIds, estado }, { page: 1, pageSize: 1 })));
  return Object.fromEntries(ESTADOS_PANEL.map((estado, i) => [estado, cuentas[i].total])) as EstadosPanel;
}

/**
 * «block» si todas las estructuras del alcance son blocks; si no, «torre». El tipo se guarda como lo escribió el formulario
 * («Block» o «Torre»), por eso se compara sin distinguir mayúsculas.
 */
async function palabraEstructura(u: AuthUser, f: FiltroPanel): Promise<'block' | 'torre'> {
  const estructuras = await prisma.estructura.findMany({
    where: { AND: [scopeEstructuras(u), f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}] },
    select: { tipo: true },
  });
  return estructuras.length > 0 && estructuras.every((e) => e.tipo.toLowerCase() === 'block') ? 'block' : 'torre';
}

/**
 * Último mes de la serie: el de hoy, o el último mes con recibo si es posterior (el recibo del mes que viene ya está emitido
 * antes de su mes y tiene que salir en «Emitido vs. cobrado»).
 */
async function finSerie(u: AuthUser, recibosEnTorre: Prisma.ReciboWhereInput, hoy: Date): Promise<{ anio: number; mes: number }> {
  const ultimo = await prisma.recibo.findFirst({ where: { AND: [scopeRecibos(u), recibosEnTorre] }, orderBy: [{ anio: 'desc' }, { mes: 'desc' }], select: { anio: true, mes: true } });
  const actual = { anio: hoy.getUTCFullYear(), mes: hoy.getUTCMonth() + 1 };
  return ultimo && ultimo.anio * 12 + ultimo.mes > actual.anio * 12 + actual.mes ? ultimo : actual;
}

async function resumenAdmin(u: AuthUser, f: FiltroPanel = {}) {
  const enUnidad: Prisma.UnidadWhereInput = { ...(f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}), ...(f.estructura_id !== undefined ? { estructura_id: f.estructura_id } : {}) };
  const filtrando = f.complejo_id !== undefined || f.estructura_id !== undefined;
  const cargos: Prisma.ReciboConceptoUnidadWhereInput = filtrando ? { AND: [scopeCargos(u), { unidad: enUnidad }] } : scopeCargos(u);
  const pagosEnTorre: Prisma.PagoWhereInput = filtrando ? { reciboConceptoUnidad: { unidad: enUnidad } } : {};
  const recibosEnTorre: Prisma.ReciboWhereInput = { ...(f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}), ...(f.estructura_id !== undefined ? { estructura_id: f.estructura_id } : {}) };
  const ahora = new Date();
  const hoy = hoyLima(ahora);
  const [unidadIds, palabra, fin] = await Promise.all([
    prisma.unidad.findMany({ where: { AND: [scopeUnidades(u), enUnidad] }, select: { id: true } }).then((us) => us.map((x) => x.id)),
    palabraEstructura(u, f),
    finSerie(u, recibosEnTorre, hoy),
  ]);
  const meses = mesesHasta(6, fin.anio, fin.mes);
  // Los montos van en la moneda del condominio y nunca se suman entre monedas: con una sola en el alcance (lo de siempre) los totales son los de siempre;
  // con varias, se calculan aparte por moneda (`por_moneda`) y los totales de arriba quedan vacíos.
  const monedas = await monedasDelAlcance(
    { AND: [scopeRecibos(u), recibosEnTorre] },
    { AND: [scopeComplejos(u), f.complejo_id !== undefined ? { id: f.complejo_id } : {}] },
  );
  const dineroDe = async (moneda: string | null) => {
    const cargosM: Prisma.ReciboConceptoUnidadWhereInput = moneda ? { AND: [cargos, cargoEnMoneda(moneda)] } : cargos;
    const pagosM: Prisma.PagoWhereInput = moneda ? { AND: [scopePagos(u), pagosEnTorre, pagoEnMoneda(moneda)] } : { AND: [scopePagos(u), pagosEnTorre] };
    const [pendientes, cobradoMes, serie] = await Promise.all([
      prisma.reciboConceptoUnidad.aggregate({ where: { AND: [cargosM, noPagado] }, _sum: { monto: true } }),
      prisma.pago.aggregate({ where: { AND: [pagosM, validado, { fecha_pago: { gte: inicioMesLima(ahora) } }] }, _sum: { monto: true } }),
      Promise.all(
        meses.map(async (m) => {
          const [emitido, cobrado] = await Promise.all([
            prisma.reciboConceptoUnidad.aggregate({ where: { AND: [cargosM, { reciboConcepto: { recibo: { anio: m.anio, mes: m.mes } } }] }, _sum: { monto: true } }),
            prisma.pago.aggregate({ where: { AND: [pagosM, validado, { fecha_pago: { gte: m.desde, lt: m.hasta } }] }, _sum: { monto: true } }),
          ]);
          return { mes: m.clave, emitido: sumaMonto(emitido), cobrado: sumaMonto(cobrado) };
        }),
      ),
    ]);
    return { cargos_pendientes_monto: sumaMonto(pendientes), cobrado_mes: sumaMonto(cobradoMes), cobrado_por_mes: serie };
  };
  const [recibos, periodos, morosos, tareas, estados, porValidar, porTorre, dinero] = await Promise.all([
    prisma.recibo.count({ where: { AND: [scopeRecibos(u), recibosEnTorre] } }),
    // Con un recibo por torre, «recibos emitidos» (N torres × meses) se infla sin sentido: lo que se cuenta como emisión es el PERIODO de un condominio.
    prisma.recibo.groupBy({ by: ['complejo_id', 'anio', 'mes'], where: { AND: [scopeRecibos(u), recibosEnTorre] } }),
    prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [cargos, filtroEstadoCargo('vencido')] } }),
    prisma.tareaMantenimiento.count({ where: { AND: [scopeTareas(u), { estado: { not: 'completada' } }] } }),
    contarEstados(unidadIds),
    prisma.pago.count({ where: { AND: [scopePagos(u), pagosEnTorre, { estado_validacion: 'por_validar' }] } }),
    desglosePorTorre(cargos, palabra),
    monedas.length === 1 ? dineroDe(null) : null,
  ]);
  const montos = dinero
    ? { moneda: monedas[0]!, ...dinero }
    : { moneda: null, cargos_pendientes_monto: null, cobrado_mes: null, cobrado_por_mes: [], por_moneda: await porMoneda(monedas, dineroDe) };
  const base = {
    recibos_emitidos: periodos.length,
    recibos_total: recibos,
    palabra_estructura: palabra,
    por_torre: porTorre,
    ...montos,
    morosos: morosos.length,
    unidades_total: unidadIds.length,
    tareas_abiertas: tareas,
    estados,
    pagos_por_validar: porValidar,
  };
  if (u.rol !== 'superadmin') return base;
  const [empresas_total, usuarios_total] = await Promise.all([prisma.empresaAdministradora.count(), prisma.usuario.count()]);
  return { ...base, empresas_total, usuarios_total };
}

/** Emitido, cobrado, por cobrar y morosos por torre (el dinero de cada torre se mira aparte: tiene su recibo, su junta y sus cuentas). */
async function desglosePorTorre(cargos: Prisma.ReciboConceptoUnidadWhereInput, palabra: 'block' | 'torre') {
  const [todo, cobrado, abierto, vencidos] = await Promise.all([
    prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: cargos, _sum: { monto: true } }),
    prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [cargos, filtroEstadoCargo('pagado')] }, _sum: { monto: true } }),
    prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [cargos, noPagado] }, _sum: { monto: true } }),
    prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [cargos, filtroEstadoCargo('vencido')] } }),
  ]);
  const ids = [...new Set(todo.map((x) => x.unidad_id).filter((x): x is number => x != null))];
  if (!ids.length) return [];
  const unidades = await prisma.unidad.findMany({ where: { id: { in: ids } }, select: { id: true, complejo: { select: { moneda: true } }, estructura: { select: { id: true, nombre: true, complejo: { select: { id: true, nombre: true, moneda: true } } } } } });
  const torreDe = new Map(unidades.map((x) => [x.id, { estructura: x.estructura, moneda: x.estructura?.complejo?.moneda ?? x.complejo?.moneda ?? MONEDA_POR_DEFECTO }]));
  const filas = new Map<string, { estructura_id: number | null; nombre: string; complejo: { id: number; nombre: string } | null; moneda: string; emitido: Prisma.Decimal; cobrado: Prisma.Decimal; por_cobrar: Prisma.Decimal; morosos: number }>();
  // Las unidades sin torre se juntan en una fila «Sin torre», pero una por moneda: nunca se suman montos de monedas distintas.
  const fila = (unidadId: number) => {
    const { estructura: t, moneda } = torreDe.get(unidadId) ?? { estructura: null, moneda: MONEDA_POR_DEFECTO };
    const clave = t ? String(t.id) : `sin:${moneda}`;
    return filas.get(clave) ?? filas.set(clave, { estructura_id: t?.id ?? null, nombre: t?.nombre ?? `Sin ${palabra}`, complejo: t?.complejo ? { id: t.complejo.id, nombre: t.complejo.nombre } : null, moneda, emitido: new Prisma.Decimal(0), cobrado: new Prisma.Decimal(0), por_cobrar: new Prisma.Decimal(0), morosos: 0 }).get(clave)!;
  };
  for (const x of todo) if (x.unidad_id != null) { const f = fila(x.unidad_id); f.emitido = f.emitido.plus(x._sum.monto ?? 0); }
  for (const x of cobrado) if (x.unidad_id != null) { const f = fila(x.unidad_id); f.cobrado = f.cobrado.plus(x._sum.monto ?? 0); }
  for (const x of abierto) if (x.unidad_id != null) { const f = fila(x.unidad_id); f.por_cobrar = f.por_cobrar.plus(x._sum.monto ?? 0); }
  for (const x of vencidos) if (x.unidad_id != null) fila(x.unidad_id).morosos++;
  return [...filas.values()]
    .sort((a, b) => (a.complejo?.nombre ?? '').localeCompare(b.complejo?.nombre ?? '', 'es') || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
    .map((f) => ({ estructura_id: f.estructura_id, nombre: f.nombre, complejo: f.complejo, moneda: f.moneda, emitido: decimalAString(f.emitido), cobrado: decimalAString(f.cobrado), por_cobrar: decimalAString(f.por_cobrar), morosos: f.morosos }));
}

async function resumenResidente(u: AuthUser) {
  const propias = u.rol === 'propietario' ? { propietario_id: u.id } : { inquilino_id: u.id };
  const mios: Prisma.ReciboConceptoUnidadWhereInput = { unidad: propias };
  // Un vecino con unidades en condominios de monedas distintas ve su deuda y lo pagado por moneda, nunca sumados.
  const monedas = await monedasDelAlcance({ reciboConceptos: { some: { reciboConceptoUnidades: { some: mios } } } }, { unidades: { some: propias } });
  const dineroDe = async (moneda: string | null) => {
    const m: Prisma.ReciboConceptoUnidadWhereInput = moneda ? { AND: [mios, cargoEnMoneda(moneda)] } : mios;
    const [deuda, pagadoAnio] = await Promise.all([
      prisma.reciboConceptoUnidad.aggregate({ where: { AND: [m, noPagado] }, _sum: { monto: true } }),
      prisma.pago.aggregate({ where: { reciboConceptoUnidad: m, ...validado, fecha_pago: { gte: inicioAnioLima() } }, _sum: { monto: true } }),
    ]);
    return { deuda_total: sumaMonto(deuda), pagado_ano: sumaMonto(pagadoAnio) };
  };
  const [vencidos, enRevision, proximo, dinero] = await Promise.all([
    prisma.reciboConceptoUnidad.count({ where: { AND: [mios, filtroEstadoCargo('vencido')] } }),
    prisma.reciboConceptoUnidad.count({ where: { AND: [mios, filtroEstadoCargo('en_revision')] } }),
    prisma.reciboConceptoUnidad.findFirst({
      where: { AND: [mios, filtroEstadoCargo('pendiente')] },
      orderBy: [{ reciboConcepto: { recibo: { fecha_vencimiento: 'asc' } } }, { id: 'asc' }],
      select: { id: true, monto: true, reciboConcepto: { select: { recibo: { select: { fecha_vencimiento: true, complejo: { select: { moneda: true } } } } } } },
    }),
    monedas.length === 1 ? dineroDe(null) : null,
  ]);
  const montos = dinero ? { moneda: monedas[0]!, ...dinero } : { moneda: null, deuda_total: null, pagado_ano: null, por_moneda: await porMoneda(monedas, dineroDe) };
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
    ...montos,
    vencidos,
    en_revision: enRevision,
    mantenimientos_vencidos: mVencidos.total,
    mantenimientos_en_revision: mRevision.total,
    proximo_mantenimiento: sig ? { recibo_id: sig.recibo_id, unidad_id: sig.unidad_id, titulo: sig.titulo, torre: sig.unidad.estructura?.nombre ?? null, monto: sig.saldo, moneda: sig.moneda, fecha: sig.fecha_vencimiento } : null,
    proximo_vencimiento: proximo ? { cargo_id: proximo.id, monto: decimalAString(proximo.monto), moneda: proximo.reciboConcepto?.recibo?.complejo?.moneda ?? MONEDA_POR_DEFECTO, fecha: proximo.reciboConcepto?.recibo?.fecha_vencimiento ?? null } : null,
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
      return void res.json(await resumenAdmin(u, parse(filtroPanel, req.query)));
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
