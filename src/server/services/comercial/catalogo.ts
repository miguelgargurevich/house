import { Prisma, type PrismaClient } from '@prisma/client';

/** Módulos que se venden por condominio. Las claves son contrato con el código (puertas) y con los datos. */
export const MODULOS = ['ia_vouchers', 'whatsapp_avisos', 'asistente'] as const;
export type ModuloClave = (typeof MODULOS)[number];
export const esModulo = (c: string): c is ModuloClave => (MODULOS as readonly string[]).includes(c);

export const PLANES = ['gratis', 'pro', 'administradora', 'cortesia'] as const;
export type PlanClave = (typeof PLANES)[number];

export const MEDIOS_PAGO_SUSCRIPCION = ['transferencia', 'yape', 'plin', 'efectivo', 'otro'] as const;
export const ESTADOS_SUSCRIPCION = ['gratis', 'solicitada', 'activa', 'por_vencer', 'vencida'] as const;
export type EstadoSuscripcion = (typeof ESTADOS_SUSCRIPCION)[number];

/** Valores de partida (precios BASE en soles, sin IGV). El seed sólo CREA lo que falta: nunca pisa lo que el superadmin editó. */
const MODULOS_SEED = [
  { clave: 'ia_vouchers', nombre: 'IA que lee y valida vouchers', descripcion: 'Lee cada comprobante, lo contrasta con el recibo y valida solo los que coinciden.', precio_por_unidad: '1.00', orden: 1 },
  { clave: 'whatsapp_avisos', nombre: 'Avisos por WhatsApp', descripcion: 'Recibos y recordatorios de pago por WhatsApp, además del correo.', precio_por_unidad: '1.00', orden: 2 },
  { clave: 'asistente', nombre: 'Asistente con IA', descripcion: 'Responde dudas de recibos y pagos en la web y por los bots de WhatsApp y Telegram.', precio_por_unidad: '0.50', orden: 3 },
] as const;

const PLANES_SEED = [
  { clave: 'gratis', nombre: 'Gratis', descripcion: 'Para siempre, sin límite de departamentos.', precio_por_unidad: '0.00', modulos_incluidos: [] as string[], visible: true, orden: 1,
    caracteristicas: ['Recibos por torre', 'Cobranza y morosidad', 'Importación del Excel', 'Medios de pago del condominio', 'Portal del residente', 'Registro y validación manual de vouchers', 'Avisos por correo'] },
  { clave: 'pro', nombre: 'Pro', descripcion: 'Los tres módulos y más.', precio_por_unidad: '2.50', modulos_incluidos: [...MODULOS], visible: true, orden: 2,
    caracteristicas: ['Todo lo de Gratis', 'IA que lee y valida vouchers', 'Avisos por WhatsApp', 'Asistente con IA (web y bots)', 'Mora automática', 'Reportes y exportes'] },
  { clave: 'administradora', nombre: 'Administradora', descripcion: 'Varios condominios en una sola cuenta, con descuento por volumen.', precio_por_unidad: '2.00', modulos_incluidos: [...MODULOS], visible: true, orden: 3,
    caracteristicas: ['Todo lo de Pro', 'Varios condominios en una cuenta', 'Descuento por volumen'] },
  { clave: 'cortesia', nombre: 'Cortesía', descripcion: 'Condominios de la casa: todos los módulos, sin cobro ni vencimiento.', precio_por_unidad: '0.00', modulos_incluidos: [...MODULOS], visible: false, orden: 4, caracteristicas: [] as string[] },
] as const;

export const CONFIGURACION_ID = 1;
export const URL_PUBLICA_INICIAL = 'https://house.gargurevich.dev';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = Pick<PrismaClient<any, any, any>, 'moduloComercial' | 'planComercial' | 'configuracionComercial'>;

/** Idempotente: crea los módulos, planes y la configuración que falten (`skipDuplicates`); lo ya existente no se toca. */
export async function sembrarCatalogoComercial(db: Cliente): Promise<void> {
  await db.moduloComercial.createMany({ data: MODULOS_SEED.map((m) => ({ ...m, precio_por_unidad: new Prisma.Decimal(m.precio_por_unidad) })), skipDuplicates: true });
  await db.planComercial.createMany({ data: PLANES_SEED.map((p) => ({ ...p, modulos_incluidos: [...p.modulos_incluidos], caracteristicas: [...p.caracteristicas], precio_por_unidad: new Prisma.Decimal(p.precio_por_unidad) })), skipDuplicates: true });
  await db.configuracionComercial.createMany({ data: [{ id: CONFIGURACION_ID, igv_tasa: new Prisma.Decimal('0.18'), dias_gracia: 7, dias_aviso_vencimiento: 5, url_publica: URL_PUBLICA_INICIAL }], skipDuplicates: true });
}
