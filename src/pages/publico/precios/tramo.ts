import type { Plan } from '../catalogo';

type Formato = (monto: string, moneda: string) => string;

/** «S/ X por departamento desde el N»: el tramo de un plan (del catálogo); `null` si el plan no lo tiene. Sin dependencias de la app: se prueba en Node. */
export const tramoTexto = (p: Plan, moneda: string, formato: Formato): string | null =>
  p.tramo_desde != null && p.tramo_precio != null ? `${formato(p.tramo_precio, moneda)} por departamento desde el ${p.tramo_desde}` : null;

/**
 * Lo que sigue a «incluye hasta 20 departamentos» en la tarjeta de un plan con precio base, siempre del catálogo:
 * sin tramo, «; desde el 21, S/ X cada uno»; con tramo, «; del 21 al 60, S/ X cada uno; desde el 61, S/ Y».
 * Vacío si el plan no tiene mínimo o no tiene precio en la moneda del país.
 */
export const despuesDelPrecioBase = (p: Plan, moneda: string, formato: Formato): string => {
  if (p.unidades_minimas == null || p.precio_por_unidad === null) return '';
  const primero = p.unidades_minimas + 1;
  const normal = formato(p.precio_por_unidad, moneda);
  if (p.tramo_desde == null || p.tramo_precio == null) return `; desde el ${primero}, ${normal} cada uno`;
  const tramo = formato(p.tramo_precio, moneda);
  // Tramo pegado al precio base: no hay un rango «del 21 al 20», se salta.
  if (p.tramo_desde <= primero) return `; desde el ${p.tramo_desde}, ${tramo} cada uno`;
  const hasta = p.tramo_desde - 1;
  return `; ${hasta === primero ? `el ${primero}` : `del ${primero} al ${hasta}`}, ${normal} cada uno; desde el ${p.tramo_desde}, ${tramo}`;
};
