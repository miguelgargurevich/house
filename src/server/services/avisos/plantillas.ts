import { formatoDinero } from '../../../lib/paises';
import { nombreMes, periodoTexto } from '../../lib/periodo';
import { hoyEn } from '../../lib/fechas';

export const TIPOS = ['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'pago_validado', 'pago_rechazado', 'ia_caida', 'ia_restablecida', 'comunicado', 'cierre_pendiente'] as const;
export type TipoAviso = (typeof TIPOS)[number];

export const ENLACE_APP = 'https://torrecondominios.com';
/** Dominio anterior: sigue sirviendo la app y los webhooks de WhatsApp/Telegram ya registrados apuntan ahí. */
export const ENLACE_ANTERIOR = 'https://house.gargurevich.dev';

export interface DatosAviso {
  nombre: string;
  /** Mes y año del recibo, p. ej. `octubre de 2026`. */
  periodo: string;
  /** Concepto o conceptos del cargo, todos y separados por coma (puede ir vacío). */
  concepto?: string;
  /** Monto ya formateado con la moneda del condominio, p. ej. `S/ 350.00` o `US$ 350.00`. */
  monto: string;
  /** Vencimiento `dd/mm/aaaa`. */
  vencimiento: string;
  /** El mismo vencimiento como día (00:00 UTC): con él el aviso dice «lunes 2 de noviembre». Sin él se usa `vencimiento`. */
  vence?: Date;
  /** Cada concepto del recibo con su monto (ya formateado), completos y sin cortar: salen en la tabla del correo y en el detalle del texto. */
  conceptos?: { nombre: string; monto: string }[];
  /** Pantalla de Torre a la que lleva el aviso (`https://torrecondominios.com/propietario/cargos`). Sin ella, el inicio. */
  enlace?: string;
  /** Días que faltan para vencer (negativo si ya venció). Sólo para `por_vencer`. */
  dias?: number;
  /** Mora (ya formateada, p. ej. `S/ 20` o `US$ 20`) que se agrega al recibo del mes siguiente si no se paga a tiempo. Sin ella, el recordatorio no la menciona. */
  mora?: string;
  /** Motivo del rechazo (`pago_rechazado`) o detalle del estado de la IA (`ia_caida`, `ia_restablecida`). */
  motivo?: string;
  /** Condominio del recibo: firma el mensaje. */
  condominio?: string | null;
  /** Nombre comercial de la empresa administradora, sólo con la marca propia activa: se suma a la firma («— Administración de <condominio> · <empresa>»). */
  empresa?: string | null;
  /** Sólo `comunicado`: el título (es el asunto) y el texto plano que escribió la administración o la junta. */
  titulo?: string;
  texto?: string;
  /** Sólo `cierre_pendiente`: el block (`concepto` trae las líneas que faltan registrar). */
  bloque?: string;
  /** Sólo `cierre_pendiente`, al tesorero central: el aviso es del cierre de la Junta central y `concepto` trae los blocks que aún no aportan. */
  central?: boolean;
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

/** `Date` (00:00 UTC) → día y mes en español, sin año: `2 de noviembre`. */
export function diaYMes(f: Date): string {
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(f);
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;

/** `Date` (00:00 UTC) → día de la semana, día y mes, sin año: `lunes 2 de noviembre` (el mes con la grafía del resto de los avisos: «setiembre»). */
export function fechaLarga(f: Date): string {
  return `${DIAS_SEMANA[f.getUTCDay()]} ${f.getUTCDate()} de ${nombreMes(f.getUTCMonth() + 1)}`;
}

/** Rutas de Torre según quien recibe el aviso: cada rol tiene su menú. Un rol que no reconocemos cae en el inicio (cada quien llega a SU inicio al entrar). */
export function rutaDeAviso(tipo: TipoAviso, rol: string | null | undefined, central?: boolean): string {
  const residente = rol === 'propietario' || rol === 'inquilino' ? `/${rol}` : null;
  switch (tipo) {
    case 'recibo_emitido': case 'por_vencer': case 'vence_hoy': case 'vencido': return residente ? `${residente}/cargos` : '';
    case 'pago_validado': case 'pago_rechazado': return residente ? `${residente}/pagos` : '';
    case 'comunicado': return residente ? `${residente}/comunicados` : rol === 'admin' ? '/admin/comunicados' : '';
    case 'cierre_pendiente': return central ? '/junta/cierre-central' : '/junta/cierre';
    case 'ia_caida': case 'ia_restablecida': return '/superadmin/llavero';
  }
}

/** Enlace completo a la pantalla del aviso. */
export const enlaceDeAviso = (tipo: TipoAviso, rol: string | null | undefined, central?: boolean): string => `${ENLACE_APP}${rutaDeAviso(tipo, rol, central)}`;

/** Dónde se ve y se paga el mantenimiento: «Mis recibos» del propietario (el inquilino, al entrar, cae en su inicio con el mismo menú). */
/** Al inicio de House: tras entrar, cada vecino (propietario o inquilino) cae en SU inicio, con el mantenimiento por pagar. */
export const ENLACE_MIS_RECIBOS = ENLACE_APP;

/**
 * Texto para el grupo de WhatsApp del block (o del condominio): lo lee todo el grupo, así que va SIN montos ni nombres de vecinos.
 * Dice qué ya está, cuándo vence y dónde pagarlo.
 */
export function mensajeGrupoRecibo(d: { periodo: string; ubicacion: string; vencimiento: Date }): string {
  return `Ya está el mantenimiento de ${d.periodo} del ${d.ubicacion}. Vence el ${diaYMes(d.vencimiento)}. Míralo y págalo con tu voucher en Torre: ${ENLACE_MIS_RECIBOS}`;
}

/** Instante → `dd/mm/aaaa` según el día en la zona del condominio (un pago a las 21:00 en Lima ya es el día siguiente en UTC). */
export function fechaTextoEn(f: Date, zona: string): string {
  return fechaTexto(hoyEn(zona, f));
}

export const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || 'vecino';
const firma = (d: DatosAviso) => `— Administración${d.condominio ? ` de ${d.condominio}` : ' de tu condominio'}${d.empresa && d.empresa !== d.condominio ? ` · ${d.empresa}` : ''}`;
const enlaceDe = (d: DatosAviso) => d.enlace ?? ENLACE_APP;
const cierre = (d: DatosAviso) => `Entra a ${enlaceDe(d)}.\n\n${firma(d)}`;
/** El vencimiento para decirlo en una frase: «lunes 2 de noviembre» (o `dd/mm/aaaa` si no tenemos el día). */
const venceEl = (d: DatosAviso) => (d.vence ? fechaLarga(d.vence) : d.vencimiento);
/** Los conceptos completos, uno por línea con su monto. Vacío si el aviso no trae el detalle. */
const detalle = (d: DatosAviso) => (d.conceptos?.length ? `Detalle:\n${d.conceptos.map((c) => `- ${c.nombre}: ${c.monto}`).join('\n')}\n\n` : '');

/** «Departamento: B01-804 (Block 1).» o, con varios, uno por línea con su monto: nunca se fusionan unidades de torres distintas sin decirlo. */
function departamentos(d: DatosAviso): string {
  const ds = d.departamentos ?? [];
  const uno = (x: { codigo: string; torre: string | null }) => `${x.codigo}${x.torre ? ` (${x.torre})` : ''}`;
  if (ds.length === 0) return '';
  if (ds.length === 1) return `Departamento: ${uno(ds[0]!)}.\n\n`;
  return `Departamentos:\n${ds.map((x) => `- ${uno(x)}${x.monto ? `: ${x.monto}` : ''}`).join('\n')}\n\n`;
}

/** La mora se dice sólo en los recordatorios y sólo si el condominio la cobra. */
export const avisoMora = (d: DatosAviso) => (d.mora ? ` Si el pago llega después de esa fecha, se agregará una mora de ${d.mora} a tu recibo del mes siguiente.` : '');

export function cuando(dias: number | undefined): string {
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
        cuerpo: `${hola}\n\nYa emitimos tu recibo de ${d.periodo}${d.concepto && !d.conceptos?.length ? ` (${d.concepto})` : ''}. Total a pagar: ${d.monto}. Vence el ${venceEl(d)}.\n\n${departamentos(d)}${detalle(d)}Revísalo y págalo desde ${enlaceDe(d)}.\n\n${firma(d)}`,
      };
    case 'por_vencer':
      return {
        asunto: `Tu recibo de ${d.periodo} vence ${cuando(d.dias)}`,
        cuerpo: `${hola}\n\nTe recordamos que tu recibo de ${d.periodo} vence ${cuando(d.dias)} (${venceEl(d)}). Tienes pendiente ${d.monto} y aún no recibimos tu voucher de pago.\n\n${departamentos(d)}${detalle(d)}Paga y sube tu voucher desde ${enlaceDe(d)} a más tardar el ${venceEl(d)}.${avisoMora(d)}\n\n${firma(d)}`,
      };
    case 'vence_hoy':
      return {
        asunto: `Tu recibo de ${d.periodo} vence hoy`,
        cuerpo: `${hola}\n\nHoy, ${venceEl(d)}, vence tu recibo de ${d.periodo} y aún no recibimos tu voucher de pago. Tienes pendiente ${d.monto}.\n\n${departamentos(d)}${detalle(d)}Paga y sube tu voucher hoy desde ${enlaceDe(d)}.${avisoMora(d)}\n\n${firma(d)}`,
      };
    case 'vencido':
      return {
        asunto: `Tu recibo de ${d.periodo} está vencido`,
        cuerpo: `${hola}\n\nTu recibo de ${d.periodo} venció el ${venceEl(d)} y aún tienes pendiente ${d.monto}. Regulariza tu pago cuanto antes para evitar recargos.\n\n${departamentos(d)}${detalle(d)}${cierre(d)}`,
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
        cuerpo: `${hola}\n\n${d.motivo ?? 'No queda ninguna ruta de IA sana.'}\n\nMientras tanto el asistente responde con los datos de cada cuenta, sin IA. Revisa el Llavero de IA en ${d.enlace ?? `${ENLACE_APP}/superadmin/llavero`}.\n\n— Torre`,
      };
    case 'comunicado':
      return {
        asunto: d.titulo ?? 'Comunicado',
        cuerpo: `${hola}\n\n${d.texto ?? ''}\n\nLo puedes ver también en ${enlaceDe(d)}.\n\n${firma(d)}`,
      };
    case 'cierre_pendiente':
      if (d.central) {
        return {
          asunto: `Faltan aportes de blocks a la Junta central de ${d.periodo}`,
          cuerpo: `${hola}\n\nEstos blocks aún no registran su aporte a la Junta central de ${d.periodo}: ${d.concepto ?? 'revisa la lista'}. Entra a ${enlaceDe(d)}, abre Junta › Cierre de la Junta central y revisa «Blocks que aún no aportan».\n\n${firma(d)}`,
        };
      }
      return {
        asunto: `Faltan pagos por registrar en el cierre de ${d.periodo}`,
        cuerpo: `${hola}\n\nEl cierre de ${d.periodo} del ${d.bloque ?? 'block'} aún tiene pagos sin registrar: ${d.concepto ?? 'revisa las líneas pendientes'}. Entra a ${enlaceDe(d)}, abre Junta › Cierre del mes y registra cada pago con su voucher.\n\n${firma(d)}`,
      };
    case 'ia_restablecida':
      return {
        asunto: 'El asistente de IA volvió a funcionar',
        cuerpo: `${hola}\n\n${d.motivo ?? 'La IA del asistente se restableció.'}\n\n— Torre`,
      };
  }
}
