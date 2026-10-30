// Lectura y cambios de las suscripciones por condominio. La vista es la misma para Mi plan (admin de la empresa) y para Suscripciones (superadmin).
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { conflict, HttpError, invalid, notFound } from '../../errors';
import { hoyLima } from '../../lib/fechas';
import { PAISES, decimalesDe, formatoDinero, monedaEnPlural } from '../../../lib/paises';
import { MONEDA_BASE_PRECIOS, esModulo, type EstadoSuscripcion } from './catalogo';
import { cotizar, desglosarMonto, precioSinIgv, type Cotizacion, type PrecioPlan } from './calculo';
import { correoA, obtenerConfiguracion } from './configuracion';
import { estadoEfectivo, type EntradaSuscripcion } from './estado';
import { cargarReferencias, contextoDe, contextoPublico, planContratable, precioEnMoneda, type ContextoCobro } from './impuestos';
import { comercialDeps, invalidarComercial } from './modulos';

type FilaPlan = { clave: string; precio_por_unidad: Prisma.Decimal; igv_incluido: boolean; modulos_incluidos: string[]; unidades_minimas: number | null };

/** La fila del plan en la forma que usa `cotizar` (precio EN LA MONEDA DEL COBRO, módulos que trae y mínimo de unidades cobradas). */
const precioDePlan = (p: FilaPlan, precio: Prisma.Decimal = p.precio_por_unidad): PrecioPlan => ({
  clave: p.clave, precio_por_unidad: precio, igv_incluido: p.igv_incluido, modulos_incluidos: p.modulos_incluidos, unidades_minimas: p.unidades_minimas,
});

/** Los datos de impuesto de un contexto, en la forma que viaja a las pantallas. */
const impuestoVista = (c: ContextoCobro) => ({ nombre: c.impuesto_nombre, tasa: c.tasa.toString() });

export interface VistaSuscripcion {
  complejo_id: number;
  complejo: string;
  empresa: { id: number; nombre: string } | null;
  plan: { clave: string; nombre: string };
  /** Módulos activos ahora (ya descontado lo vencido pasada la gracia). */
  modulos_activos: string[];
  /** Módulos sueltos contratados además del plan. */
  modulos_sueltos: string[];
  estado: EstadoSuscripcion;
  vigente_hasta: Date | null;
  dias_para_vencer: number | null;
  en_gracia: boolean;
  /** Prueba de Pro vigente (`dias_para_vencer` son los días que le quedan); al vencer ya no aparece aquí, la vista pasa a Gratis. */
  en_prueba: boolean;
  unidades_facturables: number;
  /** Unidades que se cobran: `max(unidades, mínimo del plan)`. */
  unidades_cobradas: number;
  /** Tope de unidades del plan que cuenta ahora (Gratis = 20); null = sin tope. */
  unidades_maximas: number | null;
  /** Mínimo de unidades que cobra el plan contratado (Pro y Administradora = 20); null = sin mínimo. */
  unidades_minimas: number | null;
  /** País del condominio y, de él, la moneda en que paga y el impuesto que se le suma (IGV, IVA…). */
  pais: string;
  moneda: string;
  impuesto: { nombre: string; tasa: string };
  /** Lo que corresponde pagar al mes con lo contratado. */
  cotizacion: Cotizacion;
  /** El plan de pago contratado no tiene precio en la moneda de su país: la cotización no vale, hay que «consultar». */
  precio_consultar: boolean;
  /** Planes de pago que este condominio puede pedir hoy (su país está abierto y el plan tiene precio en su moneda). */
  planes_disponibles: string[];
  solicitud: { plan: string | null; modulos: string[]; en: Date | null; cotizacion: Cotizacion; consultar: boolean } | null;
  /** «HOUSE-<condominio>-<AAAAMM>»: lo que el cliente escribe como referencia al transferir. */
  referencia_pago: string;
  notas?: string | null;
}

