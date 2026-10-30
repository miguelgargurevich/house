/**
 * Evaluación automática del comprobante con IA (visión). La IA LEE la captura; el contraste y las decisiones los hace
 * `contraste.ts` con código. Corre en segundo plano tras subir el comprobante, con la cadena de claves del llavero
 * filtrada a los proveedores con visión. Nunca bloquea ni rechaza: sin IA disponible el pago sigue por validación manual.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { cooldownDeps, estaEnfriando, parsearRetryAfter, registrarEstado, limpiar } from '../lib/cooldown';
import { MONEDA_POR_DEFECTO, ZONA_POR_DEFECTO } from '../../lib/paises';
import { hoyEn } from '../lib/fechas';
import { PROMPT_USUARIO, parsearLectura, promptSistema, type Lectura } from '../lib/lecturaComprobante';
import { registrarAuditoria } from '../middleware/audit';
import { cabecerasDe, fetchProveedor } from './llavero';
import { contrastar, type MedioParaContraste, MIN_OPERACION } from './contraste';
import { ajustarPorOcr, lecturaOcrEnMoneda, leerConOcr, type LecturaOcr } from './ocrVoucher';
import { construirCadena, contarUso, marcarUso, rechazarClave, type Eslabon } from './rotacion';
import { aplicarFechaDelVoucher, decidirFechaEvaluada, type DecisionFecha } from './fechaVoucher';
import { validarSiCumple } from './validacionAutomatica';
import { exigirModulo, moduloActivo } from './comercial/modulos';

/** Eslabones que se prueban como máximo por evaluación (con dos claves de Gemini caídas todavía llega al gateway de respaldo). */
export const MAX_INTENTOS_IA = 4;
/** Confianza mínima (calculada por código) para validar sola. */
export { UMBRAL_AUTOVALIDACION } from './validacionAutomatica';
export const MARCA_REINTENTO = 'Reintento programado';
/** Una evaluación «pendiente» más vieja que esto se da por abandonada (el proceso murió) y una persona puede retomarla a mano. */
const ABANDONO_MS = 3 * 60_000;
/** Para el barrido: una «pendiente» sin reintento programado y sin tocar por tanto tiempo no tiene dueño (el proceso murió o se reinició). */
export const ABANDONO_BARRIDO_MS = 5 * 60_000;
/** Cuántas evaluaciones toma como máximo cada barrido (el resto, en el siguiente). */
const MAX_POR_BARRIDO = 10;
/** Una llamada con menos de esto por delante no vale la pena: se corta el intento. */
const MIN_LLAMADA_MS = 1_000;
export const MOTIVO_ABANDONADA = 'La evaluación no terminó (el servidor se reinició o se cayó)';

export const MOTIVO_SIN_MODULO = 'Disponible con el módulo «IA que lee y valida vouchers»: este comprobante queda para validación manual.';
export const MOTIVO_SIN_CLAVE = 'Configura una clave de Gemini u OpenAI en el Llavero para evaluar comprobantes con IA.';
export const MOTIVO_PDF = 'Los PDF sólo se pueden leer con Gemini: configura una clave de Gemini en el Llavero o pide una captura en imagen.';

/** Puntos de inyección para pruebas: reloj, topes de tiempo y programador del reintento (nunca se duerme de verdad). */
export const evaluacionDeps = {
  ahora: (): Date => new Date(),
  reintentoMs: 60_000,
  /** Tope de UNA llamada de visión: un proveedor que no responde en este tiempo se salta (antes 45 s: dos así eran > 1,5 min de «Evaluando…»). */
  topeLlamadaMs: 20_000,
  /** Tope de TODO el intento (la rotación completa): pasado este tiempo no se prueba otra clave. */
  topeIntentoMs: 60_000,
  programar: (fn: () => void, ms: number): void => {
    const t = setTimeout(fn, ms);
    t.unref?.();
  },
};

// ---------- Segundo plano ----------
const enCurso = new Set<Promise<unknown>>();

/** Corre una tarea registrándola (para `esperarEvaluaciones`) y sin dejar que un error suyo tumbe el proceso. */
function rastrear<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const p: Promise<T | undefined> = fn()
    .catch((err) => { console.error('[evaluacion] falló una evaluación', err instanceof Error ? err.name : 'error'); return undefined; })
    .finally(() => { enCurso.delete(p); });
  enCurso.add(p);
  return p;
}

