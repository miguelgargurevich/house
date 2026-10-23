import 'dotenv/config';
import { randomBytes } from 'node:crypto';

export const ROLES = ['superadmin', 'admin', 'propietario', 'inquilino', 'mantenimiento', 'seguridad'] as const;
export type Rol = (typeof ROLES)[number];

export const BCRYPT_COST = 12;
export const JWT_EXPIRES_IN = '8h';

export function isProduction(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === 'production';
}

/** En producción exige un secreto de al menos 32 caracteres; en desarrollo genera uno aleatorio por proceso. */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET;
  if (isProduction(env)) {
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET es obligatorio en producción y debe tener al menos 32 caracteres. Define la variable de entorno y vuelve a arrancar.');
    }
    return secret;
  }
  if (secret && secret.length >= 32) return secret;
  console.warn('[seguridad] JWT_SECRET no definido (o menor de 32 caracteres): uso un secreto aleatorio solo para este proceso; las sesiones se pierden al reiniciar.');
  return randomBytes(48).toString('hex');
}

export function parseCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export const JWT_SECRET = resolveJwtSecret();
