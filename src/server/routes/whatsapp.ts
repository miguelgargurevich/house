import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { prisma } from '../db';
import { invalid, notFound } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { requireRole } from '../middleware/auth';
import { coberturaDeCondominios } from '../services/canales/cobertura';
import { canalesDeps } from '../services/canales/deps';
import { EvolutionFallo } from '../services/canales/evolution';
import { migrarGruposDeEstructuras, sincronizarGrupos } from '../services/canales/misGrupos';
import { usoWhatsapp } from '../services/canales/uso';
import { exigirOperativo } from '../services/comercial/operativo';
import { quitarWebhook, registrarWebhook } from '../services/canales/webhook';
import { DESTINOS_GRUPO } from '../services/canales/gruposTipos';
import { idSchema, parseBody, parseId, z } from '../validation';

const router = Router();

/** URL de la Evolution API del VPS; sin ella no se puede vincular ningún número. */
const baseEvolution = (): string | null => {
  const base = process.env.EVOLUTION_URL?.trim();
  return base ? base.replace(/\/+$/, '') : null;
};

/** Tope por llamada a la Evolution API (mismo que los avisos): un proveedor colgado no deja la petición abierta. */
const TIEMPO_MAX_MS = 10_000;

/** Fallo de la Evolution API. `detalle` (texto del proveedor) sólo sirve para decidir y para el log; NUNCA se envía al cliente. */
class EvolutionError extends Error {
  causa: 'sin_conexion' | 'timeout' | 'error';
  estado: number | null;
  detalle: string;
  constructor(causa: 'sin_conexion' | 'timeout' | 'error', estado: number | null, detalle: string) {
    super(detalle);
    this.causa = causa;
    this.estado = estado;
    this.detalle = detalle;
  }
}

/** Respuesta al cliente: mensaje corto según la causa; el detalle va al log del servidor (sin el token). */
function falloEvolution(res: Response, accion: string, e: unknown): Response {
  if (!(e instanceof EvolutionError)) {
    console.error(`[whatsapp] ${accion}: error inesperado`, e);
    return res.status(500).json({ error: `${accion}: error inesperado` });
  }
  const ev = e;
  console.error(`[whatsapp] ${accion}: ${ev.causa}${ev.estado ? ` ${ev.estado}` : ''} — ${ev.detalle.slice(0, 300)}`);
  if (ev.causa === 'timeout') return res.status(504).json({ error: `${accion}: la instancia de WhatsApp no respondió a tiempo` });
  if (ev.causa === 'sin_conexion') return res.status(502).json({ error: `${accion}: no hay conexión con la instancia de WhatsApp` });
  return res.status(502).json({ error: `${accion}: la instancia de WhatsApp respondió con error ${ev.estado}` });
}

/** Llamada a la Evolution API (v1): cabecera `apikey` y cuerpo JSON. */
async function evolutionRequest(endpoint: string, method = 'GET', body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = baseEvolution();
  if (!base) throw new Error('Evolution API no configurada');
  let response: globalThis.Response;
  try {
    response = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        apikey: process.env.EVOLUTION_APIKEY?.trim() ?? '',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIEMPO_MAX_MS),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new EvolutionError(timeout ? 'timeout' : 'sin_conexion', null, e instanceof Error ? e.message : 'error de red');
  }
  if (!response.ok) {
    // Evolution v1 responde `{ message: '…' }`; la v2, `{ response: { message: ['…'] } }`.
    const detalle = (await response.json().catch(() => ({}))) as { message?: unknown; response?: { message?: unknown } };
    const texto = (m: unknown): string => (typeof m === 'string' ? m : Array.isArray(m) ? m.filter((x) => typeof x === 'string').join('; ') : '');
    throw new EvolutionError('error', response.status, (texto(detalle.message) || texto(detalle.response?.message)).slice(0, 200));
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch (e) {
    // Cuerpo cortado o no JSON (incluye el timeout durante la lectura).
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new EvolutionError(timeout ? 'timeout' : 'error', response.status, 'respuesta ilegible');
  }
}

