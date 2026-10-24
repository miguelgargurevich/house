export const TIPOS = ['recibo_emitido', 'por_vencer', 'vencido', 'pago_validado', 'pago_rechazado'] as const;
export type TipoAviso = (typeof TIPOS)[number];

export const ENLACE_APP = 'https://house.gargurevich.dev';

export interface DatosAviso {
  nombre: string;
  /** Mes y año del recibo, p. ej. `octubre de 2026`. */
  periodo: string;
  /** Concepto o conceptos del cargo (puede ir vacío). */
  concepto?: string;
  /** Monto ya formateado, p. ej. `S/ 350.00`. */
  monto: string;
  /** Vencimiento `dd/mm/aaaa`. */
  vencimiento: string;
  /** Días que faltan para vencer (negativo si ya venció). Sólo para `por_vencer`. */
  dias?: number;
  /** Motivo del rechazo (sólo `pago_rechazado`). */
  motivo?: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

export const periodoTexto = (mes: number, anio: number) => `${MESES[mes - 1] ?? mes} de ${anio}`;

export function solesTexto(valor: { toFixed(d: number): string } | number | string): string {
  const [ent, dec] = (typeof valor === 'object' ? valor.toFixed(2) : Number(valor).toFixed(2)).split('.');
  return `S/ ${ent!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

/** `Date` (00:00 UTC, como se guardan los vencimientos) → `dd/mm/aaaa`. */
export function fechaTexto(f: Date): string {
  const dd = String(f.getUTCDate()).padStart(2, '0');
  const mm = String(f.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${f.getUTCFullYear()}`;
}

const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || 'vecino';
const cierre = `Entra a ${ENLACE_APP}.\n\n— Administración de tu condominio`;

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
        cuerpo: `${hola}\n\nYa emitimos tu recibo de ${d.periodo}${d.concepto ? ` (${d.concepto})` : ''}. Total a pagar: ${d.monto}. Vence el ${d.vencimiento}.\n\nRevísalo y págalo desde ${ENLACE_APP}.\n\n— Administración de tu condominio`,
      };
    case 'por_vencer':
      return {
        asunto: `Tu recibo de ${d.periodo} vence ${cuando(d.dias)}`,
        cuerpo: `${hola}\n\nTe recordamos que tu recibo de ${d.periodo} vence ${cuando(d.dias)} (${d.vencimiento}). Tienes pendiente ${d.monto}.\n\nPuedes pagarlo a tiempo desde ${ENLACE_APP}.\n\n— Administración de tu condominio`,
      };
    case 'vencido':
      return {
        asunto: `Tu recibo de ${d.periodo} está vencido`,
        cuerpo: `${hola}\n\nTu recibo de ${d.periodo} venció el ${d.vencimiento} y aún tienes pendiente ${d.monto}. Regulariza tu pago cuanto antes para evitar recargos.\n\n${cierre}`,
      };
    case 'pago_validado':
      return {
        asunto: `Validamos tu pago de ${d.periodo}`,
        cuerpo: `${hola}\n\nValidamos tu pago de ${d.monto}${por} (${d.periodo}). ¡Gracias por estar al día!\n\n${cierre}`,
      };
    case 'pago_rechazado':
      return {
        asunto: `No pudimos validar tu pago de ${d.periodo}`,
        cuerpo: `${hola}\n\nNo pudimos validar tu pago de ${d.monto}${por} (${d.periodo}). ${d.motivo ? `Motivo: ${d.motivo}\n\n` : ''}Revisa el detalle y vuelve a enviar tu comprobante.\n\n${cierre}`,
      };
  }
}
