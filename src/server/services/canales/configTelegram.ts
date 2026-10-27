// Configuración del bot de Telegram desde el Llavero (sólo superadmin): token cifrado en la base (AAD `telegram:bot`), `getMe`, y el webhook en Telegram
// (`setWebhook` al activar, `deleteWebhook` al pausar o quitar). Nada de variables de entorno: lo único que se necesita es `LLAVERO_ENC_KEY`, que ya existía.
import { prisma } from '../../db';
import { HttpError, conflict, invalid, notFound } from '../../errors';
import { llaveroConfigurado } from '../../lib/secretBox';
import { cargarConfig, cifrarToken, deleteWebhook, enSerie, getMe, registrarWebhookTelegram, tokenValido, TelegramFallo, urlWebhookTelegram } from './telegram';

export interface VistaTelegram {
  configurado: boolean;
  habilitado: boolean;
  bot_usuario: string | null;
  bot_nombre: string | null;
  /** Los 4 últimos caracteres del token (nunca el token entero). */
  ultimos4: string | null;
  /** Enlace del bot para abrirlo en Telegram. */
  enlace: string | null;
  webhook_url: string;
  webhook_registrado_at: string | null;
  llavero_configurado: boolean;
}

export async function verTelegram(): Promise<VistaTelegram> {
  const f = await prisma.configuracionTelegram.findUnique({ where: { id: 1 } });
  const configurado = !!f?.token_enc;
  return {
    configurado,
    habilitado: configurado && !!f?.habilitado,
    bot_usuario: configurado ? f?.bot_usuario ?? null : null,
    bot_nombre: configurado ? f?.bot_nombre ?? null : null,
    ultimos4: configurado ? f?.ultimos4 ?? null : null,
    enlace: configurado && f?.bot_usuario ? `https://t.me/${f.bot_usuario}` : null,
    webhook_url: urlWebhookTelegram(),
    webhook_registrado_at: f?.habilitado && f.webhook_registrado_at ? f.webhook_registrado_at.toISOString() : null,
    llavero_configurado: llaveroConfigurado(),
  };
}

/** Un fallo de Telegram (sin token ni respuesta del proveedor) → el error de House que se le muestra al superadmin. */
function errorTelegram(e: unknown, que: string): HttpError {
  if (e instanceof TelegramFallo) {
    if (e.causa === 'rechazado') return invalid('Telegram no aceptó ese token. Revísalo en @BotFather (/mybots › API Token).', { token: 'Telegram no aceptó ese token' });
    return new HttpError(502, `${que}: ${e.causa === 'timeout' || e.causa === 'sin_conexion' ? 'no hubo conexión con Telegram, inténtalo de nuevo' : 'Telegram respondió con un error'}`);
  }
  return new HttpError(502, que);
}

const requiereLlavero = () => {
  if (!llaveroConfigurado()) throw conflict('El Llavero no está configurado en el servidor');
};

/** Registra el webhook con un secreto nuevo y deja la fila habilitada. Si Telegram falla, la fila queda PAUSADA (el secreto viejo ya no sirve). */
async function activar(token: string, usuarioId: number): Promise<void> {
  try {
    const { secreto_hash, url } = await registrarWebhookTelegram(token);
    await prisma.configuracionTelegram.update({ where: { id: 1 }, data: { habilitado: true, secreto_hash, webhook_url: url, webhook_registrado_at: new Date(), actualizado_por_id: usuarioId } });
  } catch (e) {
    await prisma.configuracionTelegram.update({ where: { id: 1 }, data: { habilitado: false, secreto_hash: null, webhook_registrado_at: null, actualizado_por_id: usuarioId } });
    throw errorTelegram(e, 'No pude registrar el webhook en Telegram');
  }
}

/**
 * «Guardar y probar»: `getMe` valida el token y trae el @usuario; se guarda cifrado y (por omisión) se activa el bot con `setWebhook`.
 * Con un token inválido no se guarda nada. Si había otro bot, su webhook se borra.
 */
export function guardarTelegram(token: string, usuarioId: number, o: { activar?: boolean } = {}): Promise<VistaTelegram> {
  return enSerie(async () => {
    requiereLlavero();
    if (!tokenValido(token)) throw invalid('El token no tiene el formato de @BotFather (123456789:AA…)', { token: 'El token no tiene el formato de @BotFather' });
    let bot;
    try {
      bot = await getMe(token);
    } catch (e) {
      throw errorTelegram(e, 'No pude probar el token con Telegram');
    }
    const anterior = await cargarConfig();
    const datos = { token_enc: cifrarToken(token), ultimos4: token.slice(-4), bot_usuario: bot.usuario, bot_nombre: bot.nombre, habilitado: false, secreto_hash: null, webhook_registrado_at: null, actualizado_por_id: usuarioId };
    await prisma.configuracionTelegram.upsert({ where: { id: 1 }, create: { id: 1, ...datos }, update: datos });
    if (anterior && anterior.token !== token) await deleteWebhook(anterior.token).catch(() => undefined); // el bot anterior deja de mandarnos mensajes
    if (o.activar ?? true) await activar(token, usuarioId);
    return verTelegram();
  });
}

/** «Probar» el token ya guardado: vuelve a pedir `getMe` y refresca el @usuario. No toca el webhook. */
export function probarTelegram(usuarioId: number): Promise<VistaTelegram> {
  return enSerie(async () => {
    const cfg = await cargarConfig();
    if (!cfg) throw notFound('Bot de Telegram');
    try {
      const bot = await getMe(cfg.token);
      await prisma.configuracionTelegram.update({ where: { id: 1 }, data: { bot_usuario: bot.usuario, bot_nombre: bot.nombre, actualizado_por_id: usuarioId } });
    } catch (e) {
      throw errorTelegram(e, 'No pude probar el token con Telegram');
    }
    return verTelegram();
  });
}

/** Activar = `setWebhook` con secreto nuevo; pausar = `deleteWebhook` y se descarta el secreto (aunque Telegram no responda, el webhook ya responde 401). */
export function ajustarTelegram(habilitado: boolean, usuarioId: number): Promise<VistaTelegram> {
  return enSerie(async () => {
    const cfg = await cargarConfig();
    if (!cfg) throw notFound('Bot de Telegram');
    if (habilitado) {
      await activar(cfg.token, usuarioId);
    } else {
      await prisma.configuracionTelegram.update({ where: { id: 1 }, data: { habilitado: false, secreto_hash: null, webhook_registrado_at: null, actualizado_por_id: usuarioId } });
      await deleteWebhook(cfg.token).catch(() => undefined);
    }
    return verTelegram();
  });
}

/** Quitar: borra el webhook en Telegram (si se puede) y deja la fila vacía y pausada (sin token ni secreto). Los vínculos de las personas quedan, pero el bot no responde. */
export function quitarTelegram(usuarioId: number): Promise<{ bot_usuario: string | null }> {
  return enSerie(async () => {
    const f = await prisma.configuracionTelegram.findUnique({ where: { id: 1 } });
    if (!f?.token_enc) throw notFound('Bot de Telegram');
    const cfg = await cargarConfig();
    await prisma.configuracionTelegram.update({
      where: { id: 1 },
      data: { token_enc: null, ultimos4: null, bot_usuario: null, bot_nombre: null, habilitado: false, secreto_hash: null, webhook_url: null, webhook_registrado_at: null, actualizado_por_id: usuarioId },
    });
    if (cfg) await deleteWebhook(cfg.token).catch(() => undefined);
    return { bot_usuario: f.bot_usuario };
  });
}
