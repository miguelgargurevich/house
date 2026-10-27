import { HttpError } from '../../errors';
import type { AuthUser } from '../../middleware/auth';
import { aplicarAjustes, ajustesSchema } from '../../lib/parametrosChat';
import { prisma } from '../../db';
import { registrarAuditoria } from '../../middleware/audit';
import { MENSAJES_ERROR, ejecutarTurno, prepararTurno, type Preparado } from '../asistente/turno';
import { partirMensaje } from './evolution';
import { aTextoWhatsapp } from './formato';
import { MAX_IA_USUARIO, limites } from './limites';

export type OrigenCanal = 'whatsapp' | 'telegram';

export const MENSAJE_DEMASIADAS_CONSULTAS = 'Has hecho muchas consultas seguidas. Espera unos minutos y vuelve a escribirme.';
export const MENSAJE_SIN_RESPUESTA = 'No pude responderte ahora. Inténtalo de nuevo en unos minutos.';

export type RespuestaCanal = { ok: true; mensajes: string[] } | { ok: false; mensajes: string[] };

/**
 * Un turno del asistente para quien escribe por un canal. Mismo motor, mismos ajustes (los del rol: sólo admin/superadmin pueden elegir),
 * mismo tope de consultas (20 cada 15 min por persona) y mismas herramientas que el chat web: el alcance sale del `AuthUser` que armó el
 * servidor desde la base, nunca del texto. `vinculoId` reutiliza UNA conversación por vínculo (la retención de 90 días ya existente aplica).
 * El texto del usuario es dato no confiable: va como mensaje de usuario, jamás como instrucción de sistema.
 */
export async function conversarPorCanal(usuario: AuthUser, texto: string, origen: OrigenCanal, opts: { vinculoId?: number } = {}): Promise<RespuestaCanal> {
  const k = `u${usuario.id}`;
  if (limites.iaUsuario.golpear(k) > MAX_IA_USUARIO) return { ok: false, mensajes: [MENSAJE_DEMASIADAS_CONSULTAS] };
  const ajustes = aplicarAjustes(usuario.rol, ajustesSchema.parse({}));
  const vinculo = opts.vinculoId != null ? await prisma.canalVinculado.findUnique({ where: { id: opts.vinculoId }, select: { conversacion_id: true, usuario_id: true } }) : null;
  const previa = vinculo && vinculo.usuario_id === usuario.id ? vinculo.conversacion_id ?? undefined : undefined;
  let prep: Preparado;
  try {
    prep = await prepararTurno(usuario, texto, ajustes, { conversacionId: previa, ruta: undefined });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404 && previa) {
      // La conversación ya no existe (retención de 90 días o borrada desde la web): se abre otra.
      prep = await prepararTurno(usuario, texto, ajustes, { ruta: undefined });
    } else if (err instanceof HttpError) {
      return { ok: false, mensajes: [err.message] };
    } else {
      throw err;
    }
  }
  if (prep.conversacionId !== previa) {
    // Conversación nueva: se rotula con el canal (se ve en la lista del chat web de su dueño) y se guarda en el vínculo para reutilizarla.
    const rotulo = origen === 'whatsapp' ? 'WhatsApp' : 'Telegram';
    const c = await prisma.conversacionIA.findUnique({ where: { id: prep.conversacionId }, select: { titulo: true } });
    if (c) await prisma.conversacionIA.update({ where: { id: prep.conversacionId }, data: { titulo: `${rotulo} · ${c.titulo}`.slice(0, 80) }, select: { id: true } });
    if (opts.vinculoId != null) await prisma.canalVinculado.updateMany({ where: { id: opts.vinculoId, usuario_id: usuario.id }, data: { conversacion_id: prep.conversacionId } });
  }
  // Como en la web, el contenido de la conversación NO va a la auditoría (sólo lo ve su dueño); queda que hubo una consulta y por qué canal.
  void registrarAuditoria({ usuario_id: usuario.id, accion: 'consultar', entidad: 'asistente', detalle: { origen } });
  for await (const ev of ejecutarTurno(prep, { stream: false })) {
    if (ev.tipo === 'fin') return { ok: true, mensajes: partirMensaje(aTextoWhatsapp(ev.texto)) };
    if (ev.tipo === 'error') return { ok: false, mensajes: [MENSAJES_ERROR[ev.codigo].mensaje] };
  }
  return { ok: false, mensajes: [MENSAJE_SIN_RESPUESTA] };
}