/** La empresa administradora del admin; el superadmin puede no tener ninguna. */
async function empresaDelAdmin(user: AuthUser): Promise<{ id: number; whatsapp_instance: string | null; whatsapp_token: string | null } | null> {
  if (!user.empresa_id) return null;
  return prisma.empresaAdministradora.findUnique({
    where: { id: user.empresa_id },
    select: { id: true, whatsapp_instance: true, whatsapp_token: true },
  });
}

/**
 * Deja el webhook del bot registrado en Evolution (idempotente; el secreto sólo se guarda hasheado). Un fallo no rompe la vinculación del
 * número: el envío de avisos sigue funcionando y se reintenta en la siguiente llamada a `/sync` o `/status`.
 */
async function asegurarWebhook(empresaId: number, instancia: string): Promise<'registrado' | 'ya_estaba' | 'error'> {
  try {
    return await registrarWebhook(empresaId, instancia);
  } catch (e) {
    console.error('[whatsapp] no se pudo registrar el webhook del bot:', e instanceof EvolutionFallo ? `${e.causa}${e.estado ? ` ${e.estado}` : ''}` : 'error');
    return 'error';
  }
}

/**
 * POST /api/whatsapp/sync
 * Crea la instancia de la administradora (si no existe) y devuelve el QR para escanear.
 */
