import { prisma } from '../../db';
import { esJunta } from '../../lib/junta';
import { registrarAuditoria } from '../../middleware/audit';
import { normalizarCelular } from '../avisos/celular';
import { canalesDeps, enmascarar } from './deps';
import { conversarPorCanal } from './conversar';
import { responder } from './evolution';
import { comandoDe } from './formato';
import { cargarAuthUser, perteneceAEmpresa } from './identidad';
import { limites } from './limites';
import { manejarMedio, manejarRespuestaPendiente, type MedioEntrante } from './voucher';
import { intentarVincular, leerCodigo, revocarVinculo, vinculoVigente } from './vinculos';

export const MAX_TEXTO = 4000;

export const MSG = {
  noVinculado: 'Vincula tu número desde Mi perfil en House',
  vinculoFallido: 'No pude vincular tu número con ese código. Genera uno nuevo desde Mi perfil en House.',
  vinculado: (nombre: string) => `¡Listo${nombre ? `, ${nombre.trim().split(/\s+/)[0]}` : ''}! Tu WhatsApp quedó vinculado a House. Escríbeme tus consultas o envíame la foto de tu comprobante de pago.`,
  desvinculado: 'Listo, desvinculé tu número. Para volver a usarme, vincúlalo desde Mi perfil en House.',
  muchos: 'Estás enviando muchos mensajes seguidos. Espera unos minutos y vuelve a escribirme.',
  largo: 'Tu mensaje es muy largo. Escríbelo más corto, por favor.',
  soloTexto: 'Por ahora sólo entiendo texto, imágenes y PDF de comprobantes.',
  sinAcceso: 'No pude verificar tu acceso. Vincula tu número otra vez desde Mi perfil en House.',
};

const menuDe = (rol: string, junta: boolean): string => {
  const base = ['*Menú*', '- Pregúntame por tus pagos, recibos o datos de tu cuenta.', '- Escribe *desvincular* para quitar este número de House.'];
  if (rol === 'propietario' || rol === 'inquilino') base.splice(2, 0, '- Envíame la foto o el PDF de tu comprobante para registrar tu pago.');
  if (junta) base.splice(2, 0, '- Como junta, valida los pagos desde House › Pagos por validar.');
  return base.join('\n');
};

/** Un mensaje entrante ya interpretado (sin datos de Evolution que no usamos). */
export interface Entrante {
  mensajeId: string;
  /** Celular peruano normalizado (`51987654321`). */
  numero: string;
  texto: string;
  medio: MedioEntrante | null;
  /** Audio, video, sticker, ubicación… algo que no sabemos leer. */
  otro: boolean;
}

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const cadena = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Dígitos de un JID de persona (`51987654321:12@s.whatsapp.net`), o null si no es una persona. */
function numeroDeJid(jid: unknown): string | null {
  const j = cadena(jid);
  if (!j || !j.endsWith('@s.whatsapp.net')) return null;
  return normalizarCelular(j.split('@')[0]!.split(':')[0]!);
}

/**
 * Interpreta el cuerpo del webhook de Evolution. Devuelve los mensajes a atender; `[]` = ignorar (otro evento, grupos, `fromMe`,
 * estados, difusiones, canales, números que no son celulares peruanos, cuerpos raros). Nunca lanza.
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
 * Atiende un mensaje de WhatsApp de una instancia. El número entrante NUNCA basta: sólo un vínculo vigente y verificado de ESA empresa
 * da acceso, y el `AuthUser` se arma de nuevo desde la base en cada mensaje (si la persona perdió el rol o la empresa, deja de responder datos).
 * Todo texto (del usuario o del voucher) es dato no confiable. No se loguea el número ni el contenido.
 */
export async function procesarEntrante(instancia: string, empresaId: number, e: Entrante): Promise<void> {
  const decir = (texto: string) => responder(instancia, e.numero, texto).catch(() => undefined);

  // Límites por número y por empresa: pasado el tope se avisa UNA vez por ventana y se descarta el resto.
  const nNumero = limites.mensajesNumero.golpear(`w:${e.numero}`);
  const nEmpresa = limites.mensajesEmpresa.golpear(`e:${empresaId}`);
  if (nNumero > limites.mensajesNumero.tope || nEmpresa > limites.mensajesEmpresa.tope) {
    if (nNumero === limites.mensajesNumero.tope + 1) await decir(MSG.muchos);
    return;
  }

  const vinculo = await vinculoVigente('whatsapp', e.numero);
  // Sin vínculo (o de otra empresa): el único mensaje que sirve es un código de vinculación; todo lo demás, sin datos.
  if (!vinculo || vinculo.empresa_id !== empresaId) {
    if (!e.medio && leerCodigo(e.texto)) {
      const r = await intentarVincular({ canal: 'whatsapp', identificador: e.numero, empresaId, texto: e.texto });
      if (r.ok) {
        void registrarAuditoria({ usuario_id: r.usuarioId, accion: 'vincular', entidad: 'canal_vinculado', detalle: { canal: 'whatsapp', origen: 'codigo' } });
        await decir(MSG.vinculado(r.nombre));
      } else {
        await decir(MSG.vinculoFallido);
      }
      return;
    }
    await decir(MSG.noVinculado);
    return;
  }

  const user = await cargarAuthUser(vinculo.usuario_id);
  if (!user || !(await perteneceAEmpresa(user, empresaId))) {
    await decir(MSG.sinAcceso);
    return;
  }

  try {
    if (e.medio) {
      await decir(await manejarMedio({ instancia, mensajeId: e.mensajeId, vinculoId: vinculo.id, empresaId, user, medio: e.medio }));
      return;
    }
    if (e.otro) return void (await decir(MSG.soloTexto));
    const texto = e.texto.trim();
    if (texto.length > MAX_TEXTO) return void (await decir(MSG.largo));

    const cmd = comandoDe(texto);
    if (cmd === 'desvincular') {
      await revocarVinculo({ id: vinculo.id });
      void registrarAuditoria({ usuario_id: user.id, accion: 'desvincular', entidad: 'canal_vinculado', entidad_id: vinculo.id, detalle: { canal: 'whatsapp', origen: 'comando' } });
      return void (await decir(MSG.desvinculado));
    }
    if (cmd === 'menu') return void (await decir(menuDe(user.rol, esJunta(user))));

    const respuestaVoucher = await manejarRespuestaPendiente({ vinculoId: vinculo.id, empresaId, user, texto });
    if (respuestaVoucher != null) return void (await decir(respuestaVoucher));

    const r = await conversarPorCanal(user, texto, 'whatsapp', { vinculoId: vinculo.id });
    for (const m of r.mensajes) await decir(m);
  } catch (err) {
    // Sin el número ni el contenido: sólo el tipo de error y el número enmascarado.
    console.error(`[canales] falló un mensaje de ${enmascarar(e.numero)}:`, err instanceof Error ? err.name : 'error');
    await decir('Tuve un problema para responderte. Inténtalo de nuevo en unos minutos.');
  }
}

/** Mensajes ya procesados con más de 7 días y comprobantes pendientes vencidos. */
export async function limpiarCanales(ahora = canalesDeps.ahora()): Promise<{ mensajes: number; pendientes: number }> {
  const [m, p] = await Promise.all([
    prisma.mensajeCanal.deleteMany({ where: { created_at: { lt: new Date(ahora.getTime() - 7 * 86_400_000) } } }),
    prisma.canalPendiente.deleteMany({ where: { expira_at: { lt: ahora } } }),
  ]);
  return { mensajes: m.count, pendientes: p.count };
}
