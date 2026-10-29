import { Router } from 'express';
import { prisma } from '../db';
import { invalid } from '../errors';
import { currentUser } from '../middleware/auth';
import { formatearCelular, normalizarCelular } from '../services/avisos/celular';
import { MOTIVO_SIN_WHATSAPP } from '../services/avisos/cola';
import { parseBody, z } from '../validation';

const select = { aviso_email: true, aviso_whatsapp: true, telefono: true } as const;

// Motivos de omisión que escriben services/avisos/canales.ts y cola.ts, en palabras del residente.
const MOTIVOS_OMITIDA = new Map<string, string>([
  [MOTIVO_SIN_WHATSAPP, 'Tu condominio no tiene WhatsApp en su plan'],
  ['Plan sin asistente', 'Tu condominio no tiene el asistente en su plan'],
  ['Sin correo', 'Falta tu correo'],
  ['Sin celular', 'Falta tu celular'],
  ['Celular inválido', 'Tu celular no es válido; corrígelo en «Celular y avisos»'],
]);
const NO_ENTREGADO = 'No se pudo entregar';

/** Sólo frases nuestras: nunca el error crudo del proveedor ni el cuerpo del aviso. */
export function motivoAmigable(n: { estado: string; intentos: number; error: string | null }): string | null {
  if (n.estado === 'omitida') return MOTIVOS_OMITIDA.get(n.error ?? '') ?? 'No se pudo enviar por este canal';
  if (n.estado === 'error') return NO_ENTREGADO;
  if (n.estado === 'pendiente' && n.intentos > 0) return `${NO_ENTREGADO}; lo reintentamos`;
  return null;
}

const schema = z.object({
  aviso_email: z.boolean({ error: 'Debe ser verdadero o falso' }),
  aviso_whatsapp: z.boolean({ error: 'Debe ser verdadero o falso' }),
  // undefined = no tocar · '' / null = borrar · texto = celular de cualquier país (sin código, Perú).
  telefono: z.string().trim().max(30).nullish(),
});

/** Preferencias de avisos del propio usuario (cualquier rol). Se monta ANTES de `/me`. */
export const avisosPersonalesRouter = Router();

avisosPersonalesRouter.use((_req, res, next) => {
  res.locals.entidad = 'usuario';
  next();
});

avisosPersonalesRouter.get('/', async (req, res) => {
  res.json(await prisma.usuario.findUniqueOrThrow({ where: { id: currentUser(req).id }, select }));
});

/**
 * @openapi
 * /api/me/avisos/historial:
 *   get:
 *     summary: Últimos 20 avisos que se le enviaron al usuario actual (más nuevos primero); nunca cuerpo ni error del proveedor
 *     tags: [Avisos]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: "Lista de { id, canal (email|whatsapp|telegram), tipo, asunto, estado (pendiente|enviada|error|omitida), fecha (enviada_at o programada_para), motivo (texto amigable o null) }" }
 *       401: { description: Sin sesión }
 */
avisosPersonalesRouter.get('/historial', async (req, res) => {
  const filas = await prisma.notificacion.findMany({
    where: { usuario_id: currentUser(req).id },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: 20,
    select: { id: true, canal: true, tipo: true, asunto: true, estado: true, intentos: true, error: true, programada_para: true, enviada_at: true },
  });
  res.json(filas.map(n => ({
    id: n.id,
    canal: n.canal,
    tipo: n.tipo,
    asunto: n.asunto,
    estado: n.estado,
    fecha: (n.enviada_at ?? n.programada_para).toISOString(),
    motivo: motivoAmigable(n),
  })));
});

avisosPersonalesRouter.put('/', async (req, res) => {
  const u = currentUser(req);
  const body = parseBody(schema, req);
  const data: { aviso_email: boolean; aviso_whatsapp: boolean; telefono?: string | null } = { aviso_email: body.aviso_email, aviso_whatsapp: body.aviso_whatsapp };
  if (body.telefono !== undefined) {
    if (body.telefono === null || body.telefono === '') data.telefono = null;
    else {
      const n = normalizarCelular(body.telefono);
      if (!n) throw invalid('Datos inválidos: telefono: celular inválido (móvil, con su código de país; sin código se asume Perú)', { telefono: 'Celular inválido para el país elegido' });
      data.telefono = formatearCelular(n);
    }
  }
  if (body.aviso_whatsapp) {
    const telefono = data.telefono !== undefined ? data.telefono : (await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { telefono: true } })).telefono;
    if (!normalizarCelular(telefono)) throw invalid('Datos inválidos: telefono: para recibir WhatsApp necesitas un celular válido', { telefono: 'Necesitas un celular válido para WhatsApp' });
  }
  res.locals.entidadId = u.id;
  res.locals.auditDetalle = { campo: 'avisos', aviso_email: data.aviso_email, aviso_whatsapp: data.aviso_whatsapp };
  res.json(await prisma.usuario.update({ where: { id: u.id }, data, select }));
});
