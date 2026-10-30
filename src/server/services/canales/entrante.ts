import { prisma } from '../../db';
import { esJunta } from '../../lib/junta';
import { registrarAuditoria } from '../../middleware/audit';
import { normalizarCelular } from '../avisos/celular';
import { canalesDeps, enmascarar } from './deps';
import { conversarPorCanal } from './conversar';
import { complejoDelAsistente } from '../comercial/consumo';
import { descargarMedio, responder } from './evolution';
import { comandoDe } from './formato';
import { cargarAuthUser, perteneceAEmpresa } from './identidad';
import { limites } from './limites';
import type { MedioEntrante, MensajeEntrante, Transporte } from './transporte';
import { manejarMedio, manejarRespuestaPendiente } from './voucher';
import { intentarVincular, leerCodigo, revocarVinculo, vinculoVigente, type CanalBot } from './vinculos';
import { MENSAJE_SIN_ASISTENTE, moduloActivoPara } from '../comercial/modulos';

export const MAX_TEXTO = 4000;

/** Textos del bot por canal (lo único que cambia es cómo se nombra al canal). */
export const mensajes = (canal: CanalBot) => {
  const quien = canal === 'telegram' ? 'Telegram' : 'WhatsApp';
  const identidad = canal === 'telegram' ? 'tu Telegram' : 'tu número';
  return {
    noVinculado: `Vincula ${identidad} desde Mi perfil en House`,
    vinculoFallido: `No pude vincular ${identidad} con ese código. Genera uno nuevo desde Mi perfil en House.`,
    vinculado: (nombre: string) => `¡Listo${nombre ? `, ${nombre.trim().split(/\s+/)[0]}` : ''}! Tu ${quien} quedó vinculado a House. Escríbeme tus consultas o envíame la foto de tu comprobante de pago.`,
    desvinculado: `Listo, desvinculé ${canal === 'telegram' ? 'tu Telegram' : 'tu número'}. Para volver a usarme, vincúlalo desde Mi perfil en House.`,
    muchos: 'Estás enviando muchos mensajes seguidos. Espera unos minutos y vuelve a escribirme.',
    largo: 'Tu mensaje es muy largo. Escríbelo más corto, por favor.',
    soloTexto: 'Por ahora sólo entiendo texto, imágenes y PDF de comprobantes.',
    sinAcceso: `No pude verificar tu acceso. Vincula ${identidad} otra vez desde Mi perfil en House.`,
  };
};
export const MSG = mensajes('whatsapp');

const menuDe = (canal: CanalBot, rol: string, junta: boolean): string => {
  const negrita = (t: string) => (canal === 'whatsapp' ? `*${t}*` : t);
  const base = [negrita('Menú'), '- Pregúntame por tus pagos, recibos o datos de tu cuenta.', `- Escribe ${negrita(canal === 'telegram' ? '/desvincular' : 'desvincular')} para quitar ${canal === 'telegram' ? 'este Telegram' : 'este número'} de House.`];
  if (rol === 'propietario' || rol === 'inquilino') base.splice(2, 0, '- Envíame la foto o el PDF de tu comprobante para registrar tu pago.');
  if (junta) base.splice(2, 0, '- Como junta, valida los pagos desde House › Pagos por validar.');
  return base.join('\n');
};

/** Un mensaje entrante ya interpretado (sin datos de Evolution que no usamos). */
export interface Entrante extends MensajeEntrante {
  /** Celular normalizado, E.164 sin «+» (`51987654321`). */
  numero: string;
}

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const cadena = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Dígitos de un JID de persona (`51987654321:12@s.whatsapp.net`), o null si no es una persona. Los JID traen el código de país sin «+»: se le pone para que un número de otro país no se lea como peruano. */
function numeroDeJid(jid: unknown): string | null {
  const j = cadena(jid);
  if (!j || !j.endsWith('@s.whatsapp.net')) return null;
  return normalizarCelular(`+${j.split('@')[0]!.split(':')[0]!}`);
}

/**
 * Interpreta el cuerpo del webhook de Evolution. Devuelve los mensajes a atender; `[]` = ignorar (otro evento, grupos, `fromMe`,
 * estados, difusiones, canales, números que no son celulares válidos, cuerpos raros). Nunca lanza.
 */
