import type { Request, RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

const ACCION: Record<string, string> = { POST: 'crear', PUT: 'editar', PATCH: 'editar', DELETE: 'eliminar' };
const SENSIBLE = /pass|token|secret|actual|nueva|hash|clave|key|authorization|credencial/i;
// Rutas que mutan pero no son datos de negocio.
const EXCLUIDAS = new Set(['/api/ai-chat', '/api/auth/login']);

export const ipDe = (req: Request) => req.ip ?? null;

/** Cuerpo de la petición resumido y sin campos sensibles, para la auditoría. */
function resumir(body: unknown): Prisma.InputJsonValue | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSIBLE.test(k)) out[k] = '[omitido]';
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else out[k] = '[objeto]';
  }
  return out;
}

export async function registrarAuditoria(data: { usuario_id?: number | null; accion: string; entidad: string; entidad_id?: number | null; detalle?: Prisma.InputJsonValue; ip?: string | null }) {
  try {
    await prisma.auditoria.create({ data: { usuario_id: data.usuario_id ?? null, accion: data.accion, entidad: data.entidad, entidad_id: data.entidad_id ?? null, detalle: data.detalle, ip: data.ip ?? null } });
  } catch (err) {
    // La auditoría nunca debe tumbar la petición.
    console.error('[auditoria] no se pudo registrar', err);
  }
}

/**
 * Registra toda mutación exitosa (2xx) tras responder. Los handlers pueden fijar
 * `res.locals.entidad`, `res.locals.accion`, `res.locals.entidadId` y `res.locals.auditDetalle`.
 */
export const auditoria: RequestHandler = (req, res, next) => {
  if (!ACCION[req.method]) return next();
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const accion = (res.locals.accion as string | undefined) ?? ACCION[req.method]!;
    const path = req.baseUrl + req.path;
    if (EXCLUIDAS.has(path)) return;
    const entidad = (res.locals.entidad as string | undefined) ?? path.split('/')[2] ?? 'desconocida';
    void registrarAuditoria({
      usuario_id: req.user?.id,
      accion,
      entidad,
      entidad_id: (res.locals.entidadId as number | undefined) ?? (Number(req.params.id) || null),
      detalle: (res.locals.auditDetalle as Prisma.InputJsonValue | undefined) ?? resumir(req.body),
      ip: ipDe(req),
    });
  });
  next();
};
