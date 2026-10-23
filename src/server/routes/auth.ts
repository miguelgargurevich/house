import bcrypt from 'bcrypt';
import { Router, type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { BCRYPT_COST, JWT_EXPIRES_IN, JWT_SECRET } from '../config';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { ipDe, registrarAuditoria } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { emailSchema, parseBody, z } from '../validation';

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
 *     summary: Inicia sesión y devuelve un JWT de 8 horas
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
 *       200: { description: "{ token, user }" }
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
    const token = jwt.sign({ id: user.id, email: user.email, rol: user.rol, empresa_id: user.empresa_id, complejo_id: user.complejo_id }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRES_IN,
    });
    await registrarAuditoria({ usuario_id: user.id, accion: 'login', entidad: 'usuario', entidad_id: user.id, ip: ipDe(req) });
    res.json({ token, user });
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
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Usuario actual (sin hash de contraseña) }
 *       401: { description: Sin sesión }
 */
sesionRouter.get('/me', async (req, res) => {
  const u = currentUser(req);
  const usuario = await prisma.usuario.findUnique({ where: { id: u.id }, select: { ...usuarioPublico, telefono: true, empresa: { select: { id: true, nombre: true } }, complejo: { select: { id: true, nombre: true } } } });
  res.json(usuario);
});
