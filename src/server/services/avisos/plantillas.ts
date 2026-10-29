import { formatoDinero } from '../../../lib/paises';
import { periodoTexto } from '../../lib/periodo';
import { hoyEn } from '../../lib/fechas';

export const TIPOS = ['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'pago_validado', 'pago_rechazado', 'ia_caida', 'ia_restablecida', 'comunicado'] as const;
export type TipoAviso = (typeof TIPOS)[number];

export const ENLACE_APP = 'https://house.gargurevich.dev';

export interface DatosAviso {
  nombre: string;
  /** Mes y año del recibo, p. ej. `octubre de 2026`. */
  periodo: string;
  /** Concepto o conceptos del cargo (puede ir vacío). */
  concepto?: string;
  /** Monto ya formateado con la moneda del condominio, p. ej. `S/ 350.00` o `US$ 350.00`. */
  monto: string;
  /** Vencimiento `dd/mm/aaaa`. */
  vencimiento: string;
  /** Días que faltan para vencer (negativo si ya venció). Sólo para `por_vencer`. */
  dias?: number;
  /** Mora (ya formateada, p. ej. `S/ 20` o `US$ 20`) que se agrega al recibo del mes siguiente si no se paga a tiempo. Sin ella, el recordatorio no la menciona. */
  mora?: string;
  /** Motivo del rechazo (`pago_rechazado`) o detalle del estado de la IA (`ia_caida`, `ia_restablecida`). */
  motivo?: string;
  /** Condominio del recibo: firma el mensaje. */
  condominio?: string | null;
  /** Sólo `comunicado`: el título (es el asunto) y el texto plano que escribió la administración o la junta. */
  titulo?: string;
  texto?: string;
  /** Departamentos a los que se refiere (con su torre): cada torre tiene su propio recibo y el vecino puede tener unidades en más de una. */
  departamentos?: { codigo: string; torre: string | null; monto?: string }[];
}

export { periodoTexto };

/** Monto con el símbolo, los decimales y los separadores de la moneda del condominio (`S/ 1,234.50`, `US$ 20.00`, `$ 15.000`). Sin moneda, soles. */
export function dineroTexto(valor: { toFixed(d: number): string } | number | string, moneda?: string | null): string {
  return formatoDinero(valor, moneda);
}

/** `Date` (00:00 UTC, como se guardan los vencimientos) → `dd/mm/aaaa`. */
export function fechaTexto(f: Date): string {
  const dd = String(f.getUTCDate()).padStart(2, '0');
  const mm = String(f.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${f.getUTCFullYear()}`;
}

/** Instante → `dd/mm/aaaa` según el día en la zona del condominio (un pago a las 21:00 en Lima ya es el día siguiente en UTC). */
export function fechaTextoEn(f: Date, zona: string): string {
  return fechaTexto(hoyEn(zona, f));
}

const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || 'vecino';
const firma = (d: DatosAviso) => `— Administración${d.condominio ? ` de ${d.condominio}` : ' de tu condominio'}`;
const cierre = (d: DatosAviso) => `Entra a ${ENLACE_APP}.\n\n${firma(d)}`;

/** «Departamento: B01-804 (Block 1).» o, con varios, uno por línea con su monto: nunca se fusionan unidades de torres distintas sin decirlo. */
function departamentos(d: DatosAviso): string {
  const ds = d.departamentos ?? [];
  const uno = (x: { codigo: string; torre: string | null }) => `${x.codigo}${x.torre ? ` (${x.torre})` : ''}`;
  if (ds.length === 0) return '';
  if (ds.length === 1) return `Departamento: ${uno(ds[0]!)}.\n\n`;
  return `Departamentos:\n${ds.map((x) => `- ${uno(x)}${x.monto ? `: ${x.monto}` : ''}`).join('\n')}\n\n`;
}

/** La mora se dice sólo en los recordatorios y sólo si el condominio la cobra. */
const avisoMora = (d: DatosAviso) => (d.mora ? ` Si el pago llega después de esa fecha, se agregará una mora de ${d.mora} a tu recibo del mes siguiente.` : '');

function cuando(dias: number | undefined): string {
  if (dias === undefined) return 'pronto';
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

/** Asunto y cuerpo en español de Perú, con tuteo. Sólo lleva lo necesario: nombre, periodo, concepto, monto, vencimiento y enlace. */
export function plantilla(tipo: TipoAviso, d: DatosAviso): { asunto: string; cuerpo: string } {
  const hola = `Hola ${primerNombre(d.nombre)},`;
  const por = d.concepto ? ` por ${d.concepto}` : '';
  switch (tipo) {
    case 'recibo_emitido':
      return {
        asunto: `Tu recibo de ${d.periodo} ya está disponible`,
        cuerpo: `${hola}\n\nYa emitimos tu recibo de ${d.periodo}${d.concepto ? ` (${d.concepto})` : ''}. Total a pagar: ${d.monto}. Vence el ${d.vencimiento}.\n\n${departamentos(d)}Revísalo y págalo desde ${ENLACE_APP}.\n\n${firma(d)}`,
      };
    case 'por_vencer':
      return {
        asunto: `Tu recibo de ${d.periodo} vence ${cuando(d.dias)}`,
        cuerpo: `${hola}\n\nTe recordamos que tu recibo de ${d.periodo} vence ${cuando(d.dias)} (${d.vencimiento}). Tienes pendiente ${d.monto} y aún no recibimos tu voucher de pago.\n\n${departamentos(d)}Paga y sube tu voucher desde ${ENLACE_APP} a más tardar el ${d.vencimiento}.${avisoMora(d)}\n\n${firma(d)}`,
      };
    case 'vence_hoy':
      return {
        asunto: `Tu recibo de ${d.periodo} vence hoy`,
        cuerpo: `${hola}\n\nHoy ${d.vencimiento} vence tu recibo de ${d.periodo} y aún no recibimos tu voucher de pago. Tienes pendiente ${d.monto}.\n\n${departamentos(d)}Paga y sube tu voucher hoy desde ${ENLACE_APP}.${avisoMora(d)}\n\n${firma(d)}`,
      };
    case 'vencido':
      return {
        asunto: `Tu recibo de ${d.periodo} está vencido`,
        cuerpo: `${hola}\n\nTu recibo de ${d.periodo} venció el ${d.vencimiento} y aún tienes pendiente ${d.monto}. Regulariza tu pago cuanto antes para evitar recargos.\n\n${departamentos(d)}${cierre(d)}`,
      };
    case 'pago_validado':
      return {
        asunto: `Validamos tu pago de ${d.periodo}`,
        cuerpo: `${hola}\n\nValidamos tu pago de ${d.monto}${por} (${d.periodo}). ¡Gracias por estar al día!\n\n${departamentos(d)}${cierre(d)}`,
      };
    case 'pago_rechazado':
      return {
        asunto: `No pudimos validar tu pago de ${d.periodo}`,
        cuerpo: `${hola}\n\nNo pudimos validar tu pago de ${d.monto}${por} (${d.periodo}). ${d.motivo ? `Motivo: ${d.motivo}\n\n` : ''}Revisa el detalle y vuelve a enviar tu comprobante.\n\n${departamentos(d)}${cierre(d)}`,
      };
    case 'ia_caida':
      return {
        asunto: 'El asistente de IA se quedó sin proveedores disponibles',
        cuerpo: `${hola}\n\n${d.motivo ?? 'No queda ninguna ruta de IA sana.'}\n\nMientras tanto el asistente responde con los datos de cada cuenta, sin IA. Revisa el Llavero de IA en ${ENLACE_APP}/superadmin/llavero.\n\n— House`,
      };
    case 'comunicado':
      return {
        asunto: d.titulo ?? 'Comunicado',
        cuerpo: `${hola}\n\n${d.texto ?? ''}\n\nLo puedes ver también en ${ENLACE_APP}.\n\n${firma(d)}`,
      };
    case 'ia_restablecida':
      return {
        asunto: 'El asistente de IA volvió a funcionar',
        cuerpo: `${hola}\n\n${d.motivo ?? 'La IA del asistente se restableció.'}\n\n— House`,
      };
  }
}