function enSegundoPlano(fn: () => Promise<void>): void {
  void rastrear(fn);
}

/** Gancho de pruebas: espera a que terminen las evaluaciones en curso (incluidas las que se encadenen). */
export async function esperarEvaluaciones(): Promise<void> {
  while (enCurso.size) await Promise.allSettled([...enCurso]);
}

// ---------- Toma atómica ----------
const REINICIO = {
  estado: 'pendiente', proveedor: null, modelo: null, veredicto: null, confianza: null, resumen: null, error: null, intentos: 0, evaluada_at: null, reintentar_at: null,
  extraido: Prisma.DbNull, coincidencias: Prisma.DbNull, alertas: Prisma.DbNull,
} satisfies Prisma.EvaluacionComprobanteUncheckedUpdateManyInput;

const esDuplicadoUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Toma el turno de evaluar un pago.
 *  - `subida`: un comprobante nuevo siempre manda; invalida lo anterior y empieza de cero.
 *  - `manual`: sólo si no hay otra evaluación en curso (o está abandonada); si no, pierde (devuelve false).
 */
export async function tomarEvaluacion(pagoId: number, modo: 'subida' | 'manual'): Promise<boolean> {
  if (modo === 'subida') {
    try {
      await prisma.evaluacionComprobante.upsert({ where: { pago_id: pagoId }, create: { pago_id: pagoId }, update: REINICIO });
    } catch (e) {
      if (!esDuplicadoUnico(e)) throw e;
      await prisma.evaluacionComprobante.update({ where: { pago_id: pagoId }, data: REINICIO }); // otra subida creó la fila primero
    }
    return true;
  }
  const abandonada = new Date(evaluacionDeps.ahora().getTime() - ABANDONO_MS);
  const r = await prisma.evaluacionComprobante.updateMany({
    where: { pago_id: pagoId, OR: [{ estado: { not: 'pendiente' } }, { updated_at: { lt: abandonada } }] },
    data: REINICIO,
  });
  if (r.count === 1) return true;
  if (await prisma.evaluacionComprobante.findUnique({ where: { pago_id: pagoId }, select: { id: true } })) return false; // otra la tiene
  try {
    await prisma.evaluacionComprobante.create({ data: { pago_id: pagoId } });
    return true;
  } catch (e) {
    if (esDuplicadoUnico(e)) return false;
    throw e;
  }
}

/** Condominio del pago (por su departamento o, si no, por su recibo): de él depende el módulo de IA. */
async function complejoDelPago(pagoId: number): Promise<number | null> {
  const p = await prisma.pago.findUnique({
    where: { id: pagoId },
    select: { reciboConceptoUnidad: { select: { unidad: { select: { complejo_id: true } }, reciboConcepto: { select: { recibo: { select: { complejo_id: true } } } } } } },
  });
  const c = p?.reciboConceptoUnidad;
  return c?.unidad?.complejo_id ?? c?.reciboConcepto?.recibo?.complejo_id ?? null;
}

/** Sin el módulo de IA no se llama a ninguna IA: la evaluación queda «no disponible» (con el motivo) y el pago sigue por validación manual. */
async function marcarSinModulo(pagoId: number): Promise<void> {
  const ahora = evaluacionDeps.ahora();
  await prisma.evaluacionComprobante.upsert({
    where: { pago_id: pagoId },
    create: { pago_id: pagoId, estado: 'no_disponible', error: MOTIVO_SIN_MODULO, evaluada_at: ahora },
    update: { ...REINICIO, estado: 'no_disponible', error: MOTIVO_SIN_MODULO, evaluada_at: ahora },
  });
}

/**
 * Arranca la evaluación en segundo plano. `false` si otra ya estaba en curso (sólo en modo manual) o si el condominio no tiene el módulo de IA
 * (al subir un comprobante se deja la marca «no disponible»; pedirla a mano responde 403 `MODULO_NO_ACTIVO`).
 */