router.post('/sync', requireRole('admin', 'superadmin'), async (req, res) => {
  const empresa = await empresaDelAdmin(req.user as AuthUser);
  if (!empresa) return res.status(400).json({ error: 'El usuario no está vinculado a una empresa administradora' });
  if (!baseEvolution()) return res.status(503).json({ error: 'La Evolution API no está configurada en este servidor' });

  let instanceName = empresa.whatsapp_instance;
  if (!instanceName) {
    instanceName = `house_empresa_${empresa.id}`;
    const token = randomBytes(24).toString('hex');
    try {
      // Evolution v2 exige la integración (sin ella responde 400 «Invalid integration»).
      await evolutionRequest('/instance/create', 'POST', { instanceName, token, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
    } catch (e) {
      // Si la instancia ya existe en Evolution, se sigue con ella (el token guardado es el que vale).
      if (!(e instanceof EvolutionError && /already (exists|in use)/i.test(e.detalle))) {
        return falloEvolution(res, 'Error al crear la instancia de WhatsApp', e);
      }
    }
    await prisma.empresaAdministradora.update({
      where: { id: empresa.id },
      data: { whatsapp_instance: instanceName, whatsapp_token: token },
    });
  }

  const webhook = await asegurarWebhook(empresa.id, instanceName);
  try {
    const qr = await evolutionRequest(`/instance/connect/${encodeURIComponent(instanceName)}`);
    return res.json({
      instance: instanceName,
      webhook,
      qr: typeof qr.base64 === 'string' ? qr.base64 : null,
      status: typeof qr.status === 'string' ? qr.status : 'connecting',
    });
  } catch (e) {
    return falloEvolution(res, 'Error al obtener el QR', e);
  }
});

/**
 * GET /api/whatsapp/status
 * Estado de la sesión de la instancia de la administradora (`open` = vinculada).
 */
router.get('/status', requireRole('admin', 'superadmin'), async (req, res) => {
  const empresa = await empresaDelAdmin(req.user as AuthUser);
  if (!empresa) return res.status(400).json({ error: 'El usuario no está vinculado a una empresa administradora' });
  if (!empresa.whatsapp_instance) return res.json({ connected: false, status: 'not_linked', instance: null });
  if (!baseEvolution()) return res.status(503).json({ error: 'La Evolution API no está configurada en este servidor' });

  try {
    const estado = await evolutionRequest(`/instance/connectionState/${encodeURIComponent(empresa.whatsapp_instance)}`);
    // Evolution v2 responde `{ instance: { state: 'open' } }`; versiones anteriores, `{ state }` o `{ status }`.
    const anidado = estado.instance && typeof estado.instance === 'object' ? (estado.instance as Record<string, unknown>).state : undefined;
    const crudo = [anidado, estado.state, estado.status].find((v) => typeof v === 'string');
    const status = typeof crudo === 'string' ? crudo : 'unknown';
    // Con el número ya vinculado (`open`) el bot queda escuchando sin ningún paso manual más.
    const webhook = status === 'open' ? await asegurarWebhook(empresa.id, empresa.whatsapp_instance) : null;
    return res.json({ connected: status === 'open', status, instance: empresa.whatsapp_instance, ...(webhook ? { webhook } : {}) });
  } catch (e) {
    return falloEvolution(res, 'Error al verificar el estado', e);
  }
});

/**
 * DELETE /api/whatsapp/disconnect
 * Cierra la sesión de la instancia y la desvincula de la administradora.
 */
router.delete('/disconnect', requireRole('admin', 'superadmin'), async (req, res) => {
  const empresa = await empresaDelAdmin(req.user as AuthUser);
  if (!empresa) return res.status(400).json({ error: 'El usuario no está vinculado a una empresa administradora' });
  if (!empresa.whatsapp_instance) return res.status(404).json({ error: 'No hay ninguna instancia de WhatsApp vinculada' });
  if (!baseEvolution()) return res.status(503).json({ error: 'La Evolution API no está configurada en este servidor' });

  try {
    await evolutionRequest(`/instance/logout/${encodeURIComponent(empresa.whatsapp_instance)}`);
    await prisma.empresaAdministradora.update({
      where: { id: empresa.id },
      data: { whatsapp_instance: null, whatsapp_token: null },
    });
    await quitarWebhook(empresa.id); // el bot deja de atender: Evolution recibiría 401
    return res.json({ message: 'WhatsApp desvinculado correctamente' });
  } catch (e) {
    return falloEvolution(res, 'Error al desvincular WhatsApp', e);
  }
});

/**
 * @openapi
 * /api/whatsapp/uso:
 *   get:
 *     summary: Contador de mensajes de WhatsApp del número de la empresa
 *     tags: [WhatsApp]
 *     responses:
 *       200: { description: "`{ conectado, fecha, hoy: { enviados, tope, restantes }, mes: { periodo, renueva, condominios: [{ complejo_id, nombre, usados, tope }], enviados, a_grupos, evitados, grupos_en_uso }, en_cola: { total, para_manana, por_tipo }, fallidos_hoy: { total, motivos: [{ motivo, cantidad }] }, por_tipo: { hoy, mes } }`. «Hoy» y el mes son de Lima. Los mensajes a grupos cuentan. `mes.evitados` = por cada recibo del mes que salió a un grupo, max(0, vecinos que lo habrían recibido por WhatsApp directo − mensajes a grupos por ese recibo); sólo si el condominio no marcó «recibo del mes también directo» y no cuentan los comunicados. Sin datos personales; no llama a Evolution." }
 */
router.get('/uso', requireRole('admin', 'superadmin'), async (req, res) => {
  const empresa = await empresaDelAdmin(req.user as AuthUser);
  if (!empresa) return res.status(400).json({ error: 'El usuario no está vinculado a una empresa administradora' });
  res.json(await usoWhatsapp(empresa, canalesDeps.ahora()));
});

const columnasGrupo = { id: true, nombre: true, miembros: true, en_uso: true, destino: true, complejo_id: true, estructura_id: true, ya_no_esta: true, aviso: true, sincronizado_at: true } as const;

/** «Mis grupos» de la empresa leídos de la BASE (nunca de Evolution), con los condominios y blocks a los que se pueden asignar. Sin el JID. */
async function leerMisGrupos(empresa: { id: number; whatsapp_instance: string | null }) {
  await migrarGruposDeEstructuras(empresa.id);
  const [grupos, condominios] = await Promise.all([
    prisma.grupoWhatsapp.findMany({ where: { empresa_id: empresa.id }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }], select: columnasGrupo }),
    prisma.complejoHabitacional.findMany({ where: { empresa_id: empresa.id }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }], take: 200, select: { id: true, nombre: true, estructuras: { orderBy: [{ nombre: 'asc' }, { id: 'asc' }], select: { id: true, nombre: true } } } }),
  ]);
  const ultima = grupos.reduce<Date | null>((m, g) => (g.sincronizado_at && (!m || g.sincronizado_at > m) ? g.sincronizado_at : m), null);
  return { conectado: !!empresa.whatsapp_instance, sincronizado_at: ultima, grupos, condominios };
}

