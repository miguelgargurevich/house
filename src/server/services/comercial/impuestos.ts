// Impuesto, moneda y precios de la suscripción a House por país. El país es el del CONDOMINIO (`ComplejoHabitacional.pais`): de él salen la moneda en que
// se cobra, el impuesto (IGV, IVA…) y su tasa. Nada de esto vive en el código: `ImpuestoPais` y `PrecioPlanMoneda` los edita el superadmin.
import { Prisma, type ImpuestoPais, type PrecioPlanMoneda } from '@prisma/client';
import { prisma } from '../../db';
import { notFound } from '../../errors';
import { MONEDA_POR_DEFECTO, PAIS_POR_DEFECTO, paisDe } from '../../../lib/paises';
import { CONFIGURACION_ID, MONEDA_BASE_PRECIOS } from './catalogo';
import { obtenerConfiguracion } from './configuracion';

const D = Prisma.Decimal;

/** Lo que rige al cobrar un condominio: su moneda, el impuesto (nombre y tasa en fracción: 0.18 = 18 %) y si su país está abierto a contratar. */
export interface ContextoCobro { pais: string; moneda: string; impuesto_nombre: string; tasa: Prisma.Decimal; activo: boolean }

export interface Referencias { impuestos: Map<string, ImpuestoPais>; precios: PrecioPlanMoneda[]; tasaPeru: Prisma.Decimal }

/** Impuestos por país y precios por moneda, de una vez (se siembran los que falten: `obtenerConfiguracion` lo hace). */
export async function cargarReferencias(): Promise<Referencias> {
  const cfg = await obtenerConfiguracion();
  const [filas, precios] = await Promise.all([prisma.impuestoPais.findMany(), prisma.precioPlanMoneda.findMany()]);
  return { impuestos: new Map(filas.map((f) => [f.pais, f])), precios, tasaPeru: cfg.igv_tasa };
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
    pais: codigo, moneda: cat?.moneda ?? MONEDA_POR_DEFECTO, impuesto_nombre: cat?.impuesto?.nombre ?? 'IGV', activo: false,
    tasa: codigo === PAIS_POR_DEFECTO ? ref.tasaPeru : new D(cat?.impuesto?.tasa ?? 0).div(100),
  };
}

/** Lo que ve un visitante: el país pedido si está abierto; si no, Perú (el de siempre). */
export function contextoPublico(pais: string | null | undefined, ref: Referencias): ContextoCobro {
  const c = contextoDe(pais, ref);
  return c.activo ? c : contextoDe(PAIS_POR_DEFECTO, ref);
}

/**
 * Precio base por departamento al mes de un plan en una moneda; `null` = el plan no tiene precio ahí («Consúltanos»). Un plan gratuito (precio 0 en
 * soles: Gratis, Cortesía) es gratis en todas partes. El precio en soles es `PlanComercial.precio_por_unidad`; el resto, `PrecioPlanMoneda`.
 */
export function precioEnMoneda(plan: { clave: string; precio_por_unidad: Prisma.Decimal }, moneda: string, precios: PrecioPlanMoneda[]): Prisma.Decimal | null {
  if (plan.precio_por_unidad.lte(0)) return new D(0);
  if (moneda === MONEDA_BASE_PRECIOS) return plan.precio_por_unidad;
  return precios.find((p) => p.plan_clave === plan.clave && p.moneda === moneda)?.precio_por_unidad ?? null;
}

/** ¿Se puede pedir este plan de pago en ese país? El país tiene que estar abierto y el plan tener precio en su moneda. */
export const planContratable = (ctx: ContextoCobro, plan: { clave: string; precio_por_unidad: Prisma.Decimal }, precios: PrecioPlanMoneda[]): boolean =>
  ctx.activo && precioEnMoneda(plan, ctx.moneda, precios) !== null;

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
