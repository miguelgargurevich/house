import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db';
import type { AuthUser } from '../middleware/auth';
import { requireRole } from '../middleware/auth';

const router = Router();

/** URL de la Evolution API del VPS; sin ella no se puede vincular ningún número. */
const baseEvolution = (): string | null => {
  const base = process.env.EVOLUTION_URL?.trim();
  return base ? base.replace(/\/+$/, '') : null;
};

/** El mensaje del proveedor, sin filtrar cabeceras ni claves. */
const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : 'error inesperado');

/** Llamada a la Evolution API (v1): cabecera `apikey` y cuerpo JSON. */
async function evolutionRequest(endpoint: string, method = 'GET', body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = baseEvolution();
  if (!base) throw new Error('Evolution API no configurada');
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: {
      apikey: process.env.EVOLUTION_APIKEY?.trim() ?? '',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detalle = (await response.json().catch(() => ({}))) as { message?: unknown };
    const mensaje = typeof detalle.message === 'string' ? detalle.message : `Evolution API respondió ${response.status}`;
    throw new Error(mensaje);
  }
  return (await response.json()) as Record<string, unknown>;
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
      if (!mensajeDe(e).toLowerCase().includes('already exists')) {
        return res.status(500).json({ error: `Error al crear la instancia de WhatsApp: ${mensajeDe(e)}` });
      }
    }
    await prisma.empresaAdministradora.update({
      where: { id: empresa.id },
      data: { whatsapp_instance: instanceName, whatsapp_token: token },
    });
  }

  try {
    const qr = await evolutionRequest(`/instance/connect/${encodeURIComponent(instanceName)}`);
    return res.json({
      instance: instanceName,
      qr: typeof qr.base64 === 'string' ? qr.base64 : null,
      status: typeof qr.status === 'string' ? qr.status : 'connecting',
    });
  } catch (e) {
    return res.status(500).json({ error: `Error al obtener el QR: ${mensajeDe(e)}` });
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
    return res.json({ connected: status === 'open', status, instance: empresa.whatsapp_instance });
  } catch (e) {
    return res.status(500).json({ error: `Error al verificar el estado: ${mensajeDe(e)}` });
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
    return res.json({ message: 'WhatsApp desvinculado correctamente' });
  } catch (e) {
    return res.status(500).json({ error: `Error al desvincular WhatsApp: ${mensajeDe(e)}` });
  }
});

export { router as whatsappRouter };
