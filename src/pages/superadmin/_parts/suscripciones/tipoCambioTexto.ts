// Lógica pura de la tarjeta «Tipo de cambio» (sin React ni `api`): se prueba en Node. El rango es el mismo que valida el servidor.
export interface TipoCambioDatos { tipo_cambio_usd: string | null; tipo_cambio_manual: boolean; tipo_cambio_at: string | null; tipo_cambio_fuente: string | null }

/** Soles por dólar que acepta el servidor (`TIPO_CAMBIO_MIN`/`TIPO_CAMBIO_MAX` de `services/comercial/tipoCambio.ts`): fuera de ahí es un dedazo. */
export const TC_MIN = 2;
export const TC_MAX = 6;

/** ¿Lo escrito es un tipo de cambio que el servidor aceptaría? Admite coma decimal. */
export const tipoCambioEscritoValido = (v: string): boolean => {
  const t = v.trim();
  const n = Number(t.replace(',', '.'));
  return /^\d{1,2}([.,]\d{1,6})?$/.test(t) && n >= TC_MIN && n <= TC_MAX;
};

/** Lo escrito (con coma o punto) como lo espera la API. */
export const tipoCambioParaApi = (v: string): string => v.trim().replace(',', '.');

/** «1 US$ = S/ 3.8000» o «Sin tipo de cambio». */
export const textoDelValor = (c: TipoCambioDatos): string => (c.tipo_cambio_usd === null ? 'Sin tipo de cambio' : `1 US$ = S/ ${Number(c.tipo_cambio_usd).toFixed(4)}`);

/** Fecha y hora de Lima. */
export const cuando = (iso: string | null): string => (iso ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(iso)) : '—');

/** De dónde salió y si se actualiza solo. */
export function textoDelOrigen(c: TipoCambioDatos): string {
  if (c.tipo_cambio_usd === null) return 'Todavía no se leyó. Se lee solo al arrancar el servidor; también puedes fijarlo a mano o pedir la lectura ahora.';
  return c.tipo_cambio_manual
    ? `Fijado a mano el ${cuando(c.tipo_cambio_at)} (hora de Lima). La lectura diaria no lo pisa.`
    : `Leído de ${c.tipo_cambio_fuente ?? 'la fuente'} el ${cuando(c.tipo_cambio_at)} (hora de Lima). Se actualiza solo cada 24 horas.`;
}
