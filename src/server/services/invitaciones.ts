// Invitación de un usuario dado de alta SIN contraseña: enlace de un solo uso (sólo se guarda su sha256, vence a los 7 días) que le deja crear la suya.
// Mismo patrón que la verificación del correo del registro público (`services/comercial/registro.ts`). El envío y el reloj se inyectan como allá:
// `comercialCorreo.deps` (correo) y `comercialDeps.ahora` (reloj).
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { BCRYPT_COST } from '../config';
import { prisma } from '../db';
import { HttpError, invalid } from '../errors';
import { contrasenaIgualACorreo, MENSAJE_PASSWORD_CORREO } from '../validation';
import { plantillaCorreo } from './avisos/correoHtml';
import { comercialDeps } from './comercial/modulos';
import { correoA, enlace, enmascarar, obtenerConfiguracion } from './comercial/configuracion';

export const DIAS_INVITACION = 7;
/** Entre una invitación y la siguiente al mismo usuario: frena el reenvío en ráfaga (llenaría el buzón de alguien). */
export const ESPERA_REENVIO_MS = 60_000;
export const MENSAJE_INVITACION_INVALIDA = 'El enlace no es válido o ya venció. Pide a tu administración que te reenvíe la invitación.';

/** Cómo se nombra el rol dentro de una frase («te dio acceso como …»). */
const ROL_EN_FRASE: Record<string, string> = {
  superadmin: 'superadministrador',
  admin: 'administrador',
  propietario: 'propietario',
  inquilino: 'inquilino',
  mantenimiento: 'personal de mantenimiento',
  seguridad: 'personal de seguridad',
  limpieza: 'personal de limpieza',
  jardineria: 'personal de jardinería',
};
export const rolEnFrase = (rol: string | null): string => (rol ? ROL_EN_FRASE[rol] ?? rol : 'usuario');

/** Los residentes importados no tienen buzón (`…@sin-correo.invalid`; `.invalid` está reservado y nunca existe): a esos no se les manda nada. */
export const correoSinBuzon = (email: string): boolean => /\.invalid$/i.test(email.trim());

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const nuevoToken = () => randomBytes(32).toString('base64url');

export type EstadoInvitacion =
  | { estado: 'enviada' }
  /** El correo es de los que no tienen buzón: no se mandó ni se creó enlace. */
  | { estado: 'sin_correo' }
  /** El canal de correo no está configurado o falló: no queda ningún enlace nuevo, se puede reintentar. */
  | { estado: 'no_enviada'; motivo: string };

/**
 * Crea la invitación y la manda. El usuario debe seguir SIN contraseña. Un enlace anterior sigue valiendo hasta que el nuevo salga bien:
 * si el envío falla, el nuevo se descarta y el que ya tenía no se pierde.
 */
export async function invitarUsuario(usuarioId: number, porUsuarioId: number | null): Promise<EstadoInvitacion> {
  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true, nombre: true, email: true, rol: true, password_hash: true, empresa: { select: { nombre: true } }, complejo: { select: { nombre: true } } },
  });
  if (!u || u.password_hash != null) throw new HttpError(409, 'Esta persona ya tiene contraseña');
  if (correoSinBuzon(u.email)) return { estado: 'sin_correo' };

  const ahora = comercialDeps.ahora();
  const reciente = await prisma.tokenInvitacion.findFirst({ where: { usuario_id: u.id, created_at: { gt: new Date(ahora.getTime() - ESPERA_REENVIO_MS) } }, select: { id: true } });
  if (reciente) throw new HttpError(429, 'Ya le enviamos una invitación hace un momento. Espera un minuto antes de reenviarla.');

  const por = porUsuarioId != null ? await prisma.usuario.findUnique({ where: { id: porUsuarioId }, select: { nombre: true } }) : null;
  const token = nuevoToken();
  const fila = await prisma.tokenInvitacion.create({
    data: { usuario_id: u.id, token_hash: hashToken(token), expira_at: new Date(ahora.getTime() + DIAS_INVITACION * 86_400_000), creado_por_id: porUsuarioId },
    select: { id: true },
  });

  const cfg = await obtenerConfiguracion();
  const link = enlace(cfg, `/invitacion?token=${encodeURIComponent(token)}`);
  const donde = u.complejo?.nombre ?? u.empresa?.nombre;
  const quien = por?.nombre ?? 'Tu administración';
  const intro = `${quien} te dio acceso a Torre como ${rolEnFrase(u.rol)}${donde ? ` de ${donde}` : ''}. Crea tu contraseña para entrar.`;
  const { html, texto } = plantillaCorreo({
    titulo: 'Te invitaron a Torre',
    parrafos: [`Hola ${u.nombre}:`, intro, `El enlace sirve una sola vez y vence en ${DIAS_INVITACION} días.`],
    boton: { texto: 'Crear mi contraseña', url: link },
    pie: 'Si no esperabas este correo, ignóralo: no pasa nada y nadie entra a tu cuenta sin crear una contraseña.',
  });
  const r = await correoA(u.email, 'Te invitaron a Torre', texto, undefined, html).catch(() => ({ resultado: 'fallo' as const, motivo: 'No se pudo enviar el correo' }));
  if (r.resultado !== 'ok') {
    await prisma.tokenInvitacion.deleteMany({ where: { id: fila.id } });
    return { estado: 'no_enviada', motivo: r.motivo };
  }
  // Salió bien: los enlaces anteriores (sin usar) dejan de servir.
  await prisma.tokenInvitacion.updateMany({ where: { usuario_id: u.id, id: { not: fila.id }, usado_at: null, expira_at: { gt: ahora } }, data: { expira_at: ahora } });
  return { estado: 'enviada' };
}