export async function iniciarEvaluacion(pagoId: number, modo: 'subida' | 'manual'): Promise<boolean> {
  const complejoId = await complejoDelPago(pagoId);
  if (modo === 'manual') await exigirModulo(complejoId, 'ia_vouchers');
  else if (!(await moduloActivo(complejoId, 'ia_vouchers'))) { await marcarSinModulo(pagoId); return false; }
  if (!(await tomarEvaluacion(pagoId, modo))) return false;
  enSegundoPlano(() => ejecutar(pagoId, 1));
  return true;
}

// ---------- Llamada al proveedor ----------
/** `moneda`: la del condominio del pago, para que el prompt diga qué significa un «$» sin más (soles si falta). */
interface Archivo { mime: string; base64: string; moneda?: string }
interface Respuesta { ok: boolean; status: number; texto: string; retryAfterMs: number | null; claveInvalida: boolean }

/** Familias que se sabe que leen imágenes, para cuando el catálogo vivo (`ModeloIA.vision`) no dice nada de ese modelo. */
const CON_VISION = /^gemini-|^gpt-4o|^gpt-4\.1|^gpt-5|^o[134](-|$)|pixtral|mistral-(small|medium|large)|-vl\b|-vl-|vision|llava|gemma-?[34]|llama-?4|qwen-?vl|^claude-/i;
export const sabeVer = (modelo: string) => CON_VISION.test(modelo);

/**
 * Modelo con visión de una clave. Se usa el que la persona fijó en la clave SÓLO si se sabe que ve imágenes (`ModeloIA.vision` de esa clave, o
 * una familia conocida); si no, o si el catálogo dice que no ve (`false`), el de visión del proveedor. Mandar una imagen a un modelo de texto
 * (p. ej. nemotron en OpenRouter) da 404 y quema un intento.
 */
export function modeloDeVision(e: Eslabon, visionDelCatalogo?: boolean | null): string {
  const fijado = e.fijado;
  if (!fijado || fijado === e.proveedor.modeloVision) return e.proveedor.modeloVision;
  if (visionDelCatalogo === false) return e.proveedor.modeloVision;
  return visionDelCatalogo === true || sabeVer(fijado) ? fijado : e.proveedor.modeloVision;
}

/** `ModeloIA.vision` de los modelos que fijaron las claves de la cadena: clave `claveId|modelo`. */
async function visionDelCatalogo(cadena: Eslabon[]): Promise<Map<string, boolean | null>> {
  const fijadas = cadena.filter((e) => e.claveId !== null && e.fijado);
  if (fijadas.length === 0) return new Map();
  const filas = await prisma.modeloIA.findMany({
    where: { OR: fijadas.map((e) => ({ clave_id: e.claveId!, modelo_id: e.fijado! })) },
    select: { clave_id: true, modelo_id: true, vision: true },
  }).catch(() => []);
  return new Map(filas.map((f) => [`${f.clave_id}|${f.modelo_id}`, f.vision]));
}