/**
 * @openapi
 * /api/whatsapp/grupos:
 *   get:
 *     summary: Mis grupos de WhatsApp (guardados en Torre)
 *     tags: [WhatsApp]
 *     responses:
 *       200: { description: "`{ conectado, sincronizado_at, grupos: [{ id, nombre, miembros, en_uso, destino, complejo_id, estructura_id, ya_no_esta, aviso, sincronizado_at }], condominios: [{ id, nombre, estructuras }] }`. Lee de la base: nunca llama a Evolution. Pasa a la lista los grupos que ya estaban elegidos en la ficha del block." }
 */
router.get('/grupos', requireRole('admin', 'superadmin'), async (req, res) => {
  const empresa = await empresaDelAdmin(req.user as AuthUser);
  if (!empresa) return res.status(400).json({ error: 'El usuario no está vinculado a una empresa administradora' });
  const mis = await leerMisGrupos(empresa);
  res.json({ ...mis, cobertura: await coberturaDeCondominios(mis.condominios) });
});

/**
 * @openapi
 * /api/whatsapp/cobertura/{id}:
 *   get:
 *     summary: Qué blocks de un condominio tienen su grupo de WhatsApp (y cuáles no)
 *     tags: [WhatsApp]
 *     responses:
 *       200: { description: "`{ complejo_id, nombre, bloques: { total, con_grupo, faltan: [{ estructura_id, nombre, motivo: sin_grupo|ya_no_esta }] }, condominio_con_grupo }`. Sólo lee la base." }
 *       404: { description: "El condominio no es de tu empresa" }
 */
router.get('/cobertura/:id', requireRole('admin', 'superadmin'), async (req, res) => {
  const empresa = await empresaDelAdmin(req.user as AuthUser);
  if (!empresa) return res.status(400).json({ error: 'El usuario no está vinculado a una empresa administradora' });
  const complejo = await prisma.complejoHabitacional.findFirst({ where: { id: parseId(req), empresa_id: empresa.id }, select: { id: true, nombre: true } });
  if (!complejo) throw notFound('Condominio');
  const [cobertura] = await coberturaDeCondominios([complejo]);
  res.json(cobertura);
});

/**
 * @openapi
 * /api/whatsapp/grupos/sincronizar:
 *   post:
 *     summary: Trae los grupos del número desde Evolution (una sola llamada, lenta) y los guarda
 *     tags: [WhatsApp]
 *     responses:
 *       200: { description: "Lo mismo que `GET /grupos` más `resumen: { nuevos, actualizados, ya_no_estan, quitados }`. Los que ya no vienen quedan marcados `ya_no_esta` (si estaban en uso no se borran)." }
 *       409: { description: "Ya se están trayendo los grupos de esta empresa" }
 *       422: { description: "No hay un número de WhatsApp conectado" }
 *       502: { description: "Evolution falló; 504 si tardó más de 30 s" }
 */
router.post('/grupos/sincronizar', requireRole('admin', 'superadmin'), async (req, res) => {
  const empresa = await empresaDelAdmin(req.user as AuthUser);
  if (!empresa) return res.status(400).json({ error: 'El usuario no está vinculado a una empresa administradora' });
  if (!empresa.whatsapp_instance) throw invalid('Primero conecta tu número de WhatsApp: sin él Torre no puede traer tus grupos');
  const resumen = await sincronizarGrupos(empresa.id, empresa.whatsapp_instance);
  res.locals.entidad = 'grupo_whatsapp';
  res.locals.accion = 'sincronizar';
  res.locals.auditDetalle = resumen;
  const mis = await leerMisGrupos(empresa);
  res.json({ ...mis, cobertura: await coberturaDeCondominios(mis.condominios), resumen });
});

