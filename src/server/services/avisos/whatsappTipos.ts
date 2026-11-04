// Qué avisos automáticos puede mandar un condominio también por WhatsApp (`ComplejoHabitacional.whatsapp_avisos`).
// Archivo sin imports a propósito: lo usan el servidor (cola de avisos, API) y la ficha del condominio en el navegador.

/** Tipos que la administración puede activar o apagar para WhatsApp. El resto (IA, comunicados) no se rige por la lista, y los resultados de pago nunca salen por WhatsApp. */
export const TIPOS_WHATSAPP_CONFIGURABLES = ['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'cierre_pendiente'] as const;
export type TipoWhatsapp = (typeof TIPOS_WHATSAPP_CONFIGURABLES)[number];

/** Lo que sale por WhatsApp si el condominio no cambió nada: el recibo, el aviso del día y el vencido, y el cierre pendiente. «Por vencer» (2 días antes) queda apagado: gasta mensajes. */
export const WHATSAPP_POR_DEFECTO: TipoWhatsapp[] = ['recibo_emitido', 'vence_hoy', 'vencido', 'cierre_pendiente'];

/** Nombre que ve la administración en la ficha del condominio. */
export const ROTULO_WHATSAPP: Record<TipoWhatsapp, string> = {
  recibo_emitido: 'Recibo del mes',
  por_vencer: 'Recordatorio 2 días antes',
  vence_hoy: 'Vence hoy',
  vencido: 'Venció',
  cierre_pendiente: 'Cierre del mes pendiente (al tesorero)',
};

/** ¿Es un tipo que la lista del condominio controla? Los demás (IA, comunicados) siempre pasan. */
export function esTipoWhatsappConfigurable(tipo: string): tipo is TipoWhatsapp {
  return (TIPOS_WHATSAPP_CONFIGURABLES as readonly string[]).includes(tipo);
}