export function interpretarWebhook(body: unknown): Entrante[] {
  const b = objeto(body);
  if (!b) return [];
  const evento = cadena(b.event)?.toLowerCase().replace(/_/g, '.');
  if (evento !== 'messages.upsert') return [];
  const lote = Array.isArray(b.data) ? b.data : [b.data];
  const salida: Entrante[] = [];
  for (const crudo of lote.slice(0, 20)) {
    const d = objeto(crudo);
    const key = objeto(d?.key);
    if (!d || !key || key.fromMe === true) continue;
    const jid = cadena(key.remoteJid) ?? '';
    if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter') || jid.startsWith('status@')) continue;
    // Con direccionamiento por `@lid` el celular viene aparte (remoteJidAlt / senderPn); sin él no hay quién identificar.
    const numero = numeroDeJid(jid) ?? (jid.endsWith('@lid') ? numeroDeJid(key.remoteJidAlt) ?? numeroDeJid(key.senderPn) : null);
    const mensajeId = cadena(key.id);
    if (!numero || !mensajeId || mensajeId.length > 128) continue;
    let m = objeto(d.message) ?? {};
    for (const envoltorio of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) m = objeto(objeto(m[envoltorio])?.message) ?? m;
    const imagen = objeto(m.imageMessage);
    const documento = objeto(m.documentMessage);
    const texto = cadena(m.conversation) ?? cadena(objeto(m.extendedTextMessage)?.text) ?? cadena(imagen?.caption) ?? cadena(documento?.caption) ?? '';
    const fuente = imagen ?? documento;
    const medio: MedioEntrante | null = fuente
      ? { tipo: imagen ? 'imagen' : 'documento', mimetype: cadena(fuente.mimetype), nombre: cadena(fuente.fileName), tamano: Number.isFinite(Number(fuente.fileLength)) && Number(fuente.fileLength) > 0 ? Number(fuente.fileLength) : null }
      : null;
    const otro = !medio && !texto.trim();
    salida.push({ mensajeId, numero, texto, medio, otro });
  }
  return salida;
}

/** Marca el mensaje como visto: `true` la primera vez; `false` si Evolution lo reenvía (reintento): no se vuelve a procesar ni a responder. */
export async function reclamarMensaje(instancia: string, mensajeId: string): Promise<boolean> {
  const r = await prisma.mensajeCanal.createMany({ data: [{ instancia, mensaje_id: mensajeId }], skipDuplicates: true });
  return r.count === 1;
}

/**
 * Atiende un mensaje de CUALQUIER canal (la capa común: WhatsApp y Telegram entran por aquí con su `Transporte`). El identificador entrante NUNCA
 * basta: sólo un vínculo vigente y verificado da acceso, y el `AuthUser` se arma de nuevo desde la base en cada mensaje (si la persona perdió el rol
 * o la empresa, deja de responder datos). Todo texto (del usuario o del voucher) es dato no confiable. No se loguea el identificador ni el contenido.
 */
