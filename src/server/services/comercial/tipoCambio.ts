// Tipo de cambio PEN por USD: con él los países que no son Perú pagan la suscripción en dólares (precio en soles ÷ tipo de cambio).
// Vive en `ConfiguracionComercial` (`tipo_cambio_usd`, `_manual`, `_at`, `_fuente`). Dos modos:
//  - automático: una tarea en proceso lo lee al arrancar si falta o tiene más de 24 h, y luego revisa cada hora (se refresca cuando pasan 24 h; si las
//    fuentes fallaron, reintenta a la hora siguiente). Fuente PRINCIPAL = SUNAT, el tipo de cambio oficial del día en texto plano público (sin clave ni
//    captcha): `https://www.sunat.gob.pe/a/txt/tipoCambio.txt` → `DD/MM/AAAA|compra|venta|`. Se usa la columna VENTA (la de los comprobantes en moneda
//    extranjera) y se rechaza si el formato no es exactamente ese, la fecha no existe o es de más de 7 días atrás (hora de Lima): así un archivo congelado
//    no pasa por «vigente» (en fin de semana o feriado SUNAT repite la última fecha publicada). RESPALDO = open.er-api.com (campo `rates.PEN`, sin clave),
//    sólo si SUNAT falla. `tipo_cambio_fuente` guarda la que de verdad respondió: `sunat.gob.pe` u `open.er-api.com`.
//    (No se usa el endpoint de la página de consulta de SUNAT: pide un token de reCAPTCHA y no se debe sortear.)
//  - manual: lo fija el superadmin (`tipo_cambio_fuente` = «manual») y la tarea NO lo pisa hasta que vuelva a «automático».
// Si las dos fuentes fallan (red, formato, valor absurdo) se deja el último valor y se registra en el log: nunca rompe nada.
import { Prisma } from '@prisma/client';
import { isProduction } from '../../config';
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { CONFIGURACION_ID } from './catalogo';
import { obtenerConfiguracion } from './configuracion';

const D = Prisma.Decimal;

/** Un tipo de cambio razonable de soles por dólar. Fuera de este rango es un error de la fuente (o un dedazo del superadmin): no se guarda. */
export const TIPO_CAMBIO_MIN = 2;
export const TIPO_CAMBIO_MAX = 6;
/** Fuente principal: el texto oficial de SUNAT (`DD/MM/AAAA|compra|venta|`). */
export const FUENTE_SUNAT_URL = 'https://www.sunat.gob.pe/a/txt/tipoCambio.txt';
export const FUENTE_SUNAT = 'sunat.gob.pe';
/** Respaldo (sólo si SUNAT falla). */
export const FUENTE_TIPO_CAMBIO_URL = 'https://open.er-api.com/v6/latest/USD';
export const FUENTE_TIPO_CAMBIO = 'open.er-api.com';
/** Antigüedad máxima (días, hora de Lima) de la fecha que trae SUNAT, y cuántos días a futuro se toleran (el viernes ya puede traer el lunes). */
export const SUNAT_MAX_ANTIGUEDAD_DIAS = 7;
export const SUNAT_MAX_ADELANTO_DIAS = 3;
export const FUENTE_MANUAL = 'manual';
/** Decimales con que se guarda (un tipo de cambio de 3,7512 no se redondea a 3,75). */
const DECIMALES = 4;
export const MAX_EDAD_MS = 24 * 3_600_000;
export const CADA_TIPO_CAMBIO_MS = 3_600_000;
export const PRIMERA_PASADA_TIPO_CAMBIO_MS = 20_000;
const TOPE_FETCH_MS = 10_000;

/** Puntos de inyección: `fetch` (nunca red real en las pruebas) y el reloj. */
export const tipoCambioDeps = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
  ahora: (): Date => new Date(),
};

/** ¿Es un valor guardable? Número finito dentro de [`TIPO_CAMBIO_MIN`, `TIPO_CAMBIO_MAX`]; devuelve el `Decimal` redondeado a 4 decimales o `null`. */
export function tipoCambioValido(valor: unknown): Prisma.Decimal | null {
  if (typeof valor !== 'number' && typeof valor !== 'string') return null;
  if (typeof valor === 'string' && !/^\d{1,2}(\.\d+)?$/.test(valor.trim())) return null;
  if (typeof valor === 'number' && !Number.isFinite(valor)) return null;
  const d = new D(typeof valor === 'string' ? valor.trim() : valor).toDecimalPlaces(DECIMALES, Prisma.Decimal.ROUND_HALF_UP);
  return d.gte(TIPO_CAMBIO_MIN) && d.lte(TIPO_CAMBIO_MAX) ? d : null;
}

