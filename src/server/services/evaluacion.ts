/**
 * Evaluación automática del comprobante con IA (visión). La IA LEE la captura; el contraste y las decisiones los hace
 * `contraste.ts` con código. Corre en segundo plano tras subir el comprobante, con la cadena de claves del llavero
 * filtrada a los proveedores con visión. Nunca bloquea ni rechaza: sin IA disponible el pago sigue por validación manual.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { parsearRetryAfter, registrarEstado, limpiar } from '../lib/cooldown';
import { hoyLima } from '../lib/fechas';
import { PROMPT_SISTEMA, PROMPT_USUARIO, parsearLectura } from '../lib/lecturaComprobante';
import { registrarAuditoria } from '../middleware/audit';
import { cabecerasDe, llaveroDeps } from './llavero';
import { contrastar, type MedioParaContraste, MIN_OPERACION } from './contraste';
import { construirCadena, contarUso, marcarUso, rechazarClave, type Eslabon } from './rotacion';
import { aplicarFechaDelVoucher, decidirFecha } from './fechaVoucher';
import { avisarResultado, cerrarPago } from './validacionPago';

/** Eslabones que se prueban como máximo por evaluación. */
export const MAX_INTENTOS_IA = 3;
/** Confianza mínima (calculada por código) para validar sola. */
export const UMBRAL_AUTOVALIDACION = 0.9;
export const MARCA_REINTENTO = 'Reintento programado';
/** Una evaluación «pendiente» más vieja que esto se da por abandonada (el proceso murió) y se puede retomar. */
const ABANDONO_MS = 3 * 60_000;
const TOPE_LLAMADA_MS = 45_000;

export const MOTIVO_SIN_CLAVE = 'Configura una clave de Gemini u OpenAI en el Llavero para evaluar comprobantes con IA.';
export const MOTIVO_PDF = 'Los PDF sólo se pueden leer con Gemini: configura una clave de Gemini en el Llavero o pide una captura en imagen.';

/** Puntos de inyección para pruebas: reloj y programador del reintento (nunca se duerme de verdad). */
export const evaluacionDeps = {
  ahora: (): Date => new Date(),
  reintentoMs: 60_000,
  programar: (fn: () => void, ms: number): void => {
    const t = setTimeout(fn, ms);
    t.unref?.();
  },
};

// ---------- Segundo plano ----------
const enCurso = new Set<Promise<unknown>>();

function enSegundoPlano(fn: () => Promise<void>): void {
  const p: Promise<unknown> = fn()
    .catch((err) => console.error('[evaluacion] falló una evaluación', err instanceof Error ? err.name : 'error'))
    .finally(() => { enCurso.delete(p); });
  enCurso.add(p);
}

/** Gancho de pruebas: espera a que terminen las evaluaciones en curso (incluidas las que se encadenen). */
export async function esperarEvaluaciones(): Promise<void> {
  while (enCurso.size) await Promise.allSettled([...enCurso]);
}

