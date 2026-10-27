import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { prisma } from '../db';
import type { AuthUser } from '../middleware/auth';
import { requireRole } from '../middleware/auth';
import { EvolutionFallo } from '../services/canales/evolution';
import { quitarWebhook, registrarWebhook } from '../services/canales/webhook';

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
    const detalle = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new EvolutionError('error', response.status, typeof detalle.message === 'string' ? detalle.message : '');
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
      await evolutionRequest('/instance/create', 'POST', { instanceName, token, qrcode: true });
    } catch (e) {
      // Si la instancia ya existe en Evolution, se sigue con ella (el token guardado es el que vale).
      if (!(e instanceof EvolutionError && e.detalle.toLowerCase().includes('already exists'))) {
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
    const status = typeof estado.status === 'string' ? estado.status : 'unknown';
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

export { router as whatsappRouter };
