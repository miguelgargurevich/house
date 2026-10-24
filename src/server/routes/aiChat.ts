// Asistente de IA: chat completo (`POST /`, compatible con la forma histórica), chat en streaming SSE (`POST /stream`),
// conversaciones guardadas del usuario y lo que puede elegir (`GET /opciones`). El contenido de las conversaciones sólo lo ve su dueño.
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { ESFUERZOS, ETIQUETA_CATEGORIA, MAX_TOKENS_RESIDENTE, PRESETS, type Categoria } from '../lib/modelosIA';
import { aplicarAjustes, ajustesSchema, puedeElegir, type AjustesAplicados } from '../lib/parametrosChat';
import { proveedorPorId } from '../lib/proveedoresIA';
import { currentUser } from '../middleware/auth';
import { ESTADO_RECHAZADA } from '../services/rotacion';
import { TITULO_RENOMBRADO_MAX, borrarDe, detalleDe, listarDe, renombrarDe, revertirDesde } from '../services/asistente/conversaciones';
import { MAX_INTENTOS } from '../services/asistente/motor';
import { MENSAJES_ERROR, ejecutarTurno, prepararTurno, type Preparado } from '../services/asistente/turno';
import { parse, z } from '../validation';

export { MAX_INTENTOS };

// Las respuestas del chat conservan la forma histórica que lee el panel: { response } o { error: { code, message } }.
const fallo = (res: Response, code: number, message: string) => res.status(code).json({ error: { code, message } });

const mensajeSchema = z.object({
  message: z.string().trim().min(1, 'El mensaje es obligatorio.').max(4000, 'El mensaje es demasiado largo.'),
});
// Campos históricos (`context`, `conversationContext`, `sessionId`, `sentiment`…) se aceptan y se ignoran: el historial lo arma el servidor.

const idConversacion = z.object({ id: z.string().trim().min(1).max(40) });
const idMensajeSchema = z.object({ id: z.string().trim().min(1).max(40), mensajeId: z.coerce.number().int().min(1).max(2_147_483_647) });
// Título: texto plano de 1 a 80 caracteres, sin HTML ni caracteres de control.
const tituloSchema = z.object({
  titulo: z.string().trim().min(1, 'El título es obligatorio.').max(TITULO_RENOMBRADO_MAX, `El título admite hasta ${TITULO_RENOMBRADO_MAX} caracteres.`)
    .refine((t) => !/[<>]/.test(t), 'El título no puede llevar < ni >.')
    .refine((t) => !/\p{Cc}/u.test(t), 'El título tiene caracteres no válidos.'),
});

/** Modelos que el usuario puede fijar: activos y de chat en alguna clave habilitada y no rechazada (sin repetir). */
async function modelosElegibles() {
  const filas = await prisma.modeloIA.findMany({
    where: { estado: { not: 'deprecado' }, categoria: { not: 'otro' }, clave: { habilitada: true, estado: { not: ESTADO_RECHAZADA } } },
    select: { modelo_id: true, nombre: true, categoria: true, gratis: true, clave: { select: { proveedor: true } } },
    orderBy: [{ modelo_id: 'asc' }],
  });
  const vistos = new Set<string>();
  const salida: { id: string; nombre: string; categoria: Categoria; proveedor: string; gratis: boolean }[] = [];
  for (const f of filas) {
    if (vistos.has(f.modelo_id)) continue;
    vistos.add(f.modelo_id);
    salida.push({ id: f.modelo_id, nombre: f.nombre ?? f.modelo_id, categoria: f.categoria as Categoria, proveedor: proveedorPorId(f.clave.proveedor)?.nombre ?? f.clave.proveedor, gratis: f.gratis });
  }
  return salida;
}

/** Valida el cuerpo: el mensaje con el error histórico (400) y los ajustes con zod (422). Un modelo fijo debe existir y estar activo. */
async function leerEntrada(req: Request): Promise<{ mensaje: string; conversacionId?: string; ruta?: string; ajustes: AjustesAplicados }> {
  const m = mensajeSchema.safeParse(req.body);
  if (!m.success) throw new HttpError(400, m.error.issues[0]?.message ?? 'Petición inválida.');
  const a = parse(ajustesSchema, req.body);
  const user = currentUser(req);
  const ajustes = aplicarAjustes(user.rol, a);
  if (ajustes.modeloFijo && !(await modelosElegibles()).some((x) => x.id === ajustes.modeloFijo)) {
    throw new HttpError(422, 'Datos inválidos: modelo: Ese modelo no está disponible', { modelo: 'Ese modelo no está disponible' });
  }
  return { mensaje: m.data.message, conversacionId: a.conversacion_id, ruta: a.ruta, ajustes };
}

/** Errores previos a responder (sin IA, conversación ajena, validación) con la forma que lee el panel. */
const manejarPrevio = (res: Response, err: unknown) => {
  if (err instanceof HttpError) {
    if (err.status === 422) return res.status(422).json(err.campos ? { error: err.message, campos: err.campos } : { error: err.message });
    return fallo(res, err.status, err.message);
  }
  throw err;
};