const usoSchema = z.strictObject({
  en_uso: z.boolean({ error: 'Debe ser verdadero o falso' }),
  destino: z.enum(DESTINOS_GRUPO, { error: 'Elige a quién representa el grupo' }).nullish(),
  estructura_id: idSchema.nullish(),
  complejo_id: idSchema.nullish(),
});

/**
 * @openapi
 * /api/whatsapp/grupos/{id}:
 *   put:
 *     summary: Usa (o deja de usar) un grupo en Torre y dice a quién representa
 *     tags: [WhatsApp]
 *     responses:
 *       200: { description: "El grupo actualizado. `en_uso: true` pide `destino`: `block` y `junta_block` piden `estructura_id`; `condominio` pide `complejo_id`. Apagarlo borra el destino." }
 *       404: { description: "El grupo, el block o el condominio no son de tu empresa" }
 *       409: { description: "El condominio está en solo lectura" }
 *       422: { description: "Falta el destino, o el grupo ya no está en el número" }
 */
router.put('/grupos/:id', requireRole('admin', 'superadmin'), async (req, res) => {
  const user = req.user as AuthUser;
  const empresa = await empresaDelAdmin(user);
  if (!empresa) return res.status(400).json({ error: 'El usuario no está vinculado a una empresa administradora' });
  const id = parseId(req);
  const d = parseBody(usoSchema, req);
  const grupo = await prisma.grupoWhatsapp.findFirst({ where: { id, empresa_id: empresa.id }, select: { id: true, nombre: true, en_uso: true, destino: true, ya_no_esta: true, complejo_id: true, estructura_id: true } });
  if (!grupo) throw notFound('Grupo');
  let data: { en_uso: boolean; destino: string | null; complejo_id: number | null; estructura_id: number | null; aviso?: null; aviso_at?: null };
  if (!d.en_uso) {
    if (grupo.complejo_id != null) await exigirOperativo(grupo.complejo_id, user);
    data = { en_uso: false, destino: null, complejo_id: null, estructura_id: null, aviso: null, aviso_at: null };
  } else {
    if (!d.destino) throw invalid('Elige a quién representa el grupo', { destino: 'Obligatorio' });
    if (grupo.ya_no_esta) throw invalid('Ya no estás en este grupo: vuelve a entrar desde WhatsApp y trae tus grupos de nuevo', { en_uso: 'El número ya no está en el grupo' });
    if (d.destino === 'condominio') {
      if (d.complejo_id == null) throw invalid('Elige el condominio', { complejo_id: 'Obligatorio' });
      const complejo = await prisma.complejoHabitacional.findFirst({ where: { id: d.complejo_id, empresa_id: empresa.id }, select: { id: true } });
      if (!complejo) throw notFound('Condominio');
      data = { en_uso: true, destino: 'condominio', complejo_id: complejo.id, estructura_id: null };
    } else {
      if (d.estructura_id == null) throw invalid('Elige el block', { estructura_id: 'Obligatorio' });
      const bloque = await prisma.estructura.findFirst({ where: { id: d.estructura_id, complejo: { empresa_id: empresa.id }, ...(d.complejo_id != null ? { complejo_id: d.complejo_id } : {}) }, select: { id: true, complejo_id: true } });
      if (!bloque || bloque.complejo_id == null) throw notFound('Block');
      data = { en_uso: true, destino: d.destino, complejo_id: bloque.complejo_id, estructura_id: bloque.id };
    }
    await exigirOperativo(data.complejo_id!, user);
  }
  const nuevo = await prisma.grupoWhatsapp.update({ where: { id }, data, select: columnasGrupo });
  res.locals.entidad = 'grupo_whatsapp';
  res.locals.entidadId = id;
  res.locals.accion = 'uso';
  res.locals.auditDetalle = { grupo: grupo.nombre, en_uso: nuevo.en_uso, destino: nuevo.destino, complejo_id: nuevo.complejo_id, estructura_id: nuevo.estructura_id, antes: { en_uso: grupo.en_uso, destino: grupo.destino, estructura_id: grupo.estructura_id } };
  res.json(nuevo);
});

export { router as whatsappRouter };
