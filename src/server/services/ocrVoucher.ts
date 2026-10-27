/**
 * Última red de la evaluación de comprobantes: OCR propio (Tesseract, `ocr-service/`) + un lector de REGLAS para vouchers peruanos
 * (BCP, Interbank, BBVA, Scotiabank, Yape, Plin). Sólo corre cuando TODOS los proveedores de visión fallaron o no hay ninguna clave.
 *
 * Es menos fiable que la IA y lo trata así: la lectura sale con la misma forma que la de la IA (`Lectura`), pero `evaluacion.ts` la marca
 * `proveedor: 'ocr'`, topa su confianza en `TOPE_CONFIANZA_OCR` y NUNCA la usa para validar sola ni para fijar la fecha del pago: sólo informa
 * y alerta (p. ej. el mensaje dice «Setiembre» y el recibo es de octubre). El texto del OCR viene de una imagen de terceros: no es confiable.
 * La URL del servicio sale SÓLO de `OCR_BASE_URL` (env); nadie la aporta desde la API.
 */
import { lecturaSchema, limpiarTexto, type Lectura } from '../lib/lecturaComprobante';
import { alertaDePeriodo, mesDelMensaje, MES_RE, MESES, MIN_OPERACION, norm, type Contraste } from './contraste';

// La detección del mes que nombra el mensaje es una sola (la comparte la IA): vive en `contraste.ts`.
export { mesDelMensaje };

/** La lectura por OCR nunca llega a la confianza con que se valida sola (`UMBRAL_AUTOVALIDACION` = 0,9). */
export const TOPE_CONFIANZA_OCR = 0.6;
const MAX_TEXTO_OCR = 20_000;

// ---------- Llamada al servicio ----------
export const ocrDeps = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
  /** Tope de la llamada: Tesseract tarda unos segundos por captura. */
  topeMs: 25_000,
};

export interface ConfigOcr { baseUrl: string; apiKey: string | null }

/** `OCR_BASE_URL` (http/https) y `OCR_API_KEY`; sin la URL, el OCR no existe y la evaluación sigue como antes. */
export function configOcr(env: NodeJS.ProcessEnv = process.env): ConfigOcr | null {
  const crudo = env.OCR_BASE_URL?.trim();
  if (!crudo) return null;
  try {
    const u = new URL(crudo);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { baseUrl: u.toString().replace(/\/+$/, ''), apiKey: env.OCR_API_KEY?.trim() || null };
  } catch {
    return null;
  }
}

/** Manda el archivo al OCR y devuelve su texto; `null` si no hay OCR configurado o falla (nunca lanza ni loguea el contenido). */
export async function extraerTexto(a: { mime: string; bytes: Uint8Array }): Promise<string | null> {
  const cfg = configOcr();
  if (!cfg) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([a.bytes as BlobPart], { type: a.mime }), 'comprobante');
    const r = await ocrDeps.fetch(`${cfg.baseUrl}/api/extract`, {
      method: 'POST',
      headers: cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {},
      body: form,
      redirect: 'manual',
      signal: AbortSignal.timeout(ocrDeps.topeMs),
    });
    if (!r.ok) {
      console.warn(`[ocr] el servicio respondió ${r.status}`);
      return null;
    }
    const j = (await r.json().catch(() => null)) as { text?: unknown } | null;
    return typeof j?.text === 'string' && j.text.trim() ? j.text.slice(0, MAX_TEXTO_OCR) : null;
  } catch (err) {
    console.warn(`[ocr] falló la llamada (${err instanceof Error ? err.name : 'error'})`);
    return null;
  }
}

// ---------- Lector de reglas ----------
export interface LecturaOcr {
  lectura: Lectura;
  /** El «Mensaje» que escribió quien pagó (texto no confiable, ya limpio y truncado). */
  mensaje: string | null;
  banco: 'bcp' | 'interbank' | 'bbva' | 'scotiabank' | 'yape' | 'plin' | null;
}

