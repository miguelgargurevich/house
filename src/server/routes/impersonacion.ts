import { Router, type Response } from 'express';
import { HttpError, forbidden } from '../errors';
import { ipDe } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { COOKIE_REAL, MENSAJE_SESION_PRESTADA, MOTIVO_MAX, MOTIVO_MIN, RUTA_COOKIE_REAL, esSesionPrestada, exigirSesionPropia } from '../services/impersonacion/contexto';
import { iniciarImpersonacion, listarImpersonaciones, salirDeImpersonacion } from '../services/impersonacion/servicio';
import { borrarCookie, leerCookie, opcionesCookie, ponerCookie, sesionDeps } from '../services/sesiones';
import { idSchema, listQuerySchema, parse, parseBody, z } from '../validation';
import { prisma } from '../db';

const iniciarSchema = z.strictObject({
  usuario_id: idSchema,
  motivo: z.string({ error: 'Debe ser un texto' }).trim().min(MOTIVO_MIN, `Escribe el motivo (mínimo ${MOTIVO_MIN} caracteres)`).max(MOTIVO_MAX, `Máximo ${MOTIVO_MAX} caracteres`),
});

const cookieReal = (res: Response, token: string, maxAgeMs: number) => res.cookie(COOKIE_REAL, token, { ...opcionesCookie(), path: RUTA_COOKIE_REAL, maxAge: Math.max(1, Math.floor(maxAgeMs)) });
const borrarCookieReal = (res: Response) => res.clearCookie(COOKIE_REAL, { ...opcionesCookie(), path: RUTA_COOKIE_REAL });

/** «Entrar como» (sólo superadmin). Se monta DESPUÉS de `authenticate`. Ver `services/impersonacion/`. */
export const impersonacionRouter = Router();

impersonacionRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/**
 * @openapi
 * /api/impersonacion:
 *   post:
 *     summary: Entrar como otra persona (sólo superadmin con sesión propia; motivo obligatorio)
 *     description: Abre una sesión PRESTADA de 30 min (o lo que le quede a la sesión real, lo menor) como el usuario elegido y cambia la cookie a ella. La sesión real del superadmin no se revoca ni se alarga.
 *     tags: [Impersonación]
 *     responses:
 *       200: { description: "{ user, csrf, impersonando } + Set-Cookie house_sesion (prestada) y house_sesion_real" }
 *       403: { description: No eres superadmin, ya estás en una sesión prestada, o el objetivo es superadmin }
 *       404: { description: El usuario no existe }
 *       422: { description: Motivo inválido o cuenta inactiva }
 */
impersonacionRouter.post('/', async (req, res) => {
  const u = currentUser(req);
  if (esSesionPrestada(req)) throw forbidden(MENSAJE_SESION_PRESTADA); // no se encadena
  if (u.rol !== 'superadmin') throw forbidden();
  const { usuario_id, motivo } = parseBody(iniciarSchema, req);
  const tokenReal = leerCookie(req);
  if (!tokenReal || !req.sesion) throw new HttpError(401, 'Autenticación requerida');
  const r = await iniciarImpersonacion({
    superadminId: u.id, real: { id: req.sesion.id, expira_at: req.sesion.expira_at, token: tokenReal }, usuarioId: usuario_id, motivo, ip: ipDe(req), userAgent: req.get('user-agent'),
  });
  const dura = r.expira_at.getTime() - sesionDeps.ahora().getTime();
  ponerCookie(res, r.token, dura);
  cookieReal(res, tokenReal, dura);
  res.locals.sinAuditoria = true; // `impersonar_inicio` ya quedó registrado por el servicio, con el superadmin como actor
  const objetivo = await prisma.usuario.findUniqueOrThrow({ where: { id: r.objetivoId }, select: { id: true, nombre: true, email: true, rol: true } });
  res.json({ user: objetivo, csrf: r.csrf, impersonando: { por: { id: u.id, nombre: (await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { nombre: true } })).nombre }, motivo, expira_at: r.expira_at.toISOString() } });
});

/**
 * @openapi
 * /api/impersonacion/salir:
 *   post:
 *     summary: Volver a mi cuenta (cierra la sesión prestada y restaura la sesión real, sin alargarla)
 *     tags: [Impersonación]
 *     responses:
 *       200: { description: "{ user, csrf } + Set-Cookie house_sesion (la real)" }
 *       401: { description: La sesión real ya no sirve (vencida, revocada, o ya no eres superadmin): hay que iniciar sesión }
 *       409: { description: No estás viendo Torre como otra persona }
 */
impersonacionRouter.post('/salir', async (req, res) => {
  if (!esSesionPrestada(req)) throw new HttpError(409, 'No estás viendo Torre como otra persona');
  res.locals.sinAuditoria = true; // `impersonar_fin` lo registra el cierre, con el superadmin como actor
  const r = await salirDeImpersonacion({ id: req.sesion!.id, impersonacion_id: req.user!.impersonacion_id ?? null }, leerCookie(req, COOKIE_REAL), ipDe(req));
  borrarCookieReal(res);
  if (!r.ok) {
    borrarCookie(res);
    throw new HttpError(401, 'Tu sesión como superadmin ya no está vigente. Inicia sesión de nuevo.');
  }
  ponerCookie(res, r.token, r.expira_at.getTime() - sesionDeps.ahora().getTime()); // la real conserva su vencimiento: no se alarga
  const sa = await prisma.usuario.findUniqueOrThrow({ where: { id: r.superadminId }, select: { id: true, nombre: true, email: true, rol: true } });
  res.json({ user: sa, csrf: r.csrf });
});

/**
 * @openapi
 * /api/impersonacion:
 *   get:
 *     summary: Historial de «Entrar como» (sólo superadmin con sesión propia)
 *     tags: [Impersonación]
 *     responses:
 *       200: { description: "{ items: [{ id, superadmin, usuario, motivo, inicio_at, expira_at, fin_at, fin_motivo, ip }], total, page, pageSize }" }
 */
impersonacionRouter.get('/', async (req, res) => {
  exigirSesionPropia(req);
  if (currentUser(req).rol !== 'superadmin') throw forbidden();
  const q = parse(listQuerySchema, req.query);
  res.json(await listarImpersonaciones(q.page, q.pageSize));
});