/** El día de calendario de `ahora` en Lima, como número de días desde 1970 (para restar fechas sin horas de por medio). */
function diaEnLima(ahora: Date): number {
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora).split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86_400_000;
}

/**
 * Interpreta el texto de SUNAT: exactamente `DD/MM/AAAA|compra|venta|` (se toleran espacios y el salto de línea al final). Devuelve la venta; lanza un
 * `Error` de mensaje fijo (nunca con datos de la respuesta) si el formato, la fecha, la antigüedad o el valor no cuadran.
 */
export function interpretarTextoSunat(texto: string, ahora: Date): Prisma.Decimal {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\|(\d{1,2}(?:\.\d+)?)\|(\d{1,2}(?:\.\d+)?)\|$/.exec(texto.trim());
  if (!m) throw new Error('el formato del texto no es el esperado');
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) throw new Error('la fecha no existe');
  const antiguedad = diaEnLima(ahora) - f.getTime() / 86_400_000;
  if (antiguedad > SUNAT_MAX_ANTIGUEDAD_DIAS) throw new Error(`la fecha publicada tiene más de ${SUNAT_MAX_ANTIGUEDAD_DIAS} días`);
  if (antiguedad < -SUNAT_MAX_ADELANTO_DIAS) throw new Error('la fecha publicada es del futuro');
  const venta = tipoCambioValido(m[5]);
  if (!venta) throw new Error(`la venta está fuera de ${TIPO_CAMBIO_MIN}–${TIPO_CAMBIO_MAX}`);
  return venta;
}

/** Lee el tipo de cambio de venta del texto oficial de SUNAT. Lanza un `Error` corto (sin datos de la respuesta) si algo no cuadra. */
async function leerDeSunat(): Promise<Prisma.Decimal> {
  let texto: string;
  try {
    const resp = await tipoCambioDeps.fetch(FUENTE_SUNAT_URL, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(TOPE_FETCH_MS) });
    if (!resp.ok) throw new Error(`respondió ${resp.status}`);
    texto = await resp.text();
  } catch (err) {
    throw new Error(err instanceof Error && /^respondió \d+$/.test(err.message) ? err.message : 'no se pudo leer');
  }
  return interpretarTextoSunat(texto, tipoCambioDeps.ahora());
}

export interface LecturaTipoCambio { valor: Prisma.Decimal; fuente: string }

/** Lee el tipo de cambio: SUNAT primero; si falla, el respaldo. Devuelve el valor y la fuente que de verdad respondió; lanza si fallan las dos. */
export async function leerTipoCambioDeFuente(): Promise<LecturaTipoCambio> {
  try {
    return { valor: await leerDeSunat(), fuente: FUENTE_SUNAT };
  } catch (err) {
    console.warn(`[tipo-cambio] SUNAT falló (${err instanceof Error ? err.message : 'error'}), uso el respaldo`);
  }
  return { valor: await leerDelRespaldo(), fuente: FUENTE_TIPO_CAMBIO };
}

/** Lee el tipo de cambio del respaldo (open.er-api.com). Lanza un `Error` (con mensaje corto, sin datos de la respuesta) si algo no cuadra. */
async function leerDelRespaldo(): Promise<Prisma.Decimal> {
  const resp = await tipoCambioDeps.fetch(FUENTE_TIPO_CAMBIO_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TOPE_FETCH_MS) });
  if (!resp.ok) throw new Error(`la fuente respondió ${resp.status}`);
  const cuerpo = (await resp.json().catch(() => null)) as { result?: unknown; rates?: { PEN?: unknown } } | null;
  if (!cuerpo || (cuerpo.result !== undefined && cuerpo.result !== 'success')) throw new Error('la fuente no devolvió un resultado válido');
  const d = tipoCambioValido(cuerpo.rates?.PEN);
  if (!d) throw new Error(`el valor de la fuente no es razonable (debe estar entre ${TIPO_CAMBIO_MIN} y ${TIPO_CAMBIO_MAX})`);
  return d;
}

export interface EstadoTipoCambio { tipo_cambio: Prisma.Decimal | null; manual: boolean; at: Date | null; fuente: string | null }

export async function estadoTipoCambio(): Promise<EstadoTipoCambio> {
  const c = await obtenerConfiguracion();
  return { tipo_cambio: c.tipo_cambio_usd, manual: c.tipo_cambio_manual, at: c.tipo_cambio_at, fuente: c.tipo_cambio_fuente };
}

/** El tipo de cambio vigente (para convertir precios) o `null` si no hay uno guardado. */
export const tipoCambioVigente = async (): Promise<Prisma.Decimal | null> => (await estadoTipoCambio()).tipo_cambio;