async function consultarVision(e: Eslabon, modelo: string, a: Archivo, topeMs: number): Promise<Respuesta> {
  const gemini = e.proveedor.tipo === 'gemini';
  const url = gemini ? `${e.proveedor.baseUrl}/models/${encodeURIComponent(modelo)}:generateContent` : `${e.proveedor.baseUrl}/chat/completions`;
  const cuerpo = gemini
    ? {
        systemInstruction: { parts: [{ text: promptSistema(a.moneda) }] },
        contents: [{ role: 'user', parts: [{ text: PROMPT_USUARIO }, { inlineData: { mimeType: a.mime, data: a.base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }
    : {
        model: modelo,
        temperature: 0,
        ...(e.proveedor.id === 'openai' || e.proveedor.id === 'mistral' ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: promptSistema(a.moneda) },
          { role: 'user', content: [{ type: 'text', text: PROMPT_USUARIO }, { type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.base64}` } }] },
        ],
      };
  const r = await fetchProveedor(e.proveedor, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecerasDe(e.proveedor, e.clave) },
    body: JSON.stringify(cuerpo),
    redirect: 'manual',
    signal: AbortSignal.timeout(topeMs),
  });
  const crudo = await r.text().catch(() => '');
  let data: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; choices?: { message?: { content?: unknown } }[] } = {};
  try { data = JSON.parse(crudo); } catch { /* cuerpo no JSON */ }
  let texto = '';
  if (gemini) texto = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  else texto = textoDeChat(data.choices?.[0]?.message?.content);
  // Lo que diga el proveedor sólo se mira para la espera y para saber si la clave sirve; nunca se loguea ni se guarda.
  const retryAfterMs = r.status === 429 ? parsearRetryAfter(r.headers.get('retry-after'), crudo) : null;
  const claveInvalida = r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(crudo);
  return { ok: r.ok, status: r.status, texto, retryAfterMs, claveInvalida };
}

/** `choices[0].message.content`: casi siempre un string (a veces dentro de ```json); algunas pasarelas lo devuelven como lista de partes `{type:'text', text}`. */
function textoDeChat(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('');
}

type Salida =
  | { tipo: 'texto'; texto: string; eslabon: Eslabon; modelo: string }
  | { tipo: 'sin_clave'; motivo: string }
  | { tipo: 'fallo'; transitorio: boolean; mensaje: string };

/**
 * Orden de la LECTURA de comprobantes: el de la cadena, pero un gateway con `prioridad_vision` va por ese número (menor = antes). Se mantienen los
 * grupos de la cadena (normales libres, normales enfriadas, reserva libres, reserva enfriadas) y, a igualdad, el orden de la cadena (sort estable).
 * Sin `prioridad_vision` en ninguna clave, el resultado es el de la cadena. El chat no pasa por aquí.
 */
function ordenarParaVision(cadena: Eslabon[], ahora = cooldownDeps.ahora()): Eslabon[] {
  const grupo = (e: Eslabon) => Number(e.reserva) * 2 + Number(estaEnfriando(e.cooldownKey, ahora));
  const posicion = (e: Eslabon) => e.proveedor.prioridadVision ?? e.proveedor.prioridad;
  return [...cadena].sort((a, b) => grupo(a) - grupo(b) || posicion(a) - posicion(b));
}

/**
 * Recorre la cadena (≤ 4 eslabones con visión): rota ante 429, 5xx, tiempo agotado, red, claves rechazadas y peticiones que ese proveedor no acepta.
 * Falla rápido: cada llamada tiene su tope (`topeLlamadaMs`) y todo el intento el suyo (`topeIntentoMs`); al agotarse no se prueba otra clave.
 */
async function leerConRotacion(a: Archivo): Promise<Salida> {
  const todas = await construirCadena();
  const conVision = ordenarParaVision(todas.filter((e) => e.proveedor.vision));
  if (conVision.length === 0) return { tipo: 'sin_clave', motivo: MOTIVO_SIN_CLAVE };
  const esPdf = a.mime === 'application/pdf';
  const cadena = conVision.filter((e) => !esPdf || e.proveedor.visionPdf);
  if (cadena.length === 0) return { tipo: 'sin_clave', motivo: MOTIVO_PDF };
  let transitorio = false;
  const inicio = evaluacionDeps.ahora().getTime();
  const catalogo = await visionDelCatalogo(cadena);
  // Rutas (proveedor|modelo) que el PEDIDO rechazó (400 o 413): otra clave del mismo proveedor y modelo daría lo mismo, así que se salta sin gastar intento.
  const rechazadas = new Set<string>();
  let intentos = 0;
  for (const e of cadena) {
    if (intentos >= MAX_INTENTOS_IA) break;
    const modelo = modeloDeVision(e, e.claveId !== null && e.fijado ? catalogo.get(`${e.claveId}|${e.fijado}`) : undefined);
    const ruta = `${e.proveedor.id}|${modelo}`;
    if (rechazadas.has(ruta)) continue;
    const restante = evaluacionDeps.topeIntentoMs - (evaluacionDeps.ahora().getTime() - inicio);
    if (restante < MIN_LLAMADA_MS) {
      console.warn('[evaluacion] se agotó el tiempo del intento; no se prueban más claves');
      transitorio = true;
      break;
    }
    intentos += 1;
    const id = `${e.proveedor.id}#${e.claveId ?? 'env'}`;
    try {
      const r = await consultarVision(e, modelo, a, Math.min(evaluacionDeps.topeLlamadaMs, restante));
      if (r.ok && r.texto.trim()) {
        limpiar(e.cooldownKey);
        contarUso(e.claveId, 'ok');
        if (e.claveId !== null) await marcarUso(e.claveId);
        return { tipo: 'texto', texto: r.texto, eslabon: e, modelo };
      }
      console.warn(`[evaluacion] ${id} respondió ${r.status}${r.ok ? ' sin texto' : ''}`);
      if (r.status === 429) {
        registrarEstado(e.cooldownKey, 429, r.retryAfterMs);
        contarUso(e.claveId, 'limite');
        transitorio = true;
        continue;
      }
      contarUso(e.claveId, 'error');
      if (r.status === 401 || r.status === 402 || r.status === 403 || r.claveInvalida) {
        await rechazarClave(e, r.claveInvalida ? 401 : r.status);
        if (e.claveId === null) registrarEstado(e.cooldownKey, 500);
      } else if (r.status >= 500) {
        registrarEstado(e.cooldownKey, r.status);
        transitorio = true;
      } else if (r.status === 400 || r.status === 413) {
        // La petición no le sirve a esa ruta (formato de imagen, tamaño): ninguna otra clave del proveedor y modelo la aceptaría. Sin enfriar la clave.
        rechazadas.add(ruta);
      }
      // Otro estado: se prueba el siguiente sin enfriar la clave.
    } catch (err) {
      registrarEstado(e.cooldownKey, 0);
      contarUso(e.claveId, 'error');
      transitorio = true;
      console.warn(`[evaluacion] ${id} falló la llamada (${err instanceof Error ? err.name : 'error'})`);
    }
  }
  return transitorio
    ? { tipo: 'fallo', transitorio: true, mensaje: 'El proveedor de IA no respondió (límite o conexión)' }
    : { tipo: 'fallo', transitorio: false, mensaje: 'El proveedor de IA no pudo leer el comprobante' };
}

// ---------- Ejecución ----------
const pagoParaEvaluar = {
  comprobante: true,
  reciboConceptoUnidad: {
    select: {
      id: true,
      unidad: { select: { complejo_id: true, estructura_id: true, complejo: { select: { validacion_automatica_ia: true } } } },
      reciboConcepto: { select: { recibo: { select: { fecha_emision: true, empresa_id: true, mes: true, anio: true, complejo_id: true, complejo: { select: { moneda: true, zona_horaria: true } } } } } },
    },
  },
} satisfies Prisma.PagoInclude;

/** Guarda el resultado sólo si la evaluación sigue «pendiente» Y el comprobante es el mismo que se leyó (si lo reemplazaron, se descarta). */
async function guardar(pagoId: number, sha256: string, data: Prisma.EvaluacionComprobanteUncheckedUpdateManyInput): Promise<boolean> {
  const r = await prisma.evaluacionComprobante.updateMany({ where: { pago_id: pagoId, estado: 'pendiente', pago: { comprobante: { sha256 } } }, data });
  return r.count === 1;
}

const medioParaContraste = (m: { tipo: string; titular: string; celular: string | null; numero_cuenta: string | null; cci: string | null; servicio: string | null }): MedioParaContraste => m;

interface Origen { proveedor: string; modelo: string | null; ocr?: LecturaOcr }

async function ejecutar(pagoId: number, intento: number): Promise<void> {
  const pago = await prisma.pago.findUnique({ where: { id: pagoId }, include: pagoParaEvaluar });
  const archivo = pago?.comprobante;
  if (!pago || !archivo) return; // el pago o su comprobante ya no existen
  const sha = archivo.sha256;
  const final = (data: Prisma.EvaluacionComprobanteUncheckedUpdateManyInput) => guardar(pagoId, sha, { intentos: intento, reintentar_at: null, ...data });

  // Un reintento o un barrido puede llegar cuando el plan ya venció: sin el módulo no se llama a la IA ni al OCR.
  const cargo0 = pago.reciboConceptoUnidad;
  if (!(await moduloActivo(cargo0?.unidad?.complejo_id ?? cargo0?.reciboConcepto?.recibo?.complejo_id, 'ia_vouchers'))) {
    if (await final({ estado: 'no_disponible', error: MOTIVO_SIN_MODULO, evaluada_at: evaluacionDeps.ahora() })) await auditar(pagoId, { estado: 'no_disponible', intento });
    return;
  }

  const moneda = cargo0?.reciboConcepto?.recibo?.complejo?.moneda ?? MONEDA_POR_DEFECTO;
  const zona = cargo0?.reciboConcepto?.recibo?.complejo?.zona_horaria ?? ZONA_POR_DEFECTO; // la fecha del voucher se juzga con el día del condominio
  const salida = await leerConRotacion({ mime: archivo.tipo_mime, base64: Buffer.from(archivo.datos).toString('base64'), moneda });
  let lectura: Lectura | null = salida.tipo === 'texto' ? parsearLectura(salida.texto) : null; // el texto del modelo no se guarda ni se obedece: sólo cuenta si valida el esquema estricto
  let origen: Origen | null = lectura && salida.tipo === 'texto' ? { proveedor: salida.eslabon.proveedor.id, modelo: salida.modelo } : null;

  // La IA terminó sin darnos una lectura y no habrá otro intento suyo (sin clave, fallo definitivo, reintento agotado o respuesta inválida):
  // última red, el OCR propio. Un fallo transitorio con un reintento por delante NO pasa por aquí: se espera a la IA.
  const iaTermino = salida.tipo === 'sin_clave' || (salida.tipo === 'fallo' && !(salida.transitorio && intento < 2)) || (salida.tipo === 'texto' && lectura === null);
  if (!lectura && iaTermino) {
    const ocr = await leerConOcr({ mime: archivo.tipo_mime, bytes: archivo.datos });
    if (ocr) { lectura = lecturaOcrEnMoneda(ocr.lectura, moneda); origen = { proveedor: 'ocr', modelo: null, ocr }; }
  }

  if (!lectura || !origen) {
    if (salida.tipo === 'sin_clave') {
      if (await final({ estado: 'no_disponible', error: salida.motivo, evaluada_at: evaluacionDeps.ahora() })) {
        await auditar(pagoId, { estado: 'no_disponible', intento });
        await aplicarFechaDelVoucher(pagoId, { tipo: 'no_leida', motivo: 'No hay IA disponible para leer el comprobante' });
      }
      return;
    }
    if (salida.tipo === 'fallo') {
      if (salida.transitorio && intento < 2) {
        // Sigue «evaluando» para el residente. El reintento queda GUARDADO (`reintentar_at`) para que lo tome el barrido aunque el servidor se reinicie;
        // el temporizador en memoria sólo lo adelanta a la hora exacta.
        const cuando = new Date(evaluacionDeps.ahora().getTime() + evaluacionDeps.reintentoMs);
        if (await final({ error: MARCA_REINTENTO, reintentar_at: cuando })) evaluacionDeps.programar(() => enSegundoPlano(() => reintentar(pagoId).then(() => undefined)), evaluacionDeps.reintentoMs);
        return;
      }
      if (await final({ estado: 'error', error: salida.mensaje, evaluada_at: evaluacionDeps.ahora() })) {
        await auditar(pagoId, { estado: 'error', intento });
        await aplicarFechaDelVoucher(pagoId, { tipo: 'no_leida', motivo: 'La IA no pudo leer el comprobante' });
      }
      return;
    }
    // Texto que no validó (y sin OCR que lo salve).
    const proveedor = salida.tipo === 'texto' ? salida.eslabon.proveedor.id : null;
    if (await final({ estado: 'error', proveedor, modelo: salida.tipo === 'texto' ? salida.modelo : null, error: 'La respuesta de la IA no se pudo validar', evaluada_at: evaluacionDeps.ahora() })) {
      await auditar(pagoId, { estado: 'error', intento, ...(proveedor ? { proveedor } : {}) });
      await aplicarFechaDelVoucher(pagoId, { tipo: 'no_leida', motivo: 'La respuesta de la IA no se pudo validar' });
    }
    return;
  }

  const cargo = pago.reciboConceptoUnidad;
  const unidad = cargo?.unidad;
  const recibo = cargo?.reciboConcepto?.recibo;
  const empresaId = recibo?.empresa_id ?? null;
  const delEmpresa: Prisma.PagoWhereInput = { reciboConceptoUnidad: { reciboConcepto: { recibo: { empresa_id: empresaId } } } };
  const medios = unidad?.complejo_id != null
    ? await prisma.medioPago.findMany({
        where: { activo: true, complejo_id: unidad.complejo_id, OR: [{ estructura_id: null }, ...(unidad.estructura_id != null ? [{ estructura_id: unidad.estructura_id }] : [])] },
        select: { tipo: true, titular: true, celular: true, numero_cuenta: true, cci: true, servicio: true },
      })
    : [];
  const [mismoArchivo, mismaOperacion] = await Promise.all([
    prisma.archivoComprobante.findFirst({ where: { sha256: sha, pago_id: { not: pagoId }, pago: delEmpresa }, select: { pago_id: true }, orderBy: { pago_id: 'asc' } }),
    lectura.numero_operacion && lectura.numero_operacion.length >= MIN_OPERACION
      ? prisma.evaluacionComprobante.findFirst({
          where: { pago_id: { not: pagoId }, estado: 'completada', extraido: { path: ['numero_operacion'], equals: lectura.numero_operacion }, pago: delEmpresa },
          select: { pago_id: true },
          orderBy: { pago_id: 'asc' },
        })
      : null,
  ]);
  // Pago de un mantenimiento: la IA compara contra el TOTAL del grupo (el comprobante es uno solo), no contra un cargo.
  const totalGrupo = pago.grupo != null ? (await prisma.pago.aggregate({ where: { grupo: pago.grupo }, _sum: { monto: true } }))._sum.monto : null;
  let c = contrastar(
    lectura,
    { monto: (totalGrupo ?? pago.monto).toString(), moneda, emision: recibo ? hoyEn(zona, recibo.fecha_emision) : hoyEn(zona, pago.created_at), hoy: hoyEn(zona, evaluacionDeps.ahora()), periodo: recibo ? { mes: recibo.mes, anio: recibo.anio } : null },
    medios.map(medioParaContraste),
    { archivoEnPago: mismoArchivo?.pago_id ?? null, operacionEnPago: mismaOperacion?.pago_id ?? null },
  );
  // El OCR es menos fiable que la IA: sólo informa y alerta (confianza topada, nunca «coincide», sin validar sola ni fijar la fecha).
  if (origen.ocr) c = ajustarPorOcr(c, origen.ocr, recibo ? { mes: recibo.mes, anio: recibo.anio } : null);
  const guardada = await final({
    estado: 'completada',
    proveedor: origen.proveedor,
    modelo: origen.modelo,
    veredicto: c.veredicto,
    confianza: c.confianza,
    extraido: (origen.ocr ? { ...lectura, mensaje: origen.ocr.mensaje } : lectura) as unknown as Prisma.InputJsonValue,
    coincidencias: c.coincidencias as unknown as Prisma.InputJsonValue,
    alertas: c.alertas,
    resumen: c.resumen,
    error: null,
    evaluada_at: evaluacionDeps.ahora(),
  });
  if (!guardada) return; // reemplazaron el comprobante mientras tanto: la nueva evaluación manda
  await auditar(pagoId, { estado: 'completada', intento, proveedor: origen.proveedor, ...(origen.modelo ? { modelo: origen.modelo } : {}), veredicto: c.veredicto, confianza: c.confianza });

  // La fecha del pago es la del voucher: se aplica ANTES de una posible validación automática (que guarda esa fecha en los cargos).
  // La que leyó el OCR no se aplica: con confianza baja, la fecha declarada se queda y una persona decide.
  // Tampoco la de un comprobante que no coincide con el pago o cuyo mensaje nombra otro mes: es el voucher de otro pago.
  const decision: DecisionFecha = origen.ocr
    ? { tipo: 'no_leida', motivo: 'La fecha se leyó con OCR (sin IA) y no se aplica sola' }
    : decidirFechaEvaluada(lectura, { hoy: evaluacionDeps.ahora(), zona, emision: recibo?.fecha_emision ?? hoyEn(zona, pago.created_at), veredicto: c.veredicto, periodo: recibo ? { mes: recibo.mes, anio: recibo.anio } : null });
  await aplicarFechaDelVoucher(pagoId, decision);
  // Validación automática «IA + tesorero»: si el tesorero ya dio su conformidad (o nadie puede darla), se valida ahora; si no, la dispara la conformidad.
  // Un duplicado ya sale como `no_coincide`, y una fecha leída pero no creíble (futura o muy antigua) deja el pago para una persona. El OCR nunca valida.
  await validarSiCumple(pagoId, { fechaInvalida: decision.tipo === 'invalida' });
}

/**
 * Toma (claim atómico) el reintento de una evaluación y lo ejecuta. Sin `venceAntes`: el llamador es el temporizador de este proceso, que ya
 * esperó la hora. Con `venceAntes`: el barrido, que sólo toma las vencidas. Dos réplicas (o dos barridos) a la vez: sólo una gana el UPDATE.
 */
async function reintentar(pagoId: number, venceAntes?: Date): Promise<boolean> {
  const r = await prisma.evaluacionComprobante.updateMany({
    where: { pago_id: pagoId, estado: 'pendiente', reintentar_at: venceAntes ? { lte: venceAntes } : { not: null } },
    data: { reintentar_at: null, error: null },
  });
  if (r.count !== 1) return false; // alguien la reemplazó, la retomó o ya la tomó otro
  await ejecutar(pagoId, 2);
  return true;
}

/** Una «pendiente» sin dueño (el proceso murió a mitad): se retoma si le queda un intento; si no, pasa a error. `false` si otro la tomó antes. */
async function retomarAbandonada(pagoId: number, intentos: number, limite: Date): Promise<boolean> {
  const sinDueno: Prisma.EvaluacionComprobanteWhereInput = { pago_id: pagoId, estado: 'pendiente', reintentar_at: null, updated_at: { lt: limite }, intentos };
  if (intentos >= 2) {
    const r = await prisma.evaluacionComprobante.updateMany({ where: sinDueno, data: { estado: 'error', error: MOTIVO_ABANDONADA, evaluada_at: evaluacionDeps.ahora() } });
    if (r.count !== 1) return false;
    await auditar(pagoId, { estado: 'error', intento: intentos });
    await aplicarFechaDelVoucher(pagoId, { tipo: 'no_leida', motivo: 'La evaluación no terminó' });
    return true;
  }
  // Compare-and-swap sobre `intentos` (y `updated_at` se renueva): sólo una réplica gana.
  const r = await prisma.evaluacionComprobante.updateMany({ where: sinDueno, data: { intentos: intentos + 1, error: null } });
  if (r.count !== 1) return false;
  await ejecutar(pagoId, intentos + 1);
  return true;
}

export interface ResultadoBarrido { reintentadas: number; abandonadas: number }

/**
 * Barrido periódico (cada minuto y al arrancar, ver `asistente/planificador.ts`): toma los reintentos vencidos y las evaluaciones sin dueño.
 * Es lo que hace que el reintento sobreviva a un deploy o reinicio (el temporizador en memoria se pierde, la fila no).
 */
export async function barrerEvaluaciones(): Promise<ResultadoBarrido> {
  const ahora = evaluacionDeps.ahora();
  const vencidas = await prisma.evaluacionComprobante.findMany({
    where: { estado: 'pendiente', reintentar_at: { lte: ahora } }, select: { pago_id: true }, orderBy: { reintentar_at: 'asc' }, take: MAX_POR_BARRIDO,
  });
  const limite = new Date(ahora.getTime() - ABANDONO_BARRIDO_MS);
  const huerfanas = await prisma.evaluacionComprobante.findMany({
    where: { estado: 'pendiente', reintentar_at: null, updated_at: { lt: limite } }, select: { pago_id: true, intentos: true }, orderBy: { updated_at: 'asc' }, take: MAX_POR_BARRIDO,
  });
  const [r, a] = await Promise.all([
    Promise.all(vencidas.map((v) => rastrear(() => reintentar(v.pago_id, ahora)))),
    Promise.all(huerfanas.map((h) => rastrear(() => retomarAbandonada(h.pago_id, h.intentos, limite)))),
  ]);
  return { reintentadas: r.filter(Boolean).length, abandonadas: a.filter(Boolean).length };
}

/** Auditoría de la evaluación: sólo metadatos; nunca el contenido de la imagen ni el texto del modelo. */
async function auditar(pagoId: number, detalle: Record<string, string | number>): Promise<void> {
  await registrarAuditoria({ usuario_id: null, accion: 'evaluar_comprobante', entidad: 'pago', entidad_id: pagoId, detalle });
}