function abrirSse(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // que el proxy no acumule los fragmentos
  res.flushHeaders();
}
const evento = (res: Response, nombre: string, datos: unknown) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`); };

/** Se monta DESPUÉS de `authenticate`. El límite por usuario sólo cuenta los mensajes, no las lecturas. */
export function aiChatRouter(limitador: RequestHandler) {
  const router = Router();

  router.get('/opciones', async (req, res) => {
    const u = currentUser(req);
    const elige = puedeElegir(u.rol);
    res.json({
      modelos: elige ? await modelosElegibles() : [],
      categorias: elige ? (Object.keys(ETIQUETA_CATEGORIA) as Categoria[]).filter((c) => c !== 'otro').map((id) => ({ id, nombre: ETIQUETA_CATEGORIA[id] })) : [],
      presets: [
        ...(Object.entries(PRESETS) as [keyof typeof PRESETS, (typeof PRESETS)[keyof typeof PRESETS]][]).map(([id, p]) => ({ id, nombre: p.nombre, detalle: p.detalle, parametros: { temperature: p.temperature, maxTokens: elige ? p.maxTokens : Math.min(p.maxTokens, MAX_TOKENS_RESIDENTE), topP: p.topP, topK: p.topK } })),
        { id: 'a_medida', nombre: 'A medida', detalle: 'Ajusta tú mismo la temperatura, el largo máximo y el muestreo.', parametros: null },
      ],
      esfuerzos: elige ? ESFUERZOS : [],
      puede_elegir_modelo: elige,
      puede_elegir_esfuerzo: elige,
      max_tokens: elige ? 4096 : MAX_TOKENS_RESIDENTE,
    });
  });

  router.get('/conversaciones', async (req, res) => {
    res.json(await listarDe(currentUser(req).id));
  });

  router.get('/conversaciones/:id', async (req, res) => {
    const u = currentUser(req);
    const { id } = parse(idConversacion, req.params);
    res.json(await detalleDe(u.id, id, u.rol === 'superadmin'));
  });

  router.delete('/conversaciones/:id', async (req, res) => {
    const { id } = parse(idConversacion, req.params);
    await borrarDe(currentUser(req).id, id);
    res.status(204).end();
  });

  router.patch('/conversaciones/:id', async (req, res) => {
    const { id } = parse(idConversacion, req.params);
    const { titulo } = parse(tituloSchema, req.body);
    res.json(await renombrarDe(currentUser(req).id, id, titulo));
  });

  // «Volver a un mensaje»: borra ese mensaje y todo lo posterior. Idempotente; el panel detiene antes su propio stream.
  router.delete('/conversaciones/:id/mensajes/:mensajeId', async (req, res) => {
    const { id, mensajeId } = parse(idMensajeSchema, req.params);
    await revertirDesde(currentUser(req).id, id, mensajeId);
    res.status(204).end();
  });

  router.post('/', limitador, async (req, res) => {
    const u = currentUser(req);
    let prep: Preparado;
    try {
      const e = await leerEntrada(req);
      prep = await prepararTurno(u, e.mensaje, e.ajustes, { conversacionId: e.conversacionId, ruta: e.ruta });
    } catch (err) {
      return manejarPrevio(res, err);
    }
    for await (const ev of ejecutarTurno(prep, { stream: false })) {
      if (ev.tipo === 'fin') return void res.json({ response: ev.texto, conversacion_id: prep.conversacionId, ...(ev.modo ? { modo: ev.modo } : {}) });
      if (ev.tipo === 'error') return fallo(res, MENSAJES_ERROR[ev.codigo].status, ev.mensaje);
    }
    fallo(res, 503, MENSAJES_ERROR.fallo.mensaje);
  });

  router.post('/stream', limitador, async (req, res) => {
    const u = currentUser(req);
    let prep: Preparado;
    try {
      const e = await leerEntrada(req);
      prep = await prepararTurno(u, e.mensaje, e.ajustes, { conversacionId: e.conversacionId, ruta: e.ruta });
    } catch (err) {
      return manejarPrevio(res, err);
    }
    // Si el cliente cierra la conexión se corta la llamada al proveedor (el generador se cierra y aborta el fetch).
    const control = new AbortController();
    res.on('close', () => { if (!res.writableFinished) control.abort(); });
    abrirSse(res);
    evento(res, 'meta', { conversacion_id: prep.conversacionId, mensaje_id: prep.mensajeId });
    try {
      for await (const ev of ejecutarTurno(prep, { stream: true, signal: control.signal })) {
        if (ev.tipo === 'delta') evento(res, 'delta', { texto: ev.texto });
        else if (ev.tipo === 'herramienta') evento(res, 'herramienta', { nombre: ev.nombre, estado: ev.estado });
        else if (ev.tipo === 'fin') evento(res, 'done', { modelo: ev.modelo, proveedor: ev.proveedor, latencia_ms: ev.latencia_ms, ...(ev.modo ? { modo: ev.modo } : {}) });
        else evento(res, 'error', { codigo: ev.codigo, mensaje: ev.mensaje });
      }
    } catch (err) {
      console.error('[ai-chat] falló el stream', err instanceof Error ? err.name : 'error');
      evento(res, 'error', { codigo: 'fallo', mensaje: MENSAJES_ERROR.fallo.mensaje });
    }
    if (!res.writableEnded) res.end();
  });

  return router;
}
