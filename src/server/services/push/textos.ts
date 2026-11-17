import { cuando, fechaLarga, rutaDeAviso, type DatosAviso, type TipoAviso } from '../avisos/plantillas';

/**
 * **Lo que un aviso push puede y no puede decir.** El texto sale en la pantalla bloqueada del teléfono (y en el centro de notificaciones del navegador):
 * qué pasó y cuándo, nada más. NUNCA un monto, un documento de identidad, un motivo de rechazo ni el nombre de un vecino. El correo y el WhatsApp sí
 * llevan el detalle; el push sólo invita a abrir Torre.
 */

export const LARGO_MAXIMO_TITULO = 60;
export const LARGO_MAXIMO_CUERPO = 140;

/** Tipos de aviso que valen un push. `pago_validado` no está: ningún canal lo manda (la persona ya lo ve al subir su voucher). `ia_restablecida` tampoco: no pide acción. */
export const TIPOS_CON_PUSH: ReadonlySet<TipoAviso> = new Set<TipoAviso>([
  'recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'recordatorio_deuda', 'recibo_anulado',
  'pago_rechazado', 'pago_anulado', 'comunicado', 'cierre_pendiente', 'ia_caida',
]);

// Ocho dígitos seguidos o más (DNI, RUC, teléfono), cifras con separador de miles o decimales de dinero, y marcas de moneda.
const DATO_SENSIBLE = /\d{8,}|\d[\d .]*\d{3}[.,]\d{2}\b|\b\d{1,3}([.,]\d{3})+\b|\bS\/|US\$|\$|\b(soles|dólares|dolares|usd)\b/i;

/** ¿El texto está libre de un documento de identidad o un monto? */
export const esSeguro = (texto: string | null | undefined): boolean => !texto || !DATO_SENSIBLE.test(texto);

/** Recorta con «…» un texto largo para la pantalla de bloqueo. */
export const recortar = (texto: string, largo: number): string => (texto.length <= largo ? texto : `${texto.slice(0, largo - 1).trimEnd()}…`);

export interface TextoPush { titulo: string; cuerpo: string }

/**
 * Título y cuerpo del push de un aviso, o `null` si el tipo no se empuja o el texto no pasa la red de seguridad (`esSeguro`).
 * Sólo usa el periodo, el vencimiento (como fecha), el título del comunicado y el block: datos que no son sensibles.
 */
export function textoPush(tipo: TipoAviso, d: DatosAviso): TextoPush | null {
  if (!TIPOS_CON_PUSH.has(tipo)) return null;
  const periodo = d.periodo;
  const vence = d.vence ? fechaLarga(d.vence) : d.vencimiento;
  let t: TextoPush;
  switch (tipo) {
    case 'recibo_emitido':
      t = { titulo: `Tu recibo de ${periodo} ya está`, cuerpo: `Vence el ${vence}. Revísalo y págalo en Torre.` };
      break;
    case 'por_vencer':
      t = { titulo: `Tu recibo vence ${cuando(d.dias)}`, cuerpo: `Recibo de ${periodo}. Paga y sube tu voucher a tiempo.` };
      break;
    case 'vence_hoy':
      t = { titulo: 'Tu recibo vence hoy', cuerpo: `Recibo de ${periodo}. Paga y sube tu voucher hoy.` };
      break;
    case 'vencido':
      t = { titulo: 'Tu recibo está vencido', cuerpo: `Recibo de ${periodo}. Regulariza tu pago para evitar recargos.` };
      break;
    case 'recordatorio_deuda':
      t = { titulo: 'Tienes pagos pendientes', cuerpo: 'Paga y sube tu voucher en Torre. Si ya pagaste, avísanos.' };
      break;
    case 'recibo_anulado':
      t = { titulo: `Se anuló tu recibo de ${periodo}`, cuerpo: 'Te llegará el correcto. Si ya lo viste, ignóralo.' };
      break;
    case 'pago_rechazado':
      t = { titulo: 'No pudimos validar tu pago', cuerpo: `Pago de ${periodo}. Revisa el motivo y vuelve a enviar tu comprobante.` };
      break;
    case 'pago_anulado':
      t = { titulo: 'Anularon tu pago', cuerpo: `Pago de ${periodo}. Tu recibo volvió a quedar pendiente.` };
      break;
    case 'comunicado': {
      const titulo = d.titulo?.trim() ?? '';
      // El título lo escribe la administración: si trae un monto o un documento, el push dice sólo que hay un comunicado.
      t = titulo && esSeguro(titulo)
        ? { titulo: 'Nuevo comunicado', cuerpo: recortar(titulo, LARGO_MAXIMO_CUERPO) }
        : { titulo: 'Nuevo comunicado', cuerpo: 'Tu administración publicó un comunicado. Ábrelo en Torre.' };
      break;
    }
    case 'cierre_pendiente':
      t = d.central
        ? { titulo: `Faltan aportes a la Junta central de ${periodo}`, cuerpo: 'Revisa qué blocks aún no aportan.' }
        : { titulo: `Faltan pagos en el cierre de ${periodo}`, cuerpo: `${d.bloque ? `${d.bloque}: registra` : 'Registra'} los pagos que faltan, cada uno con su voucher.` };
      break;
    case 'ia_caida':
      t = { titulo: 'El asistente de IA se quedó sin proveedores', cuerpo: 'Revisa el Llavero de IA.' };
      break;
    default:
      return null;
  }
  const out = { titulo: recortar(t.titulo, LARGO_MAXIMO_TITULO), cuerpo: recortar(t.cuerpo, LARGO_MAXIMO_CUERPO) };
  return esSeguro(out.titulo) && esSeguro(out.cuerpo) ? out : null;
}

/** La ruta interna que se abre al tocar el aviso: la misma del correo, según el rol; si no hay una para ese rol, el inicio. */
export function rutaPush(tipo: TipoAviso, rol: string | null | undefined, refEntidad: string | null | undefined): string {
  return rutaDeAviso(tipo, rol, refEntidad?.startsWith('cierre-central:')) || '/';
}
