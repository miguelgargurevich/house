import type { Request, RequestHandler } from 'express';
import type { Rol } from '../config';
import { prisma } from '../db';
import { HttpError, forbidden } from '../errors';
import { buscarSesionActiva, igualesEnTiempoConstante, leerCookie, origenPermitido } from '../services/sesiones';

export interface AuthUser {
  id: number;
  email: string;
  rol: Rol;
  empresa_id: number | null;
  complejo_id: number | null;
  /** Cargo en la junta directiva (sólo propietarios): presidente | tesorero | secretario | vocal. */
  cargo_junta: string | null;
  /** Block al que pertenece el cargo; null = todo su condominio. */
  estructura_id: number | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    /** Sesión vigente (sólo tras `authenticate`). */
    sesion?: { id: string; csrf: string };
  }
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Autenticación requerida');
  return req.user;
}

const MUTA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SIN_SESION = 'Sesión inválida o vencida';

/**
 * Autentica con la cookie de sesión (`house_sesion`): busca la sesión por el hash del token, valida
 * revocación/expiración/inactividad y recarga al usuario desde la base (rol y empresa vigentes).
 * Las mutaciones exigen además `X-CSRF-Token` y un `Origin`/`Referer` propio.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = leerCookie(req);
  if (!token) throw new HttpError(401, 'Autenticación requerida');
  const sesion = await buscarSesionActiva(token);
  if (!sesion) throw new HttpError(401, SIN_SESION);
  const u = await prisma.usuario.findUnique({ where: { id: sesion.usuario_id }, select: { id: true, email: true, rol: true, empresa_id: true, complejo_id: true, cargo_junta: true, estructura_id: true } });
  if (!u || !u.rol) throw new HttpError(401, SIN_SESION);
  if (MUTA.has(req.method)) {
    if (!origenPermitido(req)) throw forbidden('Petición bloqueada: el origen no coincide con el de la aplicación');
    const csrf = req.get('x-csrf-token');
    if (!csrf || !igualesEnTiempoConstante(csrf, sesion.csrf_token)) throw forbidden('Falta o no coincide el token CSRF. Recarga la página e inténtalo de nuevo');
  }
  req.user = { id: u.id, email: u.email, rol: u.rol as Rol, empresa_id: u.empresa_id, complejo_id: u.complejo_id, cargo_junta: u.cargo_junta, estructura_id: u.estructura_id };
  req.sesion = { id: sesion.id, csrf: sesion.csrf_token };
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