export async function atenderMensaje(t: Transporte, e: MensajeEntrante): Promise<void> {
  const MSGC = mensajes(t.canal);
  const decir = (texto: string, opts?: { complejoId?: number | null }) => t.responder(texto, opts).catch(() => undefined);

  // Límites por identificador y por empresa: pasado el tope se avisa UNA vez por ventana y se descarta el resto.
  // Con empresa conocida de antemano (WhatsApp) se mide aquí; en Telegram la empresa sale del vínculo y se mide al resolverlo.
  const nIdentificador = limites.mensajesNumero.golpear(`${t.canal === 'whatsapp' ? 'w' : 't'}:${t.identificador}`);
  const nEmpresa = t.empresaId != null ? limites.mensajesEmpresa.golpear(`e:${t.empresaId}`) : 0;
  if (nIdentificador > limites.mensajesNumero.tope || nEmpresa > limites.mensajesEmpresa.tope) {
    if (nIdentificador === limites.mensajesNumero.tope + 1) await decir(MSGC.muchos);
    return;
  }

  const vinculo = await vinculoVigente(t.canal, t.identificador);
  // Sin vínculo (o, en WhatsApp, de otra empresa): el único mensaje que sirve es un código de vinculación; todo lo demás, sin datos.
  if (!vinculo || (t.empresaId != null && vinculo.empresa_id !== t.empresaId)) {
    if (!e.medio && leerCodigo(e.texto)) {
      const r = await intentarVincular({ canal: t.canal, identificador: t.identificador, empresaId: t.empresaId, texto: e.texto });
      if (r.ok) {
        void registrarAuditoria({ usuario_id: r.usuarioId, accion: 'vincular', entidad: 'canal_vinculado', detalle: { canal: t.canal, origen: 'codigo' } });
        await decir(MSGC.vinculado(r.nombre));
      } else {
        await decir(MSGC.vinculoFallido);
      }
      return;
    }
    await decir(MSGC.noVinculado);
    return;
  }

  const empresaId = vinculo.empresa_id;
  if (t.empresaId == null && limites.mensajesEmpresa.golpear(`e:${empresaId}`) > limites.mensajesEmpresa.tope) return;

  const user = await cargarAuthUser(vinculo.usuario_id);
  if (!user || !(await perteneceAEmpresa(user, empresaId))) {
    await decir(MSGC.sinAcceso);
    return;
  }

  try {
    // El bot (chat y voucher por foto) es parte del módulo «Asistente con IA»: sin él sólo responde el aviso (y sigue valiendo desvincular y el menú).
    const sinAsistente = !(await moduloActivoPara(user, 'asistente'));
    if (e.medio) {
      if (sinAsistente) return void (await decir(MENSAJE_SIN_ASISTENTE));
      await decir(await manejarMedio({ transporte: t, vinculoId: vinculo.id, empresaId, user, medio: e.medio }));
      return;
    }
    if (e.otro) return void (await decir(MSGC.soloTexto));
    const texto = e.texto.trim();
    if (texto.length > MAX_TEXTO) return void (await decir(MSGC.largo));

    const cmd = e.esStart ? 'menu' : comandoDe(texto);
    if (cmd === 'desvincular') {
      await revocarVinculo({ id: vinculo.id });
      void registrarAuditoria({ usuario_id: user.id, accion: 'desvincular', entidad: 'canal_vinculado', entidad_id: vinculo.id, detalle: { canal: t.canal, origen: 'comando' } });
      return void (await decir(MSGC.desvinculado));
    }
    if (cmd === 'menu') return void (await decir(menuDe(t.canal, user.rol, esJunta(user))));

    if (sinAsistente) return void (await decir(MENSAJE_SIN_ASISTENTE));
    const respuestaVoucher = await manejarRespuestaPendiente({ canal: t.canal, vinculoId: vinculo.id, empresaId, user, texto });
    if (respuestaVoucher != null) return void (await decir(respuestaVoucher));

    const r = await conversarPorCanal(user, texto, t.canal, { vinculoId: vinculo.id });
    // Las respuestas del asistente cuentan contra el tope de WhatsApp de su condominio (el mismo que se cargó al preguntar).
    const condominio = await complejoDelAsistente(user).catch(() => null);
    for (const m of r.mensajes) await decir(m, { complejoId: condominio });
  } catch (err) {
    // Sin el identificador ni el contenido: sólo el tipo de error y el identificador enmascarado.
    console.error(`[canales] falló un mensaje de ${enmascarar(t.identificador)}:`, err instanceof Error ? err.name : 'error');
    await decir('Tuve un problema para responderte. Inténtalo de nuevo en unos minutos.');
  }
}

/** Atiende un mensaje de WhatsApp de una instancia: el transporte es Evolution (responder por `sendText`, medio por `getBase64FromMediaMessage`). */
export function procesarEntrante(instancia: string, empresaId: number, e: Entrante): Promise<void> {
  return atenderMensaje({
    canal: 'whatsapp',
    identificador: e.numero,
    empresaId,
    responder: async (texto, opts) => void (await responder(instancia, e.numero, texto, opts)),
    descargarMedio: async () => ({ base64: (await descargarMedio(instancia, e.mensajeId)).base64 }),
  }, e);
}

/** Mensajes ya procesados con más de 7 días y comprobantes pendientes vencidos. */
export async function limpiarCanales(ahora = canalesDeps.ahora()): Promise<{ mensajes: number; pendientes: number }> {
  const [m, p] = await Promise.all([
    prisma.mensajeCanal.deleteMany({ where: { created_at: { lt: new Date(ahora.getTime() - 7 * 86_400_000) } } }),
    prisma.canalPendiente.deleteMany({ where: { expira_at: { lt: ahora } } }),
  ]);
  return { mensajes: m.count, pendientes: p.count };
}