// ---------- Toma atómica ----------
const REINICIO = {
  estado: 'pendiente', proveedor: null, modelo: null, veredicto: null, confianza: null, resumen: null, error: null, intentos: 0, evaluada_at: null,
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

/** Arranca la evaluación en segundo plano. `false` si otra ya estaba en curso (sólo en modo manual). */
export async function iniciarEvaluacion(pagoId: number, modo: 'subida' | 'manual'): Promise<boolean> {
  if (!(await tomarEvaluacion(pagoId, modo))) return false;
  enSegundoPlano(() => ejecutar(pagoId, 1));
  return true;
}

// ---------- Llamada al proveedor ----------
interface Archivo { mime: string; base64: string }
interface Respuesta { ok: boolean; status: number; texto: string; retryAfterMs: number | null; claveInvalida: boolean }

/** Modelo con visión: el de la clave si la persona eligió uno propio; si no, el de visión del proveedor. */
export const modeloDeVision = (e: Eslabon) => (e.modelo && e.modelo !== e.proveedor.modeloPorDefecto ? e.modelo : e.proveedor.modeloVision);

async function consultarVision(e: Eslabon, modelo: string, a: Archivo): Promise<Respuesta> {
  const gemini = e.proveedor.tipo === 'gemini';
  const url = gemini ? `${e.proveedor.baseUrl}/models/${encodeURIComponent(modelo)}:generateContent` : `${e.proveedor.baseUrl}/chat/completions`;
  const cuerpo = gemini
    ? {
        systemInstruction: { parts: [{ text: PROMPT_SISTEMA }] },
        contents: [{ role: 'user', parts: [{ text: PROMPT_USUARIO }, { inlineData: { mimeType: a.mime, data: a.base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }
    : {
        model: modelo,
        temperature: 0,
        ...(e.proveedor.id === 'openai' || e.proveedor.id === 'mistral' ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: PROMPT_SISTEMA },
          { role: 'user', content: [{ type: 'text', text: PROMPT_USUARIO }, { type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.base64}` } }] },
        ],
      };
  const r = await llaveroDeps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecerasDe(e.proveedor, e.clave) },
    body: JSON.stringify(cuerpo),
    redirect: 'manual',
    signal: AbortSignal.timeout(TOPE_LLAMADA_MS),
  });
  const crudo = await r.text().catch(() => '');
  let data: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; choices?: { message?: { content?: unknown } }[] } = {};
  try { data = JSON.parse(crudo); } catch { /* cuerpo no JSON */ }
  let texto = '';
  if (gemini) texto = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  else if (typeof data.choices?.[0]?.message?.content === 'string') texto = data.choices[0].message.content;
  // Lo que diga el proveedor sólo se mira para la espera y para saber si la clave sirve; nunca se loguea ni se guarda.
  const retryAfterMs = r.status === 429 ? parsearRetryAfter(r.headers.get('retry-after'), crudo) : null;
  const claveInvalida = r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(crudo);
  return { ok: r.ok, status: r.status, texto, retryAfterMs, claveInvalida };
}

type Salida =
  | { tipo: 'texto'; texto: string; eslabon: Eslabon; modelo: string }
  | { tipo: 'sin_clave'; motivo: string }
  | { tipo: 'fallo'; transitorio: boolean; mensaje: string };

/** Recorre la cadena (≤ 3 eslabones con visión): rota ante 429, 5xx, red, claves rechazadas y peticiones que ese proveedor no acepta. */
async function leerConRotacion(a: Archivo): Promise<Salida> {
  const todas = await construirCadena();
  const conVision = todas.filter((e) => e.proveedor.vision);
  if (conVision.length === 0) return { tipo: 'sin_clave', motivo: MOTIVO_SIN_CLAVE };
  const esPdf = a.mime === 'application/pdf';
  const cadena = conVision.filter((e) => !esPdf || e.proveedor.visionPdf);
  if (cadena.length === 0) return { tipo: 'sin_clave', motivo: MOTIVO_PDF };
  let transitorio = false;
  for (const e of cadena.slice(0, MAX_INTENTOS_IA)) {
    const modelo = modeloDeVision(e);
    const id = `${e.proveedor.id}#${e.claveId ?? 'env'}`;
    try {
      const r = await consultarVision(e, modelo, a);
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
      }
      // 400 u otro: la petición no le sirve a ese proveedor (p. ej. formato de imagen); se prueba el siguiente sin enfriar la clave.
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
      reciboConcepto: { select: { recibo: { select: { fecha_emision: true, empresa_id: true } } } },
    },
  },
} satisfies Prisma.PagoInclude;

/** Guarda el resultado sólo si la evaluación sigue «pendiente» Y el comprobante es el mismo que se leyó (si lo reemplazaron, se descarta). */
async function guardar(pagoId: number, sha256: string, data: Prisma.EvaluacionComprobanteUncheckedUpdateManyInput): Promise<boolean> {
  const r = await prisma.evaluacionComprobante.updateMany({ where: { pago_id: pagoId, estado: 'pendiente', pago: { comprobante: { sha256 } } }, data });
  return r.count === 1;
}

const medioParaContraste = (m: { tipo: string; titular: string; celular: string | null; numero_cuenta: string | null; cci: string | null; servicio: string | null }): MedioParaContraste => m;

async function ejecutar(pagoId: number, intento: number): Promise<void> {
  const pago = await prisma.pago.findUnique({ where: { id: pagoId }, include: pagoParaEvaluar });
  const archivo = pago?.comprobante;
  if (!pago || !archivo) return; // el pago o su comprobante ya no existen
  const sha = archivo.sha256;
  const final = (data: Prisma.EvaluacionComprobanteUncheckedUpdateManyInput) => guardar(pagoId, sha, { intentos: intento, ...data });

  const salida = await leerConRotacion({ mime: archivo.tipo_mime, base64: Buffer.from(archivo.datos).toString('base64') });
  if (salida.tipo === 'sin_clave') {
    if (await final({ estado: 'no_disponible', error: salida.motivo, evaluada_at: evaluacionDeps.ahora() })) {
      await auditar(pagoId, { estado: 'no_disponible', intento });
      await aplicarFechaDelVoucher(pagoId, { tipo: 'no_leida', motivo: 'No hay IA disponible para leer el comprobante' });
    }
    return;
  }
  if (salida.tipo === 'fallo') {
    if (salida.transitorio && intento < 2) {
      // Sigue «evaluando» para el residente; a los 60 s se reintenta una vez.
      if (await final({ error: MARCA_REINTENTO })) evaluacionDeps.programar(() => enSegundoPlano(() => reintentar(pagoId)), evaluacionDeps.reintentoMs);
      return;
    }
    if (await final({ estado: 'error', error: salida.mensaje, evaluada_at: evaluacionDeps.ahora() })) {
      await auditar(pagoId, { estado: 'error', intento });
      await aplicarFechaDelVoucher(pagoId, { tipo: 'no_leida', motivo: 'La IA no pudo leer el comprobante' });
    }
    return;
  }

  const lectura = parsearLectura(salida.texto);
  if (!lectura) {
    // El texto del modelo no se guarda ni se obedece: si no valida contra el esquema estricto, es un error.
    if (await final({ estado: 'error', proveedor: salida.eslabon.proveedor.id, modelo: salida.modelo, error: 'La respuesta de la IA no se pudo validar', evaluada_at: evaluacionDeps.ahora() })) {
      await auditar(pagoId, { estado: 'error', intento, proveedor: salida.eslabon.proveedor.id });
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
  const c = contrastar(
    lectura,
    { monto: (totalGrupo ?? pago.monto).toString(), emision: recibo ? hoyLima(recibo.fecha_emision) : hoyLima(pago.created_at), hoy: hoyLima(evaluacionDeps.ahora()) },
    medios.map(medioParaContraste),
    { archivoEnPago: mismoArchivo?.pago_id ?? null, operacionEnPago: mismaOperacion?.pago_id ?? null },
  );
  const guardada = await final({
    estado: 'completada',
    proveedor: salida.eslabon.proveedor.id,
    modelo: salida.modelo,
    veredicto: c.veredicto,
    confianza: c.confianza,
    extraido: lectura as unknown as Prisma.InputJsonValue,
    coincidencias: c.coincidencias as unknown as Prisma.InputJsonValue,
    alertas: c.alertas,
    resumen: c.resumen,
    error: null,
    evaluada_at: evaluacionDeps.ahora(),
  });
  if (!guardada) return; // reemplazaron el comprobante mientras tanto: la nueva evaluación manda
  await auditar(pagoId, { estado: 'completada', intento, proveedor: salida.eslabon.proveedor.id, modelo: salida.modelo, veredicto: c.veredicto, confianza: c.confianza });

  // La fecha del pago es la del voucher: se aplica ANTES de una posible validación automática (que guarda esa fecha en los cargos).
  const decision = decidirFecha(lectura, { hoy: evaluacionDeps.ahora(), emision: recibo?.fecha_emision ?? hoyLima(pago.created_at) });
  const fecha = await aplicarFechaDelVoucher(pagoId, decision);
  const duplicado = mismoArchivo != null || mismaOperacion != null;
  // Una fecha leída pero no creíble (futura o muy antigua) deja el pago para que una persona lo revise: la IA no lo valida sola.
  if (c.veredicto === 'coincide' && c.confianza >= UMBRAL_AUTOVALIDACION && !duplicado && decision.tipo !== 'invalida' && unidad?.complejo?.validacion_automatica_ia === true) {
    await validarSola(pagoId, pago.recibo_concepto_unidad_id, fecha?.fecha_pago ?? pago.fecha_pago, sha, c.veredicto, c.confianza);
  }
}

async function reintentar(pagoId: number): Promise<void> {
  // Sólo si nadie la reemplazó o la retomó mientras esperaba.
  const r = await prisma.evaluacionComprobante.updateMany({ where: { pago_id: pagoId, estado: 'pendiente', error: MARCA_REINTENTO }, data: { error: null } });
  if (r.count === 1) await ejecutar(pagoId, 2);
}

/** Valida con la misma actualización atómica de la validación manual. Nunca rechaza; si una persona ya lo revisó, no lo pisa. */
async function validarSola(pagoId: number, cargoId: number | null, fechaPago: Date, sha256: string, veredicto: string, confianza: number): Promise<void> {
  try {
    await cerrarPago({ pagoId, cargoId, fechaPago, estado: 'validado', validadorId: null, porIA: true, comprobanteSha256: sha256 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return; // ya lo revisó una persona (o cambió el comprobante)
    throw err;
  }
  await registrarAuditoria({ usuario_id: null, accion: 'validar', entidad: 'pago', entidad_id: pagoId, detalle: { por: 'ia', veredicto, confianza } });
  await avisarResultado(pagoId, 'validado');
}

/** Auditoría de la evaluación: sólo metadatos; nunca el contenido de la imagen ni el texto del modelo. */
async function auditar(pagoId: number, detalle: Record<string, string | number>): Promise<void> {
  await registrarAuditoria({ usuario_id: null, accion: 'evaluar_comprobante', entidad: 'pago', entidad_id: pagoId, detalle });
}
