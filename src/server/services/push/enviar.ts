import { prisma } from '../../db';
import { MOTIVO_SIMULADO, type DepsAvisos, type ResultadoEnvio } from '../avisos/canales';
import { modoDemo } from '../demo/estado';
import type { TipoAviso } from '../avisos/plantillas';
import { configPush } from './config';
import { enviarFcm, type MensajePush, type ResultadoPush } from './fcm';
import { esSeguro, rutaPush } from './textos';
import { enviarWebPush } from './webpush';

export const MOTIVO_SIN_DISPOSITIVOS = 'Sin dispositivos';
export const MOTIVO_NO_CONFIGURADO = 'Canal no configurado';
export const MOTIVO_TEXTO_SENSIBLE = 'El texto trae datos sensibles';

/** Lo que `procesarCola` le pasa: la fila de `Notificacion` del canal `push` con su destinatario. `asunto`/`cuerpo` son el título y el texto corto del push. */
export interface AvisoPush {
  tipo: string;
  usuario_id: number;
  asunto: string;
  cuerpo: string;
  ref_entidad: string | null;
  usuario: { rol: string | null; eliminada_at?: Date | null };
}

/**
 * Envía el push de un aviso a TODOS los dispositivos de su destinatario (y sólo a los suyos: se filtra por `usuario_id`). Devuelve lo que `procesarCola` espera:
 *  - `ok`: salió a al menos un dispositivo;
 *  - `omitida`: no corresponde (demo, sin variables, sin dispositivos, cuenta eliminada, texto sensible);
 *  - `fallo`: ninguno salió y alguno falló por red/cuota/credenciales → se reintenta.
 * Los dispositivos que el proveedor dice que ya no existen se borran. El envío sale por `deps.fetch`: las pruebas nunca tocan la red.
 */
export async function enviarPushDeAviso(deps: DepsAvisos, n: AvisoPush): Promise<ResultadoEnvio> {
  if (await modoDemo()) return { resultado: 'omitida', motivo: MOTIVO_SIMULADO }; // el candado de demo: nunca se llega a la red
  if (n.usuario.eliminada_at) return { resultado: 'omitida', motivo: MOTIVO_SIN_DISPOSITIVOS };
  // Red de seguridad: el texto sale en la pantalla bloqueada. Quien lo armó (`textoPush`) ya evita montos y documentos; si un cambio futuro mete uno, no sale.
  if (!esSeguro(n.asunto) || !esSeguro(n.cuerpo)) {
    console.error(`[push] aviso ${n.tipo} no enviado: el texto trae datos sensibles`);
    return { resultado: 'omitida', motivo: MOTIVO_TEXTO_SENSIBLE };
  }
  const cfg = configPush(deps.env);
  if (!cfg.fcm && !cfg.web) return { resultado: 'omitida', motivo: MOTIVO_NO_CONFIGURADO };

  const dispositivos = await prisma.dispositivoPush.findMany({ where: { usuario_id: n.usuario_id }, orderBy: { id: 'asc' } });
  if (!dispositivos.length) return { resultado: 'omitida', motivo: MOTIVO_SIN_DISPOSITIVOS };

  const mensaje: MensajePush = { titulo: n.asunto, cuerpo: n.cuerpo, ruta: rutaPush(n.tipo as TipoAviso, n.usuario.rol, n.ref_entidad) };
  let enviados = 0;
  let intentados = 0;
  let ultimoFallo = '';
  const invalidos: number[] = [];
  for (const d of dispositivos) {
    let r: ResultadoPush;
    if (d.tipo === 'fcm' && cfg.fcm) r = await enviarFcm(deps, cfg.fcm, d.token, mensaje);
    else if (d.tipo === 'web' && cfg.web && d.p256dh && d.auth) r = await enviarWebPush(deps, cfg.web, { endpoint: d.token, p256dh: d.p256dh, auth: d.auth }, mensaje);
    else continue; // el canal de este dispositivo no está configurado en el servidor
    intentados++;
    if (r.resultado === 'enviado') enviados++;
    else if (r.resultado === 'token_invalido') invalidos.push(d.id);
    else ultimoFallo = r.motivo;
  }
  if (invalidos.length) await prisma.dispositivoPush.deleteMany({ where: { id: { in: invalidos }, usuario_id: n.usuario_id } });

  if (enviados > 0) return { resultado: 'ok' };
  if (!intentados) return { resultado: 'omitida', motivo: MOTIVO_NO_CONFIGURADO };
  if (ultimoFallo) return { resultado: 'fallo', motivo: ultimoFallo };
  return { resultado: 'omitida', motivo: MOTIVO_SIN_DISPOSITIVOS }; // todos eran inválidos y ya se borraron
}
