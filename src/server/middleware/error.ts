import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { HttpError } from '../errors';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: req.path.startsWith('/api') ? 'Ruta no encontrada' : 'No encontrado' });
};

/** Único punto que responde errores: al cliente sólo un mensaje corto; el detalle se registra en el servidor. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    res.status(err.status).json(err.campos ? { error: err.message, campos: err.campos } : { error: err.message });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return void res.status(409).json({ error: 'Ya existe un registro con esos datos' });
    if (err.code === 'P2025') return void res.status(404).json({ error: 'Recurso no encontrado' });
    if (err.code === 'P2003') return void res.status(409).json({ error: 'La operación viola una relación con otros registros (no se puede eliminar o referenciar)' });
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') return void res.status(413).json({ error: 'El cuerpo de la petición es demasiado grande' });
  if (e?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'JSON inválido' });
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
    return void res.status(e.status).json({ error: 'Petición inválida' });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Error interno del servidor' });
};