export const referenciaPago = (complejoId: number, ahora: Date): string => {
  const h = hoyLima(ahora);
  return `HOUSE-${complejoId}-${h.getUTCFullYear()}${String(h.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Arma la vista de una lista de condominios con pocas consultas (planes, catálogo, unidades y suscripciones por lote). */
export async function vistas(complejoIds: number[], opts: { conNotas?: boolean } = {}): Promise<VistaSuscripcion[]> {
  if (!complejoIds.length) return [];
  const ahora = comercialDeps.ahora();
  const [complejos, suscripciones, unidades, planes, catalogo, cfg, ref] = await Promise.all([
    prisma.complejoHabitacional.findMany({ where: { id: { in: complejoIds } }, select: { id: true, nombre: true, pais: true, empresa: { select: { id: true, nombre: true } } }, orderBy: { nombre: 'asc' } }),
    prisma.suscripcionCondominio.findMany({ where: { complejo_id: { in: complejoIds } } }),
    prisma.unidad.groupBy({ by: ['complejo_id'], where: { complejo_id: { in: complejoIds } }, _count: { _all: true } }),
    prisma.planComercial.findMany({ orderBy: { orden: 'asc' } }),
    prisma.moduloComercial.findMany(),
    obtenerConfiguracion(),
    cargarReferencias(),
  ]);
  const sus = new Map(suscripciones.map((s) => [s.complejo_id, s]));
  const uni = new Map(unidades.map((u) => [u.complejo_id, u._count._all]));
  const plazos = { dias_gracia: cfg.dias_gracia, dias_aviso_vencimiento: cfg.dias_aviso_vencimiento };
  const catalogoPrecios = catalogo.map((m) => ({ clave: m.clave, precio_por_unidad: m.precio_por_unidad }));
  const planDe = (clave: string | null | undefined) => (clave ? planes.find((p) => p.clave === clave) ?? null : null);
  return complejos.map((c) => {
    const s = sus.get(c.id) ?? null;
    const entrada: EntradaSuscripcion | null = s;
    const ef = estadoEfectivo(entrada, planes, plazos, ahora);
    const plan = planDe(ef.plan_clave) ?? planDe('gratis');
    const n = uni.get(c.id) ?? 0;
    const ctx = contextoDe(c.pais, ref);
    // Los módulos sueltos de las suscripciones antiguas tienen su precio en soles: sólo cuentan donde se cobra en soles.
    const preciosModulos = ctx.moneda === MONEDA_BASE_PRECIOS ? catalogoPrecios : [];
    /** El plan cotizado en la moneda del condominio; sin precio ahí queda sin cotizar y `consultar` en true. */
    const cotizarPlan = (p: typeof plan, modulosSueltos: string[]) => {
      const precioMoneda = p ? precioEnMoneda(p, ctx.moneda, ref.precios) : null;
      const cot = cotizar({ unidades: n, plan: p && precioMoneda !== null ? precioDePlan(p, precioMoneda) : null, modulosSueltos, catalogo: preciosModulos, tasa: ctx.tasa, moneda: ctx.moneda, impuestoNombre: ctx.impuesto_nombre });
      return { cot, consultar: p != null && precioMoneda === null };
    };
    // Vencido y apagado se comporta como Gratis también para el tope de unidades.
    const planTope = ef.apagada ? planDe('gratis') : plan;
    const sueltos = s?.modulos ?? [];
    // Cortesía no cobra nada aunque su plan traiga todo.
    const cobra = ef.plan_clave !== 'cortesia';
    const { cot, consultar } = cobra ? cotizarPlan(plan, sueltos) : { cot: cotizarPlan(null, []).cot, consultar: false };
    let solicitud: VistaSuscripcion['solicitud'] = null;
    if (s && (s.solicitud_plan || s.solicitud_modulos.length)) {
      const { cot: cotSol, consultar: consultarSol } = cotizarPlan(planDe(s.solicitud_plan) ?? plan, [...new Set([...sueltos, ...s.solicitud_modulos])]);
      solicitud = { plan: s.solicitud_plan, modulos: s.solicitud_modulos, en: s.solicitada_at, cotizacion: cotSol, consultar: consultarSol };
    }
    return {
      complejo_id: c.id,
      complejo: c.nombre,
      empresa: c.empresa,
      plan: { clave: ef.plan_clave, nombre: plan?.nombre ?? ef.plan_clave },
      modulos_activos: ef.modulos,
      modulos_sueltos: sueltos,
      estado: ef.estado,
      vigente_hasta: s?.vigente_hasta ?? null,
      dias_para_vencer: ef.dias_para_vencer,
      en_gracia: ef.en_gracia,
      en_prueba: ef.en_prueba,
      unidades_facturables: n,
      unidades_cobradas: cot.unidades_cobradas,
      unidades_maximas: planTope?.unidades_maximas ?? null,
      unidades_minimas: cobra ? plan?.unidades_minimas ?? null : null,
      pais: ctx.pais,
      moneda: ctx.moneda,
      impuesto: impuestoVista(ctx),
      cotizacion: cot,
      precio_consultar: consultar,
      planes_disponibles: planes.filter((p) => p.visible && !['gratis', 'cortesia'].includes(p.clave) && planContratable(ctx, p, ref.precios)).map((p) => p.clave),
      solicitud,
      referencia_pago: referenciaPago(c.id, ahora),
      ...(opts.conNotas ? { notas: s?.notas ?? null } : {}),
    };
  });
}

/** Lo que el cliente necesita para pagar: datos de la configuración (nada más). */
export async function datosParaPagar() {
  const c = await obtenerConfiguracion();
  return { titular: c.pago_titular, banco: c.pago_banco, cuenta: c.pago_cuenta, cci: c.pago_cci, yape: c.pago_yape, instrucciones: c.pago_instrucciones, igv_tasa: c.igv_tasa.toString(), dias_gracia: c.dias_gracia };
}

// ---------- Solicitud del cliente ----------
export async function solicitar(complejoId: number, d: { plan: string }, quien: { nombre: string; email: string }): Promise<void> {
  const [planes, complejo, ref] = await Promise.all([
    prisma.planComercial.findMany({ where: { visible: true, clave: { notIn: ['gratis', 'cortesia'] } } }),
    prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: complejoId }, select: { pais: true } }),
    cargarReferencias(),
  ]);
  // Los módulos ya no se piden sueltos: se pide un plan (Pro o Administradora) y trae todo.
  const plan = planes.find((p) => p.clave === d.plan);
  if (!plan) throw invalid('Datos inválidos: plan: ese plan no está disponible', { plan: 'Plan no disponible' });
  // Sin precio en la moneda del país del condominio no se puede contratar: se atiende por consulta.
  if (!planContratable(contextoDe(complejo.pais, ref), plan, ref.precios)) throw invalid('Datos inválidos: plan: todavía no tiene precio en tu país; consúltanos', { plan: 'Consúltanos: aún no hay precio en tu país' });
  const actual = await prisma.suscripcionCondominio.findUnique({ where: { complejo_id: complejoId }, select: { estado: true } });
  const guardado = !actual || actual.estado === 'gratis' || actual.estado === 'activa' ? 'solicitada' : actual.estado; // por_vencer / vencida siguen siendo lo que son
  await prisma.suscripcionCondominio.upsert({
    where: { complejo_id: complejoId },
    create: { complejo_id: complejoId, solicitud_plan: d.plan, solicitud_modulos: [], solicitada_at: comercialDeps.ahora(), estado: 'solicitada' },
    update: { solicitud_plan: d.plan, solicitud_modulos: [], solicitada_at: comercialDeps.ahora(), estado: guardado },
  });
  invalidarComercial(complejoId);
  const [v] = await vistas([complejoId]);
  const cfg = await obtenerConfiguracion();
  if (cfg.correo_superadmin) {
    await correoA(cfg.correo_superadmin, `Solicitud de plan: ${v.complejo}`, `${quien.nombre} (${quien.email}) de ${v.empresa?.nombre ?? 'sin empresa'} pidió el plan ${d.plan} para «${v.complejo}» (${v.unidades_facturables} departamentos${v.unidades_cobradas > v.unidades_facturables ? `; se cobra el mínimo de ${v.unidades_cobradas}` : ''}).\nMonto al mes con lo pedido: ${v.solicitud ? formatoDinero(v.solicitud.cotizacion.total_mes, v.moneda) : '—'} (${v.impuesto.nombre} incluido).\nReferencia de pago: ${v.referencia_pago}.\nActívalo desde Suscripciones cuando llegue el pago.`).catch(() => undefined);
  }
}

export async function cancelarSolicitud(complejoId: number): Promise<void> {
  const s = await prisma.suscripcionCondominio.findUnique({ where: { complejo_id: complejoId } });
  if (!s || (!s.solicitud_plan && !s.solicitud_modulos.length)) return;
  await prisma.suscripcionCondominio.update({ where: { complejo_id: complejoId }, data: { solicitud_plan: null, solicitud_modulos: [], solicitada_at: null, estado: s.estado === 'solicitada' ? 'gratis' : s.estado } });
  invalidarComercial(complejoId);
  await sincronizarEstado(complejoId);
}

/** Guarda en la fila el estado que corresponde HOY (la lista y los filtros lo leen de ahí; las puertas lo calculan en vivo). */
export async function sincronizarEstado(complejoId: number): Promise<void> {
  const s = await prisma.suscripcionCondominio.findUnique({ where: { complejo_id: complejoId } });
  if (!s) return;
  const [planes, cfg] = await Promise.all([prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true } }), obtenerConfiguracion()]);
  const ef = estadoEfectivo(s, planes, { dias_gracia: cfg.dias_gracia, dias_aviso_vencimiento: cfg.dias_aviso_vencimiento }, comercialDeps.ahora());
  if (ef.estado !== s.estado) await prisma.suscripcionCondominio.update({ where: { complejo_id: complejoId }, data: { estado: ef.estado } });
  invalidarComercial(complejoId);
}

// ---------- Superadmin ----------
export interface CambioSuscripcion { plan_clave?: string; modulos?: string[]; vigente_hasta?: Date | null; notas?: string | null }

export async function cambiarSuscripcion(complejoId: number, c: CambioSuscripcion): Promise<void> {
  if (c.plan_clave !== undefined && !(await prisma.planComercial.findUnique({ where: { clave: c.plan_clave }, select: { clave: true } }))) throw invalid('Datos inválidos: plan_clave: plan inexistente', { plan_clave: 'Plan inexistente' });
  for (const m of c.modulos ?? []) if (!esModulo(m)) throw invalid(`Datos inválidos: modulos: «${m}» no es un módulo`, { modulos: 'Módulo inexistente' });
  // Elegir plan o módulos resuelve la solicitud del cliente.
  const resuelve = c.plan_clave !== undefined || c.modulos !== undefined;
  // Los módulos sueltos de una suscripción antigua se respetan hasta que cambie de plan; al cambiarlo se vacían (el plan nuevo trae lo suyo), salvo que se pidan a la vez.
  const actual = c.plan_clave !== undefined && c.modulos === undefined ? await prisma.suscripcionCondominio.findUnique({ where: { complejo_id: complejoId }, select: { plan_clave: true } }) : null;
  const cambiaDePlan = c.plan_clave !== undefined && c.modulos === undefined && (actual?.plan_clave ?? 'gratis') !== c.plan_clave;
  const datos: Prisma.SuscripcionCondominioUncheckedUpdateInput = {
    ...(c.plan_clave !== undefined ? { plan_clave: c.plan_clave } : {}),
    ...(c.modulos !== undefined ? { modulos: [...new Set(c.modulos)] } : cambiaDePlan ? { modulos: [] } : {}),
    ...(c.vigente_hasta !== undefined ? { vigente_hasta: c.vigente_hasta } : {}),
    ...(c.notas !== undefined ? { notas: c.notas } : {}),
    ...(resuelve ? { solicitud_plan: null, solicitud_modulos: [], solicitada_at: null } : {}),
    // Un plan o una vigencia puesto a mano por el superadmin deja de ser una prueba (si no, vencería a Gratis sin aviso).
    ...(c.plan_clave !== undefined || c.vigente_hasta !== undefined ? { es_prueba: false } : {}),
  };
  await prisma.suscripcionCondominio.upsert({
    where: { complejo_id: complejoId },
    create: { complejo_id: complejoId, plan_clave: c.plan_clave ?? 'gratis', modulos: [...new Set(c.modulos ?? [])], vigente_hasta: c.vigente_hasta ?? null, notas: c.notas ?? null },
    update: datos,
  });
  await sincronizarEstado(complejoId);
}

export interface DatosPago { monto: string; fecha_pago: Date; medio: string; operacion?: string | null; periodo_desde: Date; periodo_hasta: Date; voucher_ref?: string | null; notas?: string | null }

/**
 * Registra un pago manual y extiende `vigente_hasta` hasta el final del periodo cubierto (nunca lo acorta). Si el cliente había solicitado un
 * plan o módulos, el pago los activa. Todo en una transacción; una misma operación no se registra dos veces.
 */
export async function registrarPago(complejoId: number, d: DatosPago, registradoPorId: number) {
  if (d.periodo_hasta < d.periodo_desde) throw invalid('Datos inválidos: periodo_hasta: debe ser igual o posterior al inicio', { periodo_hasta: 'Debe ser posterior al inicio' });
  const complejo = await prisma.complejoHabitacional.findUnique({ where: { id: complejoId }, select: { id: true, empresa_id: true, pais: true } });
  if (!complejo) throw notFound('Condominio');
  // El pago es en la moneda del país del condominio y con el impuesto que rige ahí HOY; queda guardado así y ya no cambia.
  const ctx = contextoDe(complejo.pais, await cargarReferencias());
  if (decimalesDe(ctx.moneda) === 0 && /\./.test(d.monto)) throw invalid(`Datos inválidos: monto: en ${monedaEnPlural(ctx.moneda)} el monto no lleva decimales`, { monto: 'Sin decimales en esta moneda' });
  const { base, igv, total } = desglosarMonto(d.monto, ctx.tasa, ctx.moneda);
  const pago = await prisma.$transaction(async (tx) => {
    const s = await tx.suscripcionCondominio.findUnique({ where: { complejo_id: complejoId } });
    if (d.operacion && (await tx.pagoSuscripcion.findFirst({ where: { complejo_id: complejoId, operacion: d.operacion }, select: { id: true } }))) throw conflict('Ya hay un pago registrado con esa operación para este condominio');
    const plan = s?.solicitud_plan ?? s?.plan_clave ?? 'gratis';
    // Pagar un plan distinto del actual deja los módulos sueltos viejos atrás (el plan nuevo trae lo suyo); con el mismo plan se conservan.
    const cambiaDePlan = s?.solicitud_plan != null && s.solicitud_plan !== s.plan_clave;
    const modulos = [...new Set([...(cambiaDePlan ? [] : s?.modulos ?? []), ...(s?.solicitud_modulos ?? [])])];
    const planFila = await tx.planComercial.findUnique({ where: { clave: plan }, select: { modulos_incluidos: true } });
    if (plan === 'gratis' && !modulos.length) throw conflict('Este condominio está en Gratis y no tiene módulos: cambia su plan o sus módulos antes de registrar el pago');
    if (plan === 'cortesia' && !modulos.length && !(planFila?.modulos_incluidos.length ?? 0)) throw conflict('Un condominio en cortesía no paga');
    const vigente = s?.vigente_hasta && s.vigente_hasta > d.periodo_hasta ? s.vigente_hasta : d.periodo_hasta;
    // Pagar convierte una prueba en un pago normal: la marca se apaga y el periodo pagado sigue igual.
    const datos = { plan_clave: plan, modulos, vigente_hasta: vigente, solicitud_plan: null, solicitud_modulos: [] as string[], solicitada_at: null, estado: 'activa', es_prueba: false };
    await tx.suscripcionCondominio.upsert({ where: { complejo_id: complejoId }, create: { complejo_id: complejoId, ...datos }, update: datos });
    return tx.pagoSuscripcion.create({
      data: {
        complejo_id: complejoId, empresa_id: complejo.empresa_id, monto_base: base, igv, monto: total, moneda: ctx.moneda, impuesto_nombre: ctx.impuesto_nombre, impuesto_tasa: ctx.tasa, fecha_pago: d.fecha_pago, medio: d.medio,
        operacion: d.operacion ?? null, periodo_desde: d.periodo_desde, periodo_hasta: d.periodo_hasta, voucher_ref: d.voucher_ref ?? null, notas: d.notas ?? null, registrado_por_id: registradoPorId,
      },
    });
  });
  await sincronizarEstado(complejoId);
  return pago;
}

export const pagoVista = (p: { id: number; complejo_id: number; monto_base: Prisma.Decimal; igv: Prisma.Decimal; monto: Prisma.Decimal; moneda: string; impuesto_nombre: string; impuesto_tasa: Prisma.Decimal; fecha_pago: Date; medio: string; operacion: string | null; periodo_desde: Date; periodo_hasta: Date; voucher_ref: string | null; notas: string | null; created_at: Date }) => ({
  id: p.id, complejo_id: p.complejo_id, base: p.monto_base.toFixed(decimalesDe(p.moneda)), igv: p.igv.toFixed(decimalesDe(p.moneda)), monto: p.monto.toFixed(decimalesDe(p.moneda)), moneda: p.moneda, impuesto_nombre: p.impuesto_nombre, impuesto_tasa: p.impuesto_tasa.toString(), fecha_pago: p.fecha_pago, medio: p.medio,
  operacion: p.operacion, periodo_desde: p.periodo_desde, periodo_hasta: p.periodo_hasta, voucher_ref: p.voucher_ref, notas: p.notas, registrado_en: p.created_at,
});

/** Los países abiertos a contratar, para el selector de /precios (con su moneda y el nombre de su impuesto). */
const paisesAbiertos = (ref: Awaited<ReturnType<typeof cargarReferencias>>) => PAISES
  .map((p) => contextoDe(p.codigo, ref))
  .filter((c) => c.activo)
  .map((c) => ({ codigo: c.pais, nombre: PAISES.find((p) => p.codigo === c.pais)?.nombre ?? c.pais, bandera: PAISES.find((p) => p.codigo === c.pais)?.bandera ?? '', moneda: c.moneda, impuesto: impuestoVista(c) }));

/**
 * Precios públicos SIN impuesto, en la moneda del país pedido (Perú si no se pide o el país no está abierto); el impuesto (IGV, IVA…) se suma al
 * pagar. Un plan de pago sin precio en esa moneda sale con `precio_por_unidad: null` y `consultar: true` («Consúltanos»).
 */
export async function catalogoPublico(pais?: string | null) {
  const [planes, modulos, cfg, ref] = await Promise.all([
    prisma.planComercial.findMany({ where: { visible: true }, orderBy: { orden: 'asc' } }),
    prisma.moduloComercial.findMany({ where: { activo: true }, orderBy: { orden: 'asc' } }),
    obtenerConfiguracion(),
    cargarReferencias(),
  ]);
  const ctx = contextoPublico(pais, ref);
  const dm = decimalesDe(ctx.moneda);
  return {
    pais: ctx.pais,
    moneda: ctx.moneda,
    impuesto: impuestoVista(ctx),
    paises: paisesAbiertos(ref),
    igv_incluido: false,
    planes: planes.map((p) => {
      const precio = precioEnMoneda(p, ctx.moneda, ref.precios);
      return {
        clave: p.clave, nombre: p.nombre, descripcion: p.descripcion, precio_por_unidad: precio === null ? null : precioSinIgv(precio, ctx.tasa, p.igv_incluido, dm).toFixed(dm), consultar: precio === null,
        modulos_incluidos: p.modulos_incluidos, caracteristicas: p.caracteristicas, unidades_maximas: p.unidades_maximas, unidades_minimas: p.unidades_minimas,
        // Lo menos que paga un condominio con este plan (el mínimo de unidades × el precio, sin impuesto), calculado aquí para que la página no haga cuentas.
        total_minimo_mes: p.unidades_minimas && precio !== null ? cotizar({ unidades: 0, plan: precioDePlan(p, precio), modulosSueltos: [], catalogo: [], tasa: ctx.tasa, moneda: ctx.moneda }).base : null,
      };
    }),
    // Los módulos ya no se venden sueltos: se muestran como «lo que trae Pro» (sin precio).
    modulos: modulos.map((m) => ({ clave: m.clave, nombre: m.nombre, descripcion: m.descripcion })),
    registro_abierto: cfg.registro_abierto,
  };
}

/**
 * Cotización pública SIN impuesto (`total_mes`, `total_anio`); aparte el impuesto y el total con impuesto del mes, para quien quiera verlo: el mismo cálculo
 * que Mi plan (con el mínimo de unidades del plan), sin precios en el código del frontend. Sin módulos sueltos. Si el plan no tiene precio en la moneda del
 * país, los totales son `null` y `consultar` es true.
 */
export async function cotizacionPublica(unidades: number, planClave: string | null, pais?: string | null) {
  const [planes, ref] = await Promise.all([prisma.planComercial.findMany({ where: { visible: true } }), cargarReferencias()]);
  const plan = planClave ? planes.find((p) => p.clave === planClave) : null;
  if (planClave && !plan) throw new HttpError(422, 'Datos inválidos: plan: no existe', { plan: 'Plan inexistente' });
  const ctx = contextoPublico(pais, ref);
  const precio = plan ? precioEnMoneda(plan, ctx.moneda, ref.precios) : null;
  const c = cotizar({ unidades, plan: plan && precio !== null ? precioDePlan(plan, precio) : null, modulosSueltos: [], catalogo: [], tasa: ctx.tasa, moneda: ctx.moneda, impuestoNombre: ctx.impuesto_nombre });
  const comun = { pais: ctx.pais, moneda: ctx.moneda, impuesto_nombre: ctx.impuesto_nombre, unidades: c.unidades, unidades_cobradas: c.unidades_cobradas, minimo_aplicado: c.minimo_aplicado, igv_incluido: false };
  if (plan && precio === null) return { ...comun, consultar: true, total_mes: null, total_anio: null, igv_mes: null, total_con_igv_mes: null };
  return { ...comun, consultar: false, total_mes: c.base, total_anio: new Prisma.Decimal(c.base).times(12).toFixed(decimalesDe(ctx.moneda)), igv_mes: c.igv, total_con_igv_mes: c.total_mes };
}
