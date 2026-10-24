import bcrypt from 'bcrypt';
import { Router, type RequestHandler } from 'express';
import { BCRYPT_COST } from '../config';
import { prisma } from '../db';
import { HttpError, notFound } from '../errors';
import { ipDe, registrarAuditoria } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { borrarCookie, crearSesion, listarActivas, ponerCookie, revocarDeUsuario, revocarPropia } from '../services/sesiones';
import { emailSchema, parse, parseBody, z } from '../validation';

// Hash de relleno: si el correo no existe se compara igual contra un hash, para que el tiempo no delate usuarios.
const HASH_FALSO = bcrypt.hashSync('relleno-no-es-una-contrasena', BCRYPT_COST);

const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Debe ser un texto' }).min(1, 'Es obligatoria').max(200),
});

const usuarioPublico = {
  id: true,
  nombre: true,
  email: true,
  rol: true,
  empresa_id: true,
  complejo_id: true,
} as const;

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Inicia sesión; entrega la cookie httpOnly house_sesion y devuelve { user, csrf }
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: "{ user, csrf } + Set-Cookie house_sesion" }
 *       401: { description: Credenciales inválidas }
 *       429: { description: Demasiados intentos }
 */
export function loginRouter(limitador: RequestHandler) {
  const authRouter = Router();
  authRouter.post('/login', limitador, async (req, res) => {
    const { email, password } = parseBody(loginSchema, req);
    const usuario = await prisma.usuario.findUnique({ where: { email }, omit: { password_hash: false } });
    const valido = await bcrypt.compare(password, usuario?.password_hash ?? HASH_FALSO);
    if (!usuario || !usuario.password_hash || !valido || !usuario.rol) {
      await registrarAuditoria({ usuario_id: usuario?.id, accion: 'login_fallido', entidad: 'usuario', entidad_id: usuario?.id, detalle: { email }, ip: ipDe(req) });
      throw new HttpError(401, 'Credenciales inválidas');
    }
    const user = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, empresa_id: usuario.empresa_id, complejo_id: usuario.complejo_id };
    const { token, csrf } = await crearSesion(user.id, ipDe(req), req.get('user-agent'));
    ponerCookie(res, token);
    await registrarAuditoria({ usuario_id: user.id, accion: 'login', entidad: 'usuario', entidad_id: user.id, ip: ipDe(req) });
    res.json({ user, csrf });
  });
  return authRouter;
}

/** Se monta DESPUÉS de `authenticate`. */
export const sesionRouter = Router();

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     summary: Usuario autenticado
 *     tags: [Auth]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: Usuario actual (sin hash de contraseña) más `csrf` de la sesión vigente }
 *       401: { description: Sin sesión }
 */
sesionRouter.get('/me', async (req, res) => {
  const u = currentUser(req);
  const usuario = await prisma.usuario.findUnique({ where: { id: u.id }, select: { ...usuarioPublico, telefono: true, empresa: { select: { id: true, nombre: true } }, complejo: { select: { id: true, nombre: true } } } });
  res.json({ ...usuario, csrf: req.sesion?.csrf });
});

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Revoca la sesión actual y borra la cookie
 *     tags: [Auth]
 *     responses:
 *       204: { description: Sesión cerrada }
 */
sesionRouter.post('/logout', async (req, res) => {
  await revocarPropia(currentUser(req).id, req.sesion!.id);
  borrarCookie(res);
  res.locals.entidad = 'sesion';
  res.locals.accion = 'logout';
  res.locals.entidadId = null;
  res.status(204).end();
});

/**
 * @openapi
 * /api/auth/sesiones:
 *   get:
 *     summary: Mis sesiones activas
 *     tags: [Auth]
 *     responses:
 *       200: { description: "[{ id, ip, user_agent, creada, ultimo_uso, actual }]" }
 */
sesionRouter.get('/sesiones', async (req, res) => {
  const filas = await listarActivas(currentUser(req).id);
  res.json(filas.map((s) => ({ id: s.id, ip: s.ip, user_agent: s.user_agent, creada: s.created_at, ultimo_uso: s.ultimo_uso_at, actual: s.id === req.sesion!.id })));
});

/**
 * @openapi
 * /api/auth/sesiones/cerrar-otras:
 *   post:
 *     summary: Revoca todas mis sesiones menos la actual
 *     tags: [Auth]
 *     responses:
 *       200: { description: "{ cerradas }" }
 */
sesionRouter.post('/sesiones/cerrar-otras', async (req, res) => {
  const r = await revocarDeUsuario(currentUser(req).id, req.sesion!.id);
  res.locals.entidad = 'sesion';
  res.locals.accion = 'cerrar_otras';
  res.locals.entidadId = null;
  res.locals.auditDetalle = { cerradas: r.count };
  res.json({ cerradas: r.count });
});

/**
 * @openapi
 * /api/auth/sesiones/{id}:
 *   delete:
 *     summary: Revoca una de mis sesiones (404 si no es mía)
 *     tags: [Auth]
 *     responses:
 *       204: { description: Sesión revocada }
 *       404: { description: No existe o no es tuya }
 */
sesionRouter.delete('/sesiones/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().min(1).max(64) }), req.params);
  if (!(await revocarPropia(currentUser(req).id, id))) throw notFound();
  if (id === req.sesion!.id) borrarCookie(res);
  res.locals.entidad = 'sesion';
  res.locals.accion = 'cerrar_sesion';
  res.locals.entidadId = null;
  res.locals.auditDetalle = { sesion: id };
  res.status(204).end();
});
