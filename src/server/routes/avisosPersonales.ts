import { Router } from 'express';
import { prisma } from '../db';
import { invalid } from '../errors';
import { currentUser } from '../middleware/auth';
import { formatearCelular, normalizarCelular } from '../services/avisos/celular';
import { parseBody, z } from '../validation';

const select = { aviso_email: true, aviso_whatsapp: true, telefono: true } as const;

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
