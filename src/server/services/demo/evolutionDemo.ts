// El «WhatsApp» de la demo: respuestas de ejemplo en lugar de la Evolution API. Nada sale de la máquina: la pantalla de WhatsApp muestra un número de
// ejemplo ya conectado (900 000 001) y los grupos de ejemplo que sembró el seed; los mensajes a grupos «se envían» sin llamar a ninguna red.
import { prisma } from '../../db';

/** El número de ejemplo de la instancia de demo (rango 900… de pruebas: no existe). */
export const NUMERO_WHATSAPP_DEMO = '51900000001';
export const INSTANCIA_DEMO = 'demo-torre';

/** Lo que devolvería Evolution para cada endpoint que usa Torre; `undefined` = ese endpoint no existe en la demo. */
export async function respuestaEvolutionDemo(endpoint: string, metodo: string): Promise<unknown> {
  const ruta = endpoint.split('?')[0]!;
  if (ruta.startsWith('/webhook/set/')) return {};
  if (ruta.startsWith('/instance/connectionState/')) return { instance: { state: 'open' } };
  if (ruta.startsWith('/instance/connect/')) return { status: 'open', base64: null };
  if (ruta.startsWith('/instance/fetchInstances')) return [{ instance: { ownerJid: `${NUMERO_WHATSAPP_DEMO}@s.whatsapp.net`, instanceName: INSTANCIA_DEMO, status: 'open' } }];
  if (ruta.startsWith('/group/fetchAllGroups/')) {
    const instancia = decodeURIComponent(ruta.slice('/group/fetchAllGroups/'.length));
    const grupos = await prisma.grupoWhatsapp.findMany({ where: { empresa: { whatsapp_instance: instancia } }, select: { jid: true, nombre: true, miembros: true } });
    return grupos.map((g) => ({ id: g.jid, subject: g.nombre, size: g.miembros ?? 20 }));
  }
  if (ruta.startsWith('/group/findGroupInfos/')) return { participants: [{ id: `${NUMERO_WHATSAPP_DEMO}@s.whatsapp.net` }] };
  if (ruta.startsWith('/message/sendText/') && metodo === 'POST') return { key: { id: 'DEMO' }, status: 'simulado' };
  return undefined;
}
