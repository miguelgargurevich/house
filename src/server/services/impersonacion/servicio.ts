// «Entrar como» (sólo superadmin): una sesión NUEVA para el objetivo, atada a la entrada de `Impersonacion`; la sesión real del superadmin
// no se toca (ni se revoca ni se alarga). El token de la sesión real viaja en la cookie httpOnly `house_sesion_real` (sólo hacia
// `/api/impersonacion`): en la base sólo está su hash, así que sin esa cookie no hay forma de «volver» desde una sesión prestada robada.
import type { Sesion } from '@prisma/client';
import { prisma } from '../../db';
import { HttpError, forbidden, invalid, notFound } from '../../errors';
import { registrarAuditoria } from '../../middleware/audit';
import { accesoDesactivado } from '../personas/servicio';
import { INACTIVIDAD_MS, crearSesion, hashDeToken, igualesEnTiempoConstante, sesionActivaDonde, sesionDeps } from '../sesiones';
import { cerrarImpersonacion, cerrarTerminadas, type FinMotivo } from './cierre';
import { DURACION_MS } from './contexto';

const SIN_SESION = 'Sesión inválida o vencida';

export interface SesionRealDelSuperadmin { id: string; expira_at: Date; token: string }

/** Una cuenta está «activa» si puede entrar: tiene rol, no es un registro sin confirmar y no tiene el acceso apagado. */
async function motivoInactivo(u: { id: number; rol: string | null; correo_verificado: boolean }): Promise<string | null> {
  if (!u.rol) return 'Esta cuenta no tiene un perfil asignado';
  if (!u.correo_verificado) return 'Esta cuenta aún no confirmó su correo';
  if (await accesoDesactivado(u.id, u.rol)) return 'Esta cuenta tiene el acceso desactivado';
  return null;
}

/** Abre la sesión prestada. Devuelve el token (sólo para la cookie), el CSRF y la entrada. */
export async function iniciarImpersonacion(args: { superadminId: number; real: SesionRealDelSuperadmin; usuarioId: number; motivo: string; ip: string | null; userAgent: string | undefined }) {
  const objetivo = await prisma.usuario.findUnique({
    where: { id: args.usuarioId },
    select: { id: true, nombre: true, email: true, rol: true, correo_verificado: true },
  });
  if (!objetivo) throw notFound('Usuario');
  if (objetivo.rol === 'superadmin') throw forbidden('No se puede entrar como otro superadmin');
  const inactivo = await motivoInactivo(objetivo);
  if (inactivo) throw invalid(`Datos inválidos: usuario_id: ${inactivo}`, { usuario_id: inactivo });

  const ahora = sesionDeps.ahora();
  // Nunca más larga que la sesión real del superadmin: al vencer ésta, la prestada ya no existe.
  const expira = new Date(Math.min(ahora.getTime() + DURACION_MS, args.real.expira_at.getTime()));
  if (expira.getTime() <= ahora.getTime()) throw new HttpError(401, SIN_SESION);

  const imp = await prisma.impersonacion.create({
    data: { superadmin_id: args.superadminId, usuario_id: objetivo.id, motivo: args.motivo, inicio_at: ahora, expira_at: expira, ip: args.ip, user_agent: args.userAgent?.slice(0, 300) ?? null, sesion_real_id: args.real.id },
  });
  const { token, csrf, id: sesionId } = await crearSesion(objetivo.id, args.ip, args.userAgent, { impersonador_id: args.superadminId, impersonacion_id: imp.id, expira_at: expira });
  await prisma.impersonacion.update({ where: { id: imp.id }, data: { sesion_prestada_id: sesionId } });
  // Empezar es usar la sesión real: no debe quedar «inactiva» mientras el superadmin trabaja con la prestada.
  await prisma.sesion.update({ where: { id: args.real.id }, data: { ultimo_uso_at: ahora } });
  await registrarAuditoria({
    usuario_id: args.superadminId, accion: 'impersonar_inicio', entidad: 'impersonacion',
    detalle: { impersonacion_id: imp.id, usuario_id: objetivo.id, motivo: args.motivo, expira_at: expira.toISOString() },
    ip: args.ip, impersonador_id: null, impersonacion_id: null,
  });
  return { token, csrf, expira_at: expira, impersonacion_id: imp.id, objetivoId: objetivo.id };
}

/** Revoca la sesión prestada (si sigue viva) y cierra la entrada. Idempotente. */
async function terminarPrestada(sesionPrestada: { id: string; impersonacion_id: string | null }, motivo: FinMotivo, ip: string | null = null) {
  const ahora = sesionDeps.ahora();
  await prisma.sesion.updateMany({ where: { id: sesionPrestada.id, revocada_at: null }, data: { revocada_at: ahora } });
  if (sesionPrestada.impersonacion_id) await cerrarImpersonacion(sesionPrestada.impersonacion_id, motivo, ahora, ip);
}

