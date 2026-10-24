import { Router } from 'express';
import { notFound } from '../errors';
import { currentUser } from '../middleware/auth';
import { DIAS_MAXIMOS, DIAS_POR_DEFECTO, MAX_TOKENS_ACTIVOS, crearToken, listarTokens, revocarToken } from '../services/tokensApi';
import { parseBody, texto, z } from '../validation';

const crearSchema = z.strictObject({
  nombre: texto(60),
  dias: z.number({ error: 'Debe ser un número de días' }).int('Debe ser un entero').min(1, 'Mínimo 1 día').max(DIAS_MAXIMOS, `Máximo ${DIAS_MAXIMOS} días`).optional(),
});

/** Tokens de API personales (sólo lectura) del propio usuario, para conectar un cliente MCP. Con sesión (cookie + CSRF); el Bearer NO abre esta ruta. Se monta ANTES de `/me`. */
export const tokensApiRouter = Router();

tokensApiRouter.use((_req, res, next) => {
  res.locals.entidad = 'token_api';
  res.set('Cache-Control', 'no-store');
  next();
});

tokensApiRouter.get('/', async (req, res) => {
  res.json({ tokens: await listarTokens(currentUser(req).id), max_activos: MAX_TOKENS_ACTIVOS, dias_por_defecto: DIAS_POR_DEFECTO, dias_maximos: DIAS_MAXIMOS });
});

tokensApiRouter.post('/', async (req, res) => {
  const { nombre, dias } = parseBody(crearSchema, req);
  const t = await crearToken(currentUser(req), nombre, dias);
  res.locals.auditDetalle = { nombre, dias: dias ?? DIAS_POR_DEFECTO, prefijo: t.prefijo }; // nunca el token
  res.status(201).json(t); // única vez que el token sale completo
});

tokensApiRouter.delete('/:id', async (req, res) => {
  const id = String(req.params.id).slice(0, 40);
  if (!(await revocarToken(currentUser(req).id, id))) throw notFound('Token');
  res.locals.accion = 'revocar';
  res.locals.auditDetalle = { id };
  res.status(204).end();
});