/** «1,258.79», «1.258,79», «258,79», «258.79», «150» → número. */
export function numeroDeTexto(s: string): number | null {
  const t = s.replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const ult = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  let v: string;
  if (ult < 0) v = t;
  else {
    const dec = t.slice(ult + 1);
    const hayOtro = /[.,]/.test(t.slice(0, ult));
    // Un solo separador con 3 dígitos detrás es de miles («1,258»); con 1–2 es decimal; si hay dos clases de separador, el último manda.
    v = !hayOtro && dec.length === 3 ? t.replace(/[.,]/g, '') : `${t.slice(0, ult).replace(/[.,]/g, '')}.${dec}`;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const ETIQUETA_MONTO = /monto|importe|total|transferiste|yapeaste|plineaste|enviaste|pagaste|pago de/;

function leerMonto(lineas: string[]): { monto: number; moneda: 'PEN' | 'USD' } | null {
  const candidatos: { v: number; moneda: 'PEN' | 'USD'; etiquetado: boolean }[] = [];
  for (const [i, l] of lineas.entries()) {
    const etiquetado = ETIQUETA_MONTO.test(l) || ETIQUETA_MONTO.test(lineas[i - 1] ?? '');
    // «S/», «S/.», «$/» (el OCR confunde la S con $) y, con decimales, «5/» (otra confusión típica).
    for (const m of l.matchAll(new RegExp(String.raw`(?<![\d/.,a-z-])(?:s|\$)\s*\/\s*\.?\s*${NUM}`, 'g'))) {
      const v = numeroDeTexto(m[1]!);
      if (v != null) candidatos.push({ v, moneda: 'PEN', etiquetado });
    }
    for (const m of l.matchAll(new RegExp(String.raw`(?<![\d/.,a-z-])5\s*\/\s*\.?\s*(\d+[.,]\d{2})\b`, 'g'))) {
      const v = numeroDeTexto(m[1]!);
      if (v != null) candidatos.push({ v, moneda: 'PEN', etiquetado });
    }
    for (const m of l.matchAll(new RegExp(String.raw`(?:us\s*\$|usd|\$)\s*(?!\/)\s*${NUM}`, 'g'))) {
      const v = numeroDeTexto(m[1]!);
      if (v != null) candidatos.push({ v, moneda: 'USD', etiquetado });
    }
  }
  const soles = candidatos.filter((c) => c.moneda === 'PEN');
  const lista = soles.length ? soles : candidatos;
  if (!lista.length) return null;
  const pool = lista.filter((c) => c.etiquetado).length ? lista.filter((c) => c.etiquetado) : lista;
  const mejor = pool.reduce((a, b) => (b.v > a.v ? b : a));
  return mejor.v > 0 ? { monto: mejor.v, moneda: mejor.moneda } : null;
}

const fechaIso = (d: number, m: number, a: number): string | null => {
  const iso = `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return a >= 2000 && a <= 2100 && !Number.isNaN(t.getTime()) && t.toISOString().startsWith(iso) ? iso : null;
};

function leerFecha(texto: string): string | null {
  const patrones: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [new RegExp(String.raw`\b(\d{1,2})\s*(?:de\s+)?(${MES_RE})\b\.?\s*(?:de\s+|del\s+)?(\d{4})\b`, 'g'), (m) => fechaIso(Number(m[1]), MESES[m[2]!]!, Number(m[3]))],
    [/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g, (m) => fechaIso(Number(m[1]), Number(m[2]), Number(m[3]))],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => fechaIso(Number(m[3]), Number(m[2]), Number(m[1]))],
  ];
  let primera: { pos: number; iso: string } | null = null;
  for (const [re, aIso] of patrones) {
    for (const m of texto.matchAll(re)) {
      const iso = aIso(m);
      if (iso && (primera === null || m.index < primera.pos)) primera = { pos: m.index, iso };
    }
  }
  return primera?.iso ?? null;
}

/** Una línea del OCR: `o` tal cual (para mostrar) y `n` sin tildes ni mayúsculas (para buscar). */
interface Linea { o: string; n: string }

/** El resto de la línea original (con su mayúsculas y tildes) desde `desde`; si la normalización cambió el largo, el normalizado. */
function conMayusculas(l: Linea, desde: number): string {
  const t = l.o.length === l.n.length ? l.o : l.n;
  return t.slice(desde).replace(/^[\s:.#=-]+/, '').trim();
}

/** Valor que sigue a una etiqueta: el resto de su línea o, si no hay, la línea siguiente. */
function despuesDeEtiqueta(lineas: Linea[], etiqueta: RegExp, valido: (v: string) => boolean): string | null {
  for (const [i, l] of lineas.entries()) {
    const m = etiqueta.exec(l.n);
    if (!m) continue;
    const resto = l.n.slice(m.index + m[0].length).replace(/^[\s:.#=-]+/, '').trim();
    if (resto && valido(resto)) return conMayusculas(l, m.index + m[0].length);
    for (const sig of lineas.slice(i + 1, i + 3)) if (sig.n && valido(sig.n)) return sig.o;
  }
  return null;
}

const ETIQUETAS_NOMBRE = /(?:enviado a|yapeaste a|plineaste a|transferiste a|destinatario|beneficiario|nombre del beneficiario|titular|recibe|para)\b/;
const ES_ETIQUETA = /^(?:cuenta|monto|importe|numero|nro|fecha|hora|mensaje|comision|operacion|constancia|codigo|banco|origen|destino|desde|costo|total)\b/;

function leerOperacion(lineas: Linea[]): string | null {
  const etiqueta = /(?:numero|nro|n°|nº|no\.?|codigo|cod\.?|id)\s*\.?\s*(?:de\s+)?(?:operacion|transaccion|referencia|constancia|movimiento)\b/;
  const v = despuesDeEtiqueta(lineas, etiqueta, (x) => /\d/.test(x.split(/\s+/)[0] ?? '') && /^[a-z0-9-]{4,}/.test(x));
  const token = v?.split(/\s+/)[0]?.replace(/[^a-z0-9-]/g, '');
  return token && token.length >= MIN_OPERACION ? token : null;
}

/** Últimos dígitos de la cuenta o celular DESTINO (enmascarado: «****7073», «*** *** 321»); se ignora el de origen. */
function leerDestino(lineas: string[]): string | null {
  let ctx: 'origen' | 'destino' | null = null;
  let respaldo: string | null = null;
  for (const l of lineas) {
    if (/origen|cargo|desde\b/.test(l)) ctx = 'origen';
    else if (/destino|abono|enviado a|beneficiario|destinatario|yapeaste|celular|plineaste/.test(l)) ctx = 'destino';
    const m = /(?:[*•·x]\s*){2,}(\d{3,4})\b/.exec(l);
    if (!m) continue;
    const propia = /origen|cargo|desde\b/.test(l) ? 'origen' : /destino|abono|enviado a|beneficiario|destinatario|celular/.test(l) ? 'destino' : ctx;
    if (propia === 'origen') continue;
    if (propia === 'destino') return m[1]!;
    respaldo ??= m[1]!;
  }
  return respaldo;
}

function leerBanco(t: string): LecturaOcr['banco'] {
  if (/\byape/.test(t)) return 'yape';
  if (/\bplin/.test(t)) return 'plin';
  if (/\bbcp\b|banco de credito|telecredito|credito del peru/.test(t)) return 'bcp';
  if (/interbank/.test(t)) return 'interbank';
  if (/bbva|continental/.test(t)) return 'bbva';
  if (/scotia/.test(t)) return 'scotiabank';
  return null;
}

/**
 * Lee un voucher peruano desde el TEXTO del OCR. `null` si no se encuentra ni un monto ni un número de operación (no hay nada útil).
 * Devuelve la misma `Lectura` que la IA (pasa por el mismo esquema estricto: sólo los últimos dígitos del destino, textos limpios).
 */
export function leerVoucherDeTexto(texto: string): LecturaOcr | null {
  const filas: Linea[] = texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).map((o) => ({ o, n: norm(o) }));
  if (filas.length === 0) return null;
  const lineas = filas.map((f) => f.n);
  const plano = lineas.join('\n');
  const dinero = leerMonto(lineas);
  const operacion = leerOperacion(filas);
  if (!dinero && !operacion) return null;

  const banco = leerBanco(plano);
  const fecha = leerFecha(plano);
  const estado = /rechazad|fallid|denegad|no se pudo|no fue posible/.test(plano) ? 'fallida'
    : /pendiente|en proceso|procesando/.test(plano) ? 'pendiente'
    : /exitos|realizad|yapeaste|plineaste|enviaste|transferiste|constancia|pagaste/.test(plano) ? 'exitosa'
    : 'desconocido';
  const nombre = despuesDeEtiqueta(filas, ETIQUETAS_NOMBRE, (v) => /[a-z]{3}/.test(v) && !ES_ETIQUETA.test(v) && !/(?:[*•·]\s*){2,}|\d{4,}/.test(v) && !/s\s*\/|\$/.test(v));
  const mensaje = despuesDeEtiqueta(filas, /(?:mensaje|descripcion|motivo|concepto|detalle)(?:\s*\(opcional\))?/, (v) => !ES_ETIQUETA.test(v));
  const medio = banco === 'yape' ? 'yape' : banco === 'plin' ? 'plin' : /deposito/.test(plano) ? 'deposito' : banco || /transferencia|transferiste|cuenta/.test(plano) ? 'transferencia' : 'otro';

  const r = lecturaSchema.safeParse({
    es_comprobante_de_pago: dinero != null && (banco != null || operacion != null || estado === 'exitosa'),
    legible: dinero != null && (fecha != null || operacion != null),
    medio,
    estado_operacion: estado,
    monto: dinero?.monto ?? null,
    moneda: dinero?.moneda ?? null,
    fecha,
    numero_operacion: operacion,
    destinatario_nombre: nombre ? nombre.toUpperCase() : null,
    destino_numero: leerDestino(lineas),
  });
  if (!r.success) return null;
  return { lectura: r.data, mensaje: mensaje ? limpiarTexto(mensaje) : null, banco };
}

// ---------- Alertas propias del OCR ----------
export const ALERTA_OCR = 'Leído con OCR (sin IA): puede tener errores, confirma los datos tú mismo';

/** Alertas que el código arma al cruzar el voucher con el recibo: el mensaje de otro mes es la típica. */
export function alertasDeOcr(l: LecturaOcr, recibo: { mes: number; anio: number } | null): string[] {
  const alertas = [ALERTA_OCR];
  const periodo = alertaDePeriodo(l.mensaje, recibo, 'voucher');
  if (periodo) alertas.push(periodo);
  return alertas;
}

/** Texto del OCR → lectura. `null` si no hay OCR, falla, o no se pudo leer nada útil. */
export async function leerConOcr(a: { mime: string; bytes: Uint8Array }): Promise<LecturaOcr | null> {
  const texto = await extraerTexto(a);
  return texto ? leerVoucherDeTexto(texto) : null;
}

/**
 * Lo que el código le hace a un contraste armado con una lectura de OCR: confianza topada (jamás alcanza la de validar sola), «coincide» baja a
 * «revisar», y delante de las alertas normales van las del OCR (incluida la del mes del mensaje).
 */
export function ajustarPorOcr(c: Contraste, l: LecturaOcr, recibo: { mes: number; anio: number } | null): Contraste {
  const bajo = c.veredicto === 'coincide';
  return {
    ...c,
    confianza: Math.min(c.confianza, TOPE_CONFIANZA_OCR),
    veredicto: bajo ? 'revisar' : c.veredicto,
    alertas: [...alertasDeOcr(l, recibo), ...c.alertas],
    resumen: bajo ? 'Los datos parecen coincidir, pero se leyeron con OCR (sin IA): confírmalos tú.' : c.resumen,
  };
}