/** El superadmin lo fija a mano: pasa a manual (la tarea ya no lo pisa). Lanza 422 si no es razonable. */
export async function fijarTipoCambioManual(valor: string): Promise<EstadoTipoCambio> {
  const d = tipoCambioValido(valor);
  if (!d) throw new HttpError(422, `Datos inválidos: tipo_cambio: debe ser un número entre ${TIPO_CAMBIO_MIN} y ${TIPO_CAMBIO_MAX} (soles por 1 US$)`, { tipo_cambio: `Entre ${TIPO_CAMBIO_MIN} y ${TIPO_CAMBIO_MAX} soles por dólar` });
  await obtenerConfiguracion();
  await prisma.configuracionComercial.update({ where: { id: CONFIGURACION_ID }, data: { tipo_cambio_usd: d, tipo_cambio_manual: true, tipo_cambio_at: tipoCambioDeps.ahora(), tipo_cambio_fuente: FUENTE_MANUAL } });
  return estadoTipoCambio();
}

/**
 * Vuelve a automático y lo refresca en ese momento. Si la fuente no responde bien NO cambia nada (sigue en manual con su valor) y responde 502: así el
 * superadmin no queda con un «automático» que en realidad es un valor a mano de otra fecha.
 */
export async function volverAAutomatico(): Promise<EstadoTipoCambio> {
  await obtenerConfiguracion();
  let lectura: LecturaTipoCambio;
  try {
    lectura = await leerTipoCambioDeFuente();
  } catch (err) {
    console.error('[tipo-cambio] no se pudo volver a automático:', err instanceof Error ? err.message : 'error');
    throw new HttpError(502, 'No se pudo leer el tipo de cambio de la fuente; sigue el valor a mano. Inténtalo en unos minutos');
  }
  await prisma.configuracionComercial.update({ where: { id: CONFIGURACION_ID }, data: { tipo_cambio_usd: lectura.valor, tipo_cambio_manual: false, tipo_cambio_at: tipoCambioDeps.ahora(), tipo_cambio_fuente: lectura.fuente } });
  return estadoTipoCambio();
}

export type ResultadoPasada = 'actualizado' | 'vigente' | 'manual' | 'fallo';

/**
 * Una pasada de la tarea: si está en manual no toca nada; si ya hay un valor de menos de 24 h tampoco; si falta o es más viejo lo lee (SUNAT; si falla, el respaldo).
 * Si fallan las dos fuentes, deja el último valor y lo anota en el log (devuelve `fallo`). No lanza nunca.
 */
export async function pasadaDeTipoCambio(): Promise<ResultadoPasada> {
  try {
    const c = await obtenerConfiguracion();
    if (c.tipo_cambio_manual) return 'manual';
    const ahora = tipoCambioDeps.ahora();
    if (c.tipo_cambio_usd && c.tipo_cambio_at && ahora.getTime() - c.tipo_cambio_at.getTime() < MAX_EDAD_MS) return 'vigente';
    const lectura = await leerTipoCambioDeFuente();
    // Un UPDATE condicionado: si el superadmin lo fijó a mano mientras se leía la fuente, esa elección gana.
    const r = await prisma.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, tipo_cambio_manual: false }, data: { tipo_cambio_usd: lectura.valor, tipo_cambio_at: ahora, tipo_cambio_fuente: lectura.fuente } });
    return r.count ? 'actualizado' : 'manual';
  } catch (err) {
    console.error('[tipo-cambio] no se pudo actualizar (queda el último valor):', err instanceof Error ? err.message : 'error');
    return 'fallo';
  }
}

/** `TIPO_CAMBIO_AUTO=on|off`; sin definir, activo sólo en producción (las pruebas lo apagan). */
export function tipoCambioAutoActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.TIPO_CAMBIO_AUTO?.trim().toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return isProduction(env);
}

/** Arranca la tarea en proceso (primera pasada a los 20 s, luego cada hora). Devuelve `detener`. Sin bloqueo entre réplicas: leer dos veces es inocuo. */
export function iniciarTipoCambio(env: NodeJS.ProcessEnv = process.env): () => void {
  if (!tipoCambioAutoActivo(env)) return () => undefined;
  let enMarcha = false;
  const correr = async () => {
    if (enMarcha) return;
    enMarcha = true;
    try { await pasadaDeTipoCambio(); } finally { enMarcha = false; }
  };
  const primero = setTimeout(() => void correr(), PRIMERA_PASADA_TIPO_CAMBIO_MS);
  const t = setInterval(() => void correr(), CADA_TIPO_CAMBIO_MS);
  primero.unref();
  t.unref();
  console.log('[tipo-cambio] lectura automática activa (al arrancar si falta o tiene más de 24 h, y luego cada vez que pasen 24 h)');
  return () => { clearTimeout(primero); clearInterval(t); };
}
