import { Router } from 'express';
import { currentUser } from '../middleware/auth';
import { configPush } from '../services/push/config';
import { darDeBajaDispositivo, registrarDispositivo } from '../services/push/dispositivos';
import { endpointPermitido, LARGO_MAXIMO_ENDPOINT } from '../services/push/endpoints';
import { exigirSesionPropia } from '../services/impersonacion/contexto';
import { parseBody, z } from '../validation';

/** Token de FCM: letras, dígitos, `:`, `_`, `-` (~140-200 caracteres; un token de APNs son 64 hex y también cabe). */
const tokenFcm = z.string({ error: 'Debe ser un texto' }).trim().regex(/^[A-Za-z0-9:_-]{20,400}$/, 'Token de dispositivo inválido');
const base64Url = (min: number, max: number) => z.string({ error: 'Debe ser un texto' }).regex(/^[A-Za-z0-9_-]+$/, 'Llave inválida').min(min, 'Llave inválida').max(max, 'Llave inválida');

const altaSchema = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('fcm'), token: tokenFcm, plataforma: z.enum(['android', 'ios'], { error: 'La plataforma debe ser android o ios' }) }),
  z.strictObject({
    tipo: z.literal('web'),
    // Sólo los servicios de push de los navegadores: el servidor le hace un POST a esta dirección (ver `endpoints.ts`).
    endpoint: z.string({ error: 'Debe ser un texto' }).trim().max(LARGO_MAXIMO_ENDPOINT, 'Dirección demasiado larga').refine(endpointPermitido, 'Dirección de push no permitida'),
    keys: z.strictObject({ p256dh: base64Url(80, 100), auth: base64Url(16, 32) }),
  }),
]);

// Por token (FCM) o endpoint (navegador): va en el cuerpo, no en la ruta, porque un endpoint es una URL larga.
const bajaSchema = z.strictObject({ token: z.string({ error: 'Debe ser un texto' }).trim().min(1, 'Es obligatorio').max(LARGO_MAXIMO_ENDPOINT, 'Demasiado largo') });

/**
 * Avisos push de la PERSONA con sesión (cualquier rol). Siempre es el usuario de la sesión: ninguna ruta recibe un usuario. Se monta ANTES de `/me`.
 * Nunca guarda ni audita el token/endpoint: son datos de acceso al dispositivo.
 */
export const pushRouter = Router();

pushRouter.use((_req, res, next) => {
  res.locals.entidad = 'dispositivo_push';
  res.set('Cache-Control', 'no-store');
  next();
});

/** Qué canales de push tiene el servidor listos y la clave pública VAPID (no es un secreto: el navegador la necesita para suscribirse). */
pushRouter.get('/config', (_req, res) => {
  const c = configPush();
  res.json({ fcm: !!c.fcm, web: !!c.web, vapid_public: c.web?.publica ?? null });
});

/** Alta o actualización del dispositivo (por token). Con una sesión prestada («Entrar como») no registra nada: el dispositivo es del administrador, no de la persona a quien ve. */
pushRouter.post('/dispositivos', async (req, res) => {
  exigirSesionPropia(req);
  const e = parseBody(altaSchema, req);
  const entrada = e.tipo === 'fcm' ? e : { tipo: 'web' as const, endpoint: e.endpoint, p256dh: e.keys.p256dh, auth: e.keys.auth };
  const { reasignado } = await registrarDispositivo(currentUser(req).id, entrada);
  res.locals.accion = 'registrar';
  res.locals.entidadId = currentUser(req).id;
  res.locals.auditDetalle = { tipo: e.tipo, plataforma: e.tipo === 'fcm' ? e.plataforma : 'web' }; // nunca el token ni el endpoint
  res.json({ registrado: true, reasignado });
});

/** Baja del dispositivo (al cerrar sesión o al apagar los avisos). Sólo borra si es de quien llama; con uno ajeno o inexistente contesta lo mismo, sin decir de quién es. */
pushRouter.post('/dispositivos/baja', async (req, res) => {
  const { token } = parseBody(bajaSchema, req);
  await darDeBajaDispositivo(currentUser(req).id, token);
  res.locals.accion = 'baja';
  res.locals.entidadId = currentUser(req).id;
  res.locals.auditDetalle = { campo: 'dispositivo_push' };
  res.status(204).end();
});
