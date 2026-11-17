import { prisma } from '../../db';

/**
 * **Los dispositivos de cada persona que reciben avisos push.** Un token (FCM) o endpoint (navegador) pertenece a UN dispositivo, y un dispositivo a la
 * última sesión que entró: si el token ya era de otra persona (un teléfono prestado), pasa a la actual. Una persona puede tener varios (celular, tableta, navegador).
 * Toda consulta filtra por `usuario_id`: nadie ve ni borra los dispositivos de otro.
 */

/** Tope por persona. Pasado esto, se borran los menos usados: un usuario no puede acumular filas sin fin. */
export const MAX_DISPOSITIVOS = 10;

export type EntradaDispositivo =
  | { tipo: 'fcm'; token: string; plataforma: 'android' | 'ios' }
  | { tipo: 'web'; endpoint: string; p256dh: string; auth: string };

/** Alta o actualización POR TOKEN. Devuelve si el dispositivo estaba a nombre de otra persona (pasó a esta). */
export async function registrarDispositivo(usuarioId: number, e: EntradaDispositivo): Promise<{ reasignado: boolean }> {
  const token = e.tipo === 'fcm' ? e.token : e.endpoint;
  const datos = e.tipo === 'fcm'
    ? { tipo: 'fcm', plataforma: e.plataforma, p256dh: null, auth: null }
    : { tipo: 'web', plataforma: 'web', p256dh: e.p256dh, auth: e.auth };
  const previo = await prisma.dispositivoPush.findUnique({ where: { token }, select: { usuario_id: true } });
  const ahora = new Date();
  const fila = await prisma.dispositivoPush.upsert({
    where: { token },
    create: { usuario_id: usuarioId, token, ultimo_uso_at: ahora, ...datos },
    update: { usuario_id: usuarioId, ultimo_uso_at: ahora, ...datos },
    select: { id: true },
  });
  const mios = await prisma.dispositivoPush.findMany({ where: { usuario_id: usuarioId }, orderBy: [{ ultimo_uso_at: 'desc' }, { id: 'desc' }], select: { id: true } });
  const sobran = mios.filter((m) => m.id !== fila.id).slice(MAX_DISPOSITIVOS - 1).map((m) => m.id);
  if (sobran.length) await prisma.dispositivoPush.deleteMany({ where: { id: { in: sobran }, usuario_id: usuarioId } });
  return { reasignado: previo != null && previo.usuario_id !== usuarioId };
}

/** Baja por token (o endpoint). Sólo borra si es de ESTA persona; con uno ajeno o inexistente no hace nada, sin decir de quién es. */
export async function darDeBajaDispositivo(usuarioId: number, token: string): Promise<void> {
  await prisma.dispositivoPush.deleteMany({ where: { token, usuario_id: usuarioId } });
}

/** ¿Tiene la persona al menos un dispositivo para avisarle? Decide si un aviso agrega la fila del canal `push`. */
export async function tieneDispositivos(usuarioId: number): Promise<boolean> {
  return (await prisma.dispositivoPush.count({ where: { usuario_id: usuarioId } })) > 0;
}

/** Borra todos los dispositivos de una persona (al eliminar su cuenta). */
export async function borrarDispositivosDe(usuarioId: number, db: Pick<typeof prisma, 'dispositivoPush'> = prisma): Promise<number> {
  return (await db.dispositivoPush.deleteMany({ where: { usuario_id: usuarioId } })).count;
}