/**
 * Se llama en cada petición con una sesión prestada. Falso (y la sesión queda revocada y la entrada cerrada) si el objetivo pasó a ser superadmin,
 * si la entrada ya estaba cerrada, o si el superadmin dejó de serlo o su sesión real ya no está abierta.
 */
export async function validarSesionPrestada(sesion: Sesion, rolObjetivo: string | null): Promise<boolean> {
  const caer = async () => { await terminarPrestada(sesion, 'revocada'); return false; };
  if (rolObjetivo === 'superadmin') return caer();
  const imp = sesion.impersonacion_id ? await prisma.impersonacion.findUnique({ where: { id: sesion.impersonacion_id } }) : null;
  if (!imp || imp.fin_at || imp.superadmin_id !== sesion.impersonador_id) return caer();
  const sa = await prisma.usuario.findUnique({ where: { id: imp.superadmin_id! }, select: { rol: true } });
  if (sa?.rol !== 'superadmin') return caer();
  const real = imp.sesion_real_id ? await prisma.sesion.findUnique({ where: { id: imp.sesion_real_id } }) : null;
  const ahora = sesionDeps.ahora();
  if (!real || real.revocada_at || real.expira_at <= ahora || real.usuario_id !== imp.superadmin_id) return caer();
  return true;
}

export type ResultadoSalir =
  | { ok: true; token: string; csrf: string; expira_at: Date; superadminId: number }
  | { ok: false };

/**
 * «Volver a mi cuenta». La prestada se cierra SIEMPRE. La sesión real se restaura sólo si el token de la cookie `house_sesion_real` es el de la
 * sesión guardada en la entrada, sigue vigente y su dueño sigue siendo superadmin. No se alarga nada: la real conserva su `expira_at`.
 */
export async function salirDeImpersonacion(sesion: { id: string; impersonacion_id: string | null }, tokenReal: string | null, ip: string | null): Promise<ResultadoSalir> {
  const imp = sesion.impersonacion_id ? await prisma.impersonacion.findUnique({ where: { id: sesion.impersonacion_id } }) : null;
  await terminarPrestada(sesion, 'salir', ip);
  if (!imp || !imp.sesion_real_id || !tokenReal || imp.superadmin_id == null) return { ok: false };
  const real = await prisma.sesion.findFirst({ where: { id: imp.sesion_real_id, usuario_id: imp.superadmin_id, ...sesionActivaDonde(sesionDeps.ahora()) } });
  if (!real || !igualesEnTiempoConstante(real.token_hash, hashDeToken(tokenReal))) return { ok: false };
  const sa = await prisma.usuario.findUnique({ where: { id: imp.superadmin_id }, select: { rol: true } });
  if (sa?.rol !== 'superadmin') return { ok: false };
  return { ok: true, token: tokenReal, csrf: real.csrf_token, expira_at: real.expira_at, superadminId: imp.superadmin_id };
}

/** Lo que la pantalla lee al arrancar (`GET /api/auth/me`): quién entró, el motivo y cuándo termina. */
export async function estadoDeImpersonacion(sesion: { impersonacion_id: string | null; expira_at: Date }) {
  if (!sesion.impersonacion_id) return null;
  const imp = await prisma.impersonacion.findUnique({ where: { id: sesion.impersonacion_id }, include: { superadmin: { select: { id: true, nombre: true } } } });
  if (!imp) return null;
  return { por: { id: imp.superadmin?.id ?? 0, nombre: imp.superadmin?.nombre ?? 'Superadmin' }, motivo: imp.motivo, expira_at: sesion.expira_at.toISOString() };
}

/** Listado para Superadmin › Auditoría. Primero cierra las que se acabaron solas. */
export async function listarImpersonaciones(page: number, pageSize: number) {
  await cerrarTerminadas(sesionDeps.ahora(), INACTIVIDAD_MS);
  const [items, total] = await Promise.all([
    prisma.impersonacion.findMany({
      orderBy: { inicio_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      include: { superadmin: { select: { id: true, nombre: true, email: true } }, usuario: { select: { id: true, nombre: true, email: true, rol: true } } },
    }),
    prisma.impersonacion.count(),
  ]);
  return { items: items.map(({ sesion_real_id: _r, sesion_prestada_id: _p, user_agent: _u, ...i }) => i), total, page, pageSize };
}
