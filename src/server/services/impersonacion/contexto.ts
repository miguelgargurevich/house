// «Entrar como»: lo que comparten la sesión, la auditoría y las rutas. Sin dependencias de `sesiones.ts` (evita ciclos).
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, RequestHandler } from 'express';
import { forbidden } from '../../errors';

/** Duración máxima de una sesión prestada. */
export const DURACION_MS = 30 * 60_000;
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 200;
/** Cookie httpOnly con el token de la sesión REAL del superadmin mientras dura la prestada. Sólo viaja a `/api/impersonacion`. */
export const COOKIE_REAL = 'house_sesion_real';
export const RUTA_COOKIE_REAL = '/api/impersonacion';
export const MENSAJE_SESION_PRESTADA = 'No disponible mientras ves Torre como otra persona';

export interface ContextoImpersonacion { impersonador_id: number; impersonacion_id: string }

const almacen = new AsyncLocalStorage<ContextoImpersonacion>();
export const contextoActual = () => almacen.getStore();

/** Middleware (después de `authenticate`): deja el contexto a mano de la auditoría aunque se registre fuera del handler (segundo plano, servicios). */
export const contextoImpersonacion: RequestHandler = (req, _res, next) => {
  const { impersonador_id, impersonacion_id } = req.user ?? {};
  if (impersonador_id && impersonacion_id) almacen.run({ impersonador_id, impersonacion_id }, next);
  else next();
};

/** ¿La sesión es prestada? */
export const esSesionPrestada = (req: Request) => !!req.user?.impersonador_id;

/**
 * Corta con 403 si la petición viene de una sesión prestada. Se usa en lo que es PERSONAL del dueño de la cuenta:
 * contraseña, correo, celular, tokens de API, sesiones y todo lo de superadmin.
 */
export function exigirSesionPropia(req: Request): void {
  if (esSesionPrestada(req)) throw forbidden(MENSAJE_SESION_PRESTADA);
}

/** Middleware para montar en rutas enteras que son personales del dueño de la cuenta (conversaciones de la IA, vincular su WhatsApp o Telegram). */
export const soloSesionPropia: RequestHandler = (req, _res, next) => {
  exigirSesionPropia(req);
  next();
};
