import type { Request, RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { contextoActual } from '../services/impersonacion/contexto';

const ACCION: Record<string, string> = { POST: 'crear', PUT: 'editar', PATCH: 'editar', DELETE: 'eliminar' };
const SENSIBLE = /pass|token|secret|actual|nueva|hash|clave|key|authorization|credencial/i;
// Rutas que mutan pero no son datos de negocio.
const EXCLUIDAS = new Set(['/api/auth/login']);
// Todo `/api/ai-chat/*` queda fuera: el contenido de las conversaciones sólo lo ve su dueño (ni el superadmin, ni la auditoría).
const excluida = (path: string) => EXCLUIDAS.has(path) || path === '/api/ai-chat' || path.startsWith('/api/ai-chat/');

export const ipDe = (req: Request) => req.ip ?? null;

/** Cuerpo de la petición resumido y sin campos sensibles, para la auditoría. */
function resumir(body: unknown): Prisma.InputJsonValue | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) return undefined; // un archivo crudo nunca va a la auditoría
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSIBLE.test(k)) out[k] = '[omitido]';
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else out[k] = '[objeto]';
  }
  return out;
}

/**
 * `impersonador_id`/`impersonacion_id`: si se omiten (undefined) se toman del contexto de la petición, así toda fila escrita desde una sesión
 * prestada («Entrar como») lleva al superadmin aunque se registre en segundo plano. `null` = sin impersonador, a propósito.
 */
export async function registrarAuditoria(data: { usuario_id?: number | null; accion: string; entidad: string; entidad_id?: number | null; detalle?: Prisma.InputJsonValue; ip?: string | null; impersonador_id?: number | null; impersonacion_id?: string | null }) {
  try {
    const ctx = contextoActual();
    await prisma.auditoria.create({
      data: {
        usuario_id: data.usuario_id ?? null, accion: data.accion, entidad: data.entidad, entidad_id: data.entidad_id ?? null, detalle: data.detalle, ip: data.ip ?? null,
        impersonador_id: data.impersonador_id === undefined ? (ctx?.impersonador_id ?? null) : data.impersonador_id,
        impersonacion_id: data.impersonacion_id === undefined ? (ctx?.impersonacion_id ?? null) : data.impersonacion_id,
      },
    });
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
    if (res.locals.sinAuditoria) return; // el handler ya dejó su propia fila (p. ej. impersonar_inicio / impersonar_fin)
    const accion = (res.locals.accion as string | undefined) ?? ACCION[req.method]!;
    const path = req.baseUrl + req.path;
    if (excluida(path)) return;
    const entidad = (res.locals.entidad as string | undefined) ?? path.split('/')[2] ?? 'desconocida';
    void registrarAuditoria({
      usuario_id: req.user?.id,
      accion,
      entidad,
      entidad_id: (res.locals.entidadId as number | undefined) ?? (Number(req.params.id) || null),
      detalle: (res.locals.auditDetalle as Prisma.InputJsonValue | undefined) ?? resumir(req.body),
      ip: ipDe(req),
      impersonador_id: req.user?.impersonador_id ?? null,
      impersonacion_id: req.user?.impersonacion_id ?? null,
    });
  });
  next();
};
