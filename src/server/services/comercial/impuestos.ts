// Impuesto, moneda y precios de la suscripción a House por país. El país es el del CONDOMINIO (`ComplejoHabitacional.pais`): de él salen la moneda en que
// se cobra, el impuesto (IGV, IVA…) y su tasa. Nada de esto vive en el código: `ImpuestoPais` y `PrecioPlanMoneda` los edita el superadmin.
// Moneda: Perú cobra en soles; los demás países en dólares (US$), con el precio en soles ÷ el tipo de cambio (`tipoCambio.ts`), sin filas de precio.
import { Prisma, type ImpuestoPais, type PrecioPlanMoneda } from '@prisma/client';
import { prisma } from '../../db';
import { notFound } from '../../errors';
import { MONEDA_COBRO_EXTRANJERO, PAIS_POR_DEFECTO, monedaDeCobroSuscripcion, paisDe } from '../../../lib/paises';
import { CONFIGURACION_ID, MONEDA_BASE_PRECIOS } from './catalogo';
import { obtenerConfiguracion } from './configuracion';

const D = Prisma.Decimal;

/** Lo que rige al cobrar un condominio: su moneda, el impuesto (nombre y tasa en fracción: 0.18 = 18 %) y si su país está abierto a contratar. */
export interface ContextoCobro { pais: string; moneda: string; impuesto_nombre: string; tasa: Prisma.Decimal; activo: boolean }

/** `tipoCambio`: soles por 1 US$ (null = todavía no hay uno: el precio en dólares sale «Consúltanos»). */
export interface Referencias { impuestos: Map<string, ImpuestoPais>; precios: PrecioPlanMoneda[]; tasaPeru: Prisma.Decimal; tipoCambio: Prisma.Decimal | null }

/** Lo que hace falta para poner precio en una moneda: las filas por moneda y el tipo de cambio para los dólares. */
export type PreciosRef = Pick<Referencias, 'precios' | 'tipoCambio'>;

/** Impuestos por país y precios por moneda, de una vez (se siembran los que falten: `obtenerConfiguracion` lo hace). */
export async function cargarReferencias(): Promise<Referencias> {
  const cfg = await obtenerConfiguracion();
  const [filas, precios] = await Promise.all([prisma.impuestoPais.findMany(), prisma.precioPlanMoneda.findMany()]);
  return { impuestos: new Map(filas.map((f) => [f.pais, f])), precios, tasaPeru: cfg.igv_tasa, tipoCambio: cfg.tipo_cambio_usd };
}

/**
 * El contexto de cobro de un país. Sin fila (no debería pasar: se siembran todos) se arma con el catálogo, y Perú con `igv_tasa`; el país queda
 * «no activo» para que no se ofrezca a contratar.
 */
export function contextoDe(pais: string | null | undefined, ref: Referencias): ContextoCobro {
  const codigo = pais || PAIS_POR_DEFECTO;
  const f = ref.impuestos.get(codigo);
  if (f) return { pais: codigo, moneda: f.moneda, impuesto_nombre: f.nombre, tasa: f.tasa, activo: f.activo };
  const cat = paisDe(codigo);
  return {
    pais: codigo, moneda: monedaDeCobroSuscripcion(codigo), impuesto_nombre: cat?.impuesto?.nombre ?? 'IGV', activo: false,
    tasa: codigo === PAIS_POR_DEFECTO ? ref.tasaPeru : new D(cat?.impuesto?.tasa ?? 0).div(100),
  };
}

/** Lo que ve un visitante: el país pedido si está abierto; si no, Perú (el de siempre). */
export function contextoPublico(pais: string | null | undefined, ref: Referencias): ContextoCobro {
  const c = contextoDe(pais, ref);
  return c.activo ? c : contextoDe(PAIS_POR_DEFECTO, ref);
}

/** Soles → dólares al tipo de cambio, a 2 decimales (mitad hacia arriba). El mismo redondeo para el precio y el del tramo. */
export const solesADolares = (soles: Prisma.Decimal, tipoCambio: Prisma.Decimal): Prisma.Decimal => soles.div(tipoCambio).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Precio base por departamento al mes de un plan en una moneda; `null` = el plan no tiene precio ahí («Consúltanos»). Un plan gratuito (precio 0 en
 * soles: Gratis, Cortesía) es gratis en todas partes. El precio en soles es `PlanComercial.precio_por_unidad`. En dólares NUNCA se lee `PrecioPlanMoneda`:
 * es el precio en soles ÷ el tipo de cambio (sin tipo de cambio guardado: `null`). El resto de monedas salen de `PrecioPlanMoneda`.
 */
