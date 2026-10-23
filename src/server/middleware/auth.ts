import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, type Rol } from '../config';
import { prisma } from '../db';
import { HttpError, forbidden } from '../errors';

export interface AuthUser {
  id: number;
  email: string;
  rol: Rol;
  empresa_id: number | null;
  complejo_id: number | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Autenticación requerida');
  return req.user;
}

/**
 * Valida el JWT (sólo HS256) y recarga al usuario desde la base: rol y empresa vigentes,
 * y un usuario eliminado deja de tener acceso aunque su token no haya vencido.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const [scheme, token] = header?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Autenticación requerida');
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string') throw new Error('payload');
    payload = decoded;
  } catch {
    throw new HttpError(401, 'Sesión inválida o vencida');
  }
  const id = Number(payload.id);
  if (!Number.isInteger(id)) throw new HttpError(401, 'Sesión inválida o vencida');
  const u = await prisma.usuario.findUnique({ where: { id }, select: { id: true, email: true, rol: true, empresa_id: true, complejo_id: true } });
  if (!u || !u.rol) throw new HttpError(401, 'Sesión inválida o vencida');
  req.user = { id: u.id, email: u.email, rol: u.rol as Rol, empresa_id: u.empresa_id, complejo_id: u.complejo_id };
  next();
};

/** Reutilizable: `router.get('/', requireRole('admin', 'superadmin'), …)`. superadmin siempre pasa. */
export function requireRole(...roles: Rol[]): RequestHandler {
  return (req, _res, next) => {
    const user = currentUser(req);
    if (user.rol !== 'superadmin' && !roles.includes(user.rol)) throw forbidden();
    next();
  };
}
