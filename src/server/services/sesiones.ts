import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { isProduction, parseCorsOrigins } from '../config';
import { prisma } from '../db';

export const COOKIE = 'house_sesion';
export const VIGENCIA_MS = 12 * 3_600_000; // caducidad absoluta
export const INACTIVIDAD_MS = 2 * 3_600_000;
export const TOQUE_MS = 60_000; // `ultimo_uso_at` se actualiza como mucho una vez por minuto

/** Reloj inyectable para las pruebas. */
export const sesionDeps = { ahora: () => new Date() };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const aleatorio = () => randomBytes(32).toString('base64url');

/** Activa = no revocada, dentro de la vigencia absoluta y con uso dentro de la ventana de inactividad. */
function filtroActiva(ahora: Date) {
  return { revocada_at: null, expira_at: { gt: ahora }, ultimo_uso_at: { gt: new Date(ahora.getTime() - INACTIVIDAD_MS) } };
}

export async function crearSesion(usuarioId: number, ip: string | null, userAgent: string | undefined) {
  const token = aleatorio();
  const csrf = aleatorio();
  const ahora = sesionDeps.ahora();
  await prisma.sesion.create({
    data: {
      usuario_id: usuarioId,
      token_hash: sha256(token),
      csrf_token: csrf,
      ip,
      user_agent: userAgent?.slice(0, 300) ?? null,
      created_at: ahora,
      ultimo_uso_at: ahora,
      expira_at: new Date(ahora.getTime() + VIGENCIA_MS),
    },
  });
  return { token, csrf };
}

/** Devuelve la sesión si el token corresponde a una activa; desliza `ultimo_uso_at` (máx. cada 60 s). */
export async function buscarSesionActiva(token: string) {
  const ahora = sesionDeps.ahora();
  const s = await prisma.sesion.findFirst({ where: { token_hash: sha256(token), ...filtroActiva(ahora) } });
  if (!s) return null;
  if (ahora.getTime() - s.ultimo_uso_at.getTime() >= TOQUE_MS) {
    await prisma.sesion.update({ where: { id: s.id }, data: { ultimo_uso_at: ahora } });
  }
  return s;
}

export const listarActivas = (usuarioId: number) =>
  prisma.sesion.findMany({ where: { usuario_id: usuarioId, ...filtroActiva(sesionDeps.ahora()) }, orderBy: { ultimo_uso_at: 'desc' } });

/** Revoca una sesión del usuario; false si no existe, no es suya o ya estaba revocada. */
export async function revocarPropia(usuarioId: number, id: string) {
  const r = await prisma.sesion.updateMany({ where: { id, usuario_id: usuarioId, revocada_at: null }, data: { revocada_at: sesionDeps.ahora() } });
  return r.count > 0;
}

/** Revoca todas las sesiones del usuario salvo (opcionalmente) una. */
export const revocarDeUsuario = (usuarioId: number, exceptoId?: string) =>
  prisma.sesion.updateMany({
    where: { usuario_id: usuarioId, revocada_at: null, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
    data: { revocada_at: sesionDeps.ahora() },
  });

/** Borra sesiones revocadas, vencidas o inactivas. Devuelve cuántas. */
export async function limpiarSesiones() {
  const ahora = sesionDeps.ahora();
  const r = await prisma.sesion.deleteMany({
    where: { OR: [{ revocada_at: { not: null } }, { expira_at: { lte: ahora } }, { ultimo_uso_at: { lte: new Date(ahora.getTime() - INACTIVIDAD_MS) } }] },
  });
  return r.count;
}

/** Tarea periódica en proceso (cada hora). `SESIONES_LIMPIEZA=off` la desactiva. */
export function iniciarLimpieza(env: NodeJS.ProcessEnv = process.env) {
  if (env.SESIONES_LIMPIEZA === 'off') return null;
  const t = setInterval(() => {
    limpiarSesiones().catch((err) => console.error('[sesiones] no se pudo limpiar', err));
  }, 3_600_000);
  t.unref();
  return t;
}

// ---------- Cookie ----------

export function leerCookie(req: Request, nombre = COOKIE): string | null {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim()) || null;
  }
  return null;
}

export const opcionesCookie = (env: NodeJS.ProcessEnv = process.env) =>
  ({ httpOnly: true, sameSite: 'lax', path: '/', secure: isProduction(env) }) as const;

export const ponerCookie = (res: Response, token: string) => res.cookie(COOKIE, token, { ...opcionesCookie(), maxAge: VIGENCIA_MS });
export const borrarCookie = (res: Response) => res.clearCookie(COOKIE, opcionesCookie());

// ---------- CSRF ----------

export function igualesEnTiempoConstante(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `Origin` (o, si falta, `Referer`) debe ser el propio host o un origen de CORS_ORIGIN. Sin ninguno de los dos se acepta: el token CSRF sigue siendo obligatorio. */
export function origenPermitido(req: Request): boolean {
  const declarado = req.get('origin') ?? req.get('referer');
  if (!declarado) return true;
  let url: URL;
  try {
    url = new URL(declarado);
  } catch {
    return false; // incluye `Origin: null`
  }
  const origin = url.origin;
  const allowed = parseCorsOrigins();
  return url.host === req.get('host') || allowed.includes(origin);
}