export function precioEnMoneda(plan: { clave: string; precio_por_unidad: Prisma.Decimal }, moneda: string, ref: PreciosRef): Prisma.Decimal | null {
  if (plan.precio_por_unidad.lte(0)) return new D(0);
  if (moneda === MONEDA_BASE_PRECIOS) return plan.precio_por_unidad;
  if (moneda === MONEDA_COBRO_EXTRANJERO) return ref.tipoCambio ? solesADolares(plan.precio_por_unidad, ref.tipoCambio) : null;
  return ref.precios.find((p) => p.plan_clave === plan.clave && p.moneda === moneda)?.precio_por_unidad ?? null;
}

/**
 * Tramo del plan en una moneda: desde qué departamento rige y su precio base (mismas convenciones que `precioEnMoneda`). `null` = precio único. En soles
 * es el del plan (`tramo_desde` + `tramo_precio`); en dólares, ese precio ÷ el tipo de cambio; en otra moneda hace falta `tramo_precio_por_unidad` de esa
 * moneda (nunca se convierte desde soles). Un plan gratuito no tiene tramo.
 */
export function tramoEnMoneda(plan: { clave: string; precio_por_unidad: Prisma.Decimal; tramo_desde: number | null; tramo_precio: Prisma.Decimal | null }, moneda: string, ref: PreciosRef): { desde: number; precio: Prisma.Decimal } | null {
  if (plan.precio_por_unidad.lte(0) || plan.tramo_desde == null) return null;
  let precio: Prisma.Decimal | null;
  if (moneda === MONEDA_BASE_PRECIOS) precio = plan.tramo_precio;
  else if (moneda === MONEDA_COBRO_EXTRANJERO) precio = plan.tramo_precio && ref.tipoCambio ? solesADolares(plan.tramo_precio, ref.tipoCambio) : null;
  else precio = ref.precios.find((p) => p.plan_clave === plan.clave && p.moneda === moneda)?.tramo_precio_por_unidad ?? null;
  return precio == null ? null : { desde: plan.tramo_desde, precio };
}

/**
 * Precio base y de tramo de cada plan de pago en dólares, tal como se cobra (precio en soles ÷ tipo de cambio, a 2 decimales); lo que ve el superadmin en
 * Precios. Sin tipo de cambio guardado la lista sale vacía (todo es «Consúltanos»). Gratis y cortesía no entran.
 */
export function preciosEnDolares(planes: { clave: string; precio_por_unidad: Prisma.Decimal; tramo_desde: number | null; tramo_precio: Prisma.Decimal | null }[], ref: PreciosRef): { plan_clave: string; moneda: string; precio_por_unidad: string; tramo_precio_por_unidad: string | null }[] {
  return planes.flatMap((p) => {
    const precio = p.precio_por_unidad.gt(0) ? precioEnMoneda(p, MONEDA_COBRO_EXTRANJERO, ref) : null;
    if (precio === null) return [];
    const tramo = tramoEnMoneda(p, MONEDA_COBRO_EXTRANJERO, ref);
    return [{ plan_clave: p.clave, moneda: MONEDA_COBRO_EXTRANJERO, precio_por_unidad: precio.toFixed(2), tramo_precio_por_unidad: tramo ? tramo.precio.toFixed(2) : null }];
  });
}

/** ¿Se puede pedir este plan de pago en ese país? El país tiene que estar abierto y el plan tener precio en su moneda. */
export const planContratable = (ctx: ContextoCobro, plan: { clave: string; precio_por_unidad: Prisma.Decimal }, ref: PreciosRef): boolean =>
  ctx.activo && precioEnMoneda(plan, ctx.moneda, ref) !== null;

export interface CambioImpuesto { nombre?: string; tasa?: string; moneda?: string; activo?: boolean }

/** Edita el impuesto de un país. La tasa de Perú se refleja en `ConfiguracionComercial.igv_tasa` (el respaldo de siempre) para que ambas no discrepen. */
export async function cambiarImpuesto(pais: string, c: CambioImpuesto): Promise<ImpuestoPais> {
  await obtenerConfiguracion();
  if (!(await prisma.impuestoPais.findUnique({ where: { pais }, select: { pais: true } }))) throw notFound('País');
  const datos = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as CambioImpuesto;
  const fila = await prisma.impuestoPais.update({ where: { pais }, data: datos });
  if (pais === PAIS_POR_DEFECTO && datos.tasa !== undefined) await prisma.configuracionComercial.update({ where: { id: CONFIGURACION_ID }, data: { igv_tasa: new D(datos.tasa) } });
  return fila;
}

/** `igv_tasa` de la configuración manda sobre Perú: editarla desde ahí (como siempre) cambia también el impuesto de Perú. */
export async function reflejarTasaEnPeru(tasa: string): Promise<void> {
  await obtenerConfiguracion();
  await prisma.impuestoPais.update({ where: { pais: PAIS_POR_DEFECTO }, data: { tasa: new D(tasa) } });
}
