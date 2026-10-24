import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export interface RateLimitOptions {
  api?: number;
  login?: number;
  ai?: number;
  password?: number;
  llavero?: number;
  evaluacion?: number;
}

const QUINCE_MIN = 15 * 60 * 1000;

function limiter(max: number, mensaje: string, keyGenerator: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs: QUINCE_MIN,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    message: { error: mensaje },
    validate: { keyGeneratorIpFallback: false },
  });
}

const ip = (req: Request) => ipKeyGenerator(req.ip ?? '');

export function crearLimitadores(opts: RateLimitOptions = {}) {
  return {
    api: limiter(opts.api ?? 300, 'Demasiadas solicitudes, intenta de nuevo en unos minutos', ip),
    login: limiter(opts.login ?? 10, 'Demasiados intentos de inicio de sesión, intenta de nuevo en 15 minutos', (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 160) : '';
      return `${ip(req)}|${email}`;
    }),
    // Por usuario: se monta después de `authenticate`.
    ai: limiter(opts.ai ?? 20, 'Has alcanzado el límite de consultas a la IA, intenta de nuevo más tarde', (req) => `u${req.user?.id ?? ip(req)}`),
    llavero: limiter(opts.llavero ?? 20, 'Demasiadas operaciones en el llavero, intenta de nuevo más tarde', (req) => `u${req.user?.id ?? ip(req)}`),
    evaluacion: limiter(opts.evaluacion ?? 20, 'Has pedido demasiadas evaluaciones de comprobantes, intenta de nuevo más tarde', (req) => `u${req.user?.id ?? ip(req)}`),
    password: limiter(opts.password ?? 10, 'Demasiados intentos de cambio de contraseña, intenta de nuevo más tarde', (req) => `u${req.user?.id ?? ip(req)}`),
  };
}
