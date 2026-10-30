import bcrypt from 'bcrypt';
import { Router, type RequestHandler } from 'express';
import { BCRYPT_COST } from '../config';
import { prisma } from '../db';
import { HttpError, notFound } from '../errors';
import { ipDe, registrarAuditoria } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { MENSAJE_LOGIN_BLOQUEADO, type BloqueoCuenta } from '../middleware/rateLimit';
import { aceptarInvitacion, datosDeInvitacion } from '../services/invitaciones';
import { borrarCookie, crearSesion, listarActivas, ponerCookie, revocarDeUsuario, revocarPropia } from '../services/sesiones';
import { emailSchema, parse, parseBody, passwordSchema, z } from '../validation';

// Hash de relleno: si el correo no existe se compara igual contra un hash, para que el tiempo no delate usuarios.
const HASH_FALSO = bcrypt.hashSync('relleno-no-es-una-contrasena', BCRYPT_COST);

const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Debe ser un texto' }).min(1, 'Es obligatoria').max(200),
});

/** `maria@casa.pe` → `m***@casa.pe`: deja ver el dominio (útil para detectar ataques) sin guardar lo que se tecleó. */
export function enmascararCorreo(email: string): string {
  const i = email.lastIndexOf('@');
  if (i < 1) return '***';
  return `${email[0]}***${email.slice(i)}`;
}

const usuarioPublico = {
  id: true,
  nombre: true,
  email: true,
  rol: true,
  empresa_id: true,
  complejo_id: true,
  cargo_junta: true,
  estructura_id: true,
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
export function loginRouter(limitador: RequestHandler, cuenta: BloqueoCuenta) {
  const authRouter = Router();
  authRouter.post('/login', limitador, async (req, res) => {
    const { email, password } = parseBody(loginSchema, req);
    // Bloqueo por cuenta (cualquier IP): responde igual que el límite por IP+correo, exista o no el correo.
    if (cuenta.bloqueada(email)) throw new HttpError(429, MENSAJE_LOGIN_BLOQUEADO);
    const usuario = await prisma.usuario.findUnique({ where: { email }, omit: { password_hash: false }, include: { estructura: { select: { nombre: true } } } });
    const valido = await bcrypt.compare(password, usuario?.password_hash ?? HASH_FALSO);
    if (!usuario || !usuario.password_hash || !valido || !usuario.rol) {
      cuenta.fallo(email);
      await registrarAuditoria({ usuario_id: usuario?.id, accion: 'login_fallido', entidad: 'usuario', entidad_id: usuario?.id, detalle: usuario ? undefined : { email_enmascarado: enmascararCorreo(email) }, ip: ipDe(req) });
      throw new HttpError(401, 'Credenciales inválidas');
    }
    // Cuenta del registro público sin confirmar: la contraseña era correcta (no se delata nada), pero no entra hasta abrir el enlace del correo.
    if (!usuario.correo_verificado) throw new HttpError(403, 'Confirma tu correo para entrar: te enviamos un enlace al registrarte.', undefined, 'CORREO_NO_VERIFICADO');
    cuenta.exito(email);
    const user = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, empresa_id: usuario.empresa_id, complejo_id: usuario.complejo_id, cargo_junta: usuario.cargo_junta, estructura_id: usuario.estructura_id, estructura_nombre: usuario.estructura?.nombre ?? null };
    const { token, csrf } = await crearSesion(user.id, ipDe(req), req.get('user-agent'));
    ponerCookie(res, token);
    await registrarAuditoria({ usuario_id: user.id, accion: 'login', entidad: 'usuario', entidad_id: user.id, ip: ipDe(req) });
    res.json({ user, csrf });
  });
  return authRouter;
}

/**
 * Tramo PÚBLICO (sin sesión): el enlace de invitación del correo. Ver a quién se invita y crear la contraseña. Mismo 410 para todo enlace
 * inválido (inexistente, vencido, usado o de alguien que ya tiene contraseña): no revela si la cuenta existe.
 */
export function invitacionRouter(limitador: RequestHandler) {
  const r = Router();
  const tokenSchema = z.string({ error: 'Debe ser un texto' }).min(20, 'Enlace incompleto').max(200, 'Enlace inválido');

  /**
   * @openapi
   * /api/auth/invitacion:
   *   get:
   *     summary: "Datos de la invitación del enlace (?token=): nombre, correo enmascarado y rol"
   *     tags: [Auth]
   *     responses:
   *       200: { description: "{ nombre, email (enmascarado), rol, rol_texto, organizacion }" }
   *       410: { description: El enlace no es válido o ya venció }
   */
  r.get('/', limitador, async (req, res) => {
    const { token } = parse(z.object({ token: tokenSchema }), req.query);
    res.set('Cache-Control', 'no-store');
    res.json(await datosDeInvitacion(token));
  });

  /**
   * @openapi
   * /api/auth/invitacion:
   *   post:
   *     summary: Crea la contraseña con el enlace de invitación (un solo uso) e inicia sesión
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [token, password]
   *             properties:
   *               token: { type: string }
   *               password: { type: string }
   *     responses:
   *       200: { description: "{ user, csrf } + Set-Cookie house_sesion" }
   *       410: { description: El enlace no es válido o ya venció }
   *       422: { description: Contraseña rechazada }
   */
  r.post('/', limitador, async (req, res) => {
    const { token, password } = parseBody(z.object({ token: tokenSchema, password: passwordSchema }), req);
    const user = await aceptarInvitacion(token, password);
    const { token: sesion, csrf } = await crearSesion(user.id, ipDe(req), req.get('user-agent'));
    ponerCookie(res, sesion);
    await registrarAuditoria({ usuario_id: user.id, accion: 'aceptar_invitacion', entidad: 'usuario', entidad_id: user.id, ip: ipDe(req) });
    res.set('Cache-Control', 'no-store');
    res.json({ user, csrf });
  });

  return r;
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
  const cargado = await prisma.usuario.findUnique({ where: { id: u.id }, select: { ...usuarioPublico, telefono: true, aviso_email: true, aviso_whatsapp: true, empresa: { select: { id: true, nombre: true } }, complejo: { select: { id: true, nombre: true } }, estructura: { select: { nombre: true } } } });
  // Del block sólo sale el nombre (para el rótulo del cargo), no el objeto de la torre.
  const { estructura, ...usuario } = cargado ?? { estructura: null };
  res.json({ ...usuario, estructura_nombre: estructura?.nombre ?? null, csrf: req.sesion?.csrf });
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