export interface InvitacionVigente { id: number; usuario_id: number; usuario: { nombre: string; email: string; rol: string | null; empresa: { nombre: string } | null; complejo: { nombre: string } | null } }

/** La invitación del enlace si sigue vigente (no usada, no vencida, y el usuario sigue SIN contraseña: un enlace viejo nunca pisa una contraseña ya creada). */
export async function buscarInvitacionVigente(token: string): Promise<InvitacionVigente | null> {
  const f = await prisma.tokenInvitacion.findUnique({
    where: { token_hash: hashToken(token) },
    select: { id: true, usuario_id: true, expira_at: true, usado_at: true, usuario: { select: { nombre: true, email: true, rol: true, password_hash: true, empresa: { select: { nombre: true } }, complejo: { select: { nombre: true } } } } },
  });
  if (!f || f.usado_at || f.expira_at <= comercialDeps.ahora() || f.usuario.password_hash != null || !f.usuario.rol) return null;
  const { nombre, email, rol, empresa, complejo } = f.usuario;
  return { id: f.id, usuario_id: f.usuario_id, usuario: { nombre, email, rol, empresa, complejo } };
}

const invalida = () => new HttpError(410, MENSAJE_INVITACION_INVALIDA, undefined, 'INVITACION_INVALIDA');

/** Lo que la pantalla muestra antes de pedir la contraseña. Cualquier fallo → el mismo 410 (no revela si el usuario existe). */
export async function datosDeInvitacion(token: string) {
  const v = await buscarInvitacionVigente(token);
  if (!v) throw invalida();
  const { usuario } = v;
  return { nombre: usuario.nombre, email: enmascarar(usuario.email), rol: usuario.rol!, rol_texto: rolEnFrase(usuario.rol), organizacion: usuario.complejo?.nombre ?? usuario.empresa?.nombre ?? null };
}

/**
 * Fija la contraseña con el enlace. Un solo uso y atómico: el token se gasta en la misma transacción que guarda el hash, y sólo si el usuario
 * sigue sin contraseña. Devuelve el usuario para iniciar sesión.
 */
export async function aceptarInvitacion(token: string, password: string) {
  const v = await buscarInvitacionVigente(token);
  if (!v) throw invalida();
  if (contrasenaIgualACorreo(password, v.usuario.email)) throw invalid(`Datos inválidos: password: ${MENSAJE_PASSWORD_CORREO}`, { password: MENSAJE_PASSWORD_CORREO });
  const password_hash = await bcrypt.hash(password, BCRYPT_COST);
  const ahora = comercialDeps.ahora();
  const ok = await prisma.$transaction(async (tx) => {
    const gastado = await tx.tokenInvitacion.updateMany({ where: { id: v.id, usado_at: null, expira_at: { gt: ahora } }, data: { usado_at: ahora } });
    if (gastado.count !== 1) return false; // otro clic lo usó primero
    const fijada = await tx.usuario.updateMany({ where: { id: v.usuario_id, password_hash: null }, data: { password_hash, correo_verificado: true } });
    if (fijada.count !== 1) throw new HttpError(410, MENSAJE_INVITACION_INVALIDA, undefined, 'INVITACION_INVALIDA'); // deshace también el gasto del token
    await tx.tokenInvitacion.updateMany({ where: { usuario_id: v.usuario_id, id: { not: v.id }, usado_at: null, expira_at: { gt: ahora } }, data: { expira_at: ahora } });
    return true;
  });
  if (!ok) throw invalida();
  return prisma.usuario.findUniqueOrThrow({ where: { id: v.usuario_id }, select: { id: true, nombre: true, email: true, rol: true, empresa_id: true, complejo_id: true, cargo_junta: true, estructura_id: true } });
}
