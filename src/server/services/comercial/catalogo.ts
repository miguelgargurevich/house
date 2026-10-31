import { Prisma, type PrismaClient } from '@prisma/client';
import { PAISES } from '../../../lib/paises';

/** Módulos que se venden por condominio. Las claves son contrato con el código (puertas) y con los datos. */
export const MODULOS = ['ia_vouchers', 'whatsapp_avisos', 'asistente'] as const;
export type ModuloClave = (typeof MODULOS)[number];
export const esModulo = (c: string): c is ModuloClave => (MODULOS as readonly string[]).includes(c);

/**
 * Capacidades que trae un plan: los tres módulos (que ya no se venden sueltos, son «lo que trae Pro») más la mora automática y los reportes y
 * exportes. `PlanComercial.modulos_incluidos` guarda estas claves; Gratis no trae ninguna.
 */
export const CAPACIDADES = [...MODULOS, 'mora_automatica', 'reportes'] as const;
export type CapacidadClave = (typeof CAPACIDADES)[number];
export const esCapacidad = (c: string): c is CapacidadClave => (CAPACIDADES as readonly string[]).includes(c);

/** Gratis llega hasta este número de unidades por condominio; Torre Pro y Torre Administradora cobran como mínimo este número. */
export const UNIDADES_GRATIS_MAX = 20;
export const UNIDADES_PRO_MIN = 20;
/** Básico (S/ 1 por departamento) cobra como mínimo 20 y llega hasta 50 departamentos. */
export const UNIDADES_BASICO_MIN = 20;
export const UNIDADES_BASICO_MAX = 50;
/** Días de Gratis de partida (3 meses); el superadmin los edita en la configuración. */
export const DIAS_GRATIS_INICIAL = 90;

export const PLANES = ['gratis', 'basico', 'pro', 'administradora', 'cortesia'] as const;
export type PlanClave = (typeof PLANES)[number];

export const MEDIOS_PAGO_SUSCRIPCION = ['transferencia', 'yape', 'plin', 'efectivo', 'otro'] as const;
export const ESTADOS_SUSCRIPCION = ['gratis', 'solicitada', 'activa', 'por_vencer', 'vencida'] as const;
export type EstadoSuscripcion = (typeof ESTADOS_SUSCRIPCION)[number];

/** Viñetas de Gratis tal como salieron con la oferta anterior: el script de la oferta sólo las cambia si siguen así (lo editado a mano se respeta). */
export const CARACTERISTICAS_GRATIS_ANTERIORES = ['Recibos por torre', 'Cobranza y morosidad', 'Importación del Excel', 'Medios de pago del condominio', 'Portal del vecino', 'Vouchers validados a mano', 'Avisos por correo'] as const;
/** Viñetas de Gratis de la oferta nueva: las anteriores, con «Recibos por block» en lugar de «Recibos por torre». */
const CARACTERISTICAS_GRATIS = ['1 condominio', 'Recibos por block', ...CARACTERISTICAS_GRATIS_ANTERIORES.slice(1)] as const;

/** Valores de partida (precios BASE en soles, sin IGV). El seed sólo CREA lo que falta: nunca pisa lo que el superadmin editó. */
const MODULOS_SEED = [
  { clave: 'ia_vouchers', nombre: 'IA que lee y valida vouchers', descripcion: 'Lee cada comprobante, lo contrasta con el recibo y valida solo los que coinciden.', precio_por_unidad: '1.00', orden: 1 },
  { clave: 'whatsapp_avisos', nombre: 'Avisos por WhatsApp', descripcion: 'Recibos y recordatorios de pago por WhatsApp, además del correo.', precio_por_unidad: '1.00', orden: 2 },
  { clave: 'asistente', nombre: 'Asistente con IA', descripcion: 'Responde dudas de recibos y pagos en la web y por los bots de WhatsApp y Telegram.', precio_por_unidad: '0.50', orden: 3 },
] as const;

export const PLANES_SEED = [
  { clave: 'gratis', nombre: 'Torre Gratis', descripcion: 'Torre Gratis por 3 meses, hasta 20 departamentos.', precio_por_unidad: '0.00', modulos_incluidos: [] as string[], visible: true, orden: 1, unidades_maximas: UNIDADES_GRATIS_MAX as number | null, unidades_minimas: null as number | null, asistente_por_unidad_mes: null as number | null, whatsapp_por_unidad_mes: null as number | null,
    caracteristicas: [...CARACTERISTICAS_GRATIS] },
  { clave: 'basico', nombre: 'Torre Básico', descripcion: 'Para edificios chicos que ya terminaron su periodo gratis.', precio_por_unidad: '1.00', modulos_incluidos: [] as string[], visible: true, orden: 2, unidades_maximas: UNIDADES_BASICO_MAX as number | null, unidades_minimas: UNIDADES_BASICO_MIN as number | null, asistente_por_unidad_mes: null as number | null, whatsapp_por_unidad_mes: null as number | null,
    caracteristicas: ['Todo lo de Torre Gratis, sin plazo', 'Hasta 50 departamentos', 'Vouchers validados a mano', 'Avisos por correo'] },
  { clave: 'pro', nombre: 'Torre Pro', descripcion: 'Todo Torre, sin tope de departamentos.', precio_por_unidad: '2.50', modulos_incluidos: [...CAPACIDADES], visible: true, orden: 3, unidades_maximas: null as number | null, unidades_minimas: UNIDADES_PRO_MIN as number | null, asistente_por_unidad_mes: 5 as number | null, whatsapp_por_unidad_mes: 6 as number | null,
    caracteristicas: ['Todo lo de Torre Gratis, sin tope de departamentos', 'IA que lee y valida vouchers', 'Avisos por WhatsApp', 'Asistente con IA (web y bots)', 'Mora automática', 'Reportes y exportes'] },
  { clave: 'administradora', nombre: 'Torre Administradora', descripcion: 'Varios condominios en una sola cuenta, con descuento por volumen.', precio_por_unidad: '2.00', modulos_incluidos: [...CAPACIDADES], visible: true, orden: 4, unidades_maximas: null as number | null, unidades_minimas: UNIDADES_PRO_MIN as number | null, asistente_por_unidad_mes: 5 as number | null, whatsapp_por_unidad_mes: 6 as number | null,
    caracteristicas: ['Todo lo de Torre Pro', 'Varios condominios en una cuenta', 'Descuento por volumen'] },
  { clave: 'cortesia', nombre: 'Cortesía', descripcion: 'Condominios de la casa: todo incluido, sin cobro ni vencimiento.', precio_por_unidad: '0.00', modulos_incluidos: [...CAPACIDADES], visible: false, orden: 5, unidades_maximas: null as number | null, unidades_minimas: null as number | null, asistente_por_unidad_mes: null as number | null, whatsapp_por_unidad_mes: null as number | null, caracteristicas: [] as string[] },
] as const;

/** Moneda en la que está escrito `PlanComercial.precio_por_unidad`; las demás monedas llevan su precio en `PrecioPlanMoneda`. */
export const MONEDA_BASE_PRECIOS = 'PEN';

export const CONFIGURACION_ID = 1;
export const URL_PUBLICA_INICIAL = 'https://house.gargurevich.dev';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = Pick<PrismaClient<any, any, any>, 'moduloComercial' | 'planComercial' | 'configuracionComercial' | 'impuestoPais'>;

/**
 * Un país por fila, con el impuesto de referencia de `src/lib/paises.ts` (18 → 0.18) y la moneda del país. Donde el catálogo no tiene un impuesto
 * nacional (Brasil, EE. UU.) la tasa queda en 0: no se cobra ni se muestra impuesto hasta que el superadmin lo fije. Perú arranca con la tasa de
 * `igv_tasa` si ya había una configuración (`tasaPeru`), para no cambiar lo que ya se cobra.
 */
export const impuestosSeed = (tasaPeru: Prisma.Decimal | string = '0.18') => PAISES.map((p) => ({
  pais: p.codigo,
  nombre: p.impuesto?.nombre ?? 'Impuesto',
  tasa: p.codigo === 'PE' ? new Prisma.Decimal(tasaPeru) : new Prisma.Decimal(p.impuesto?.tasa ?? 0).div(100),
  moneda: p.moneda,
  activo: true,
}));

/** Idempotente: crea los módulos, planes, impuestos por país y la configuración que falten (`skipDuplicates`); lo ya existente no se toca. */
export async function sembrarCatalogoComercial(db: Cliente): Promise<void> {
  // Básico llegó después: en una base que ya tenía planes, al crearlo se corre un puesto el orden de Pro, Administradora y Cortesía (en una base nueva ya viene ordenado).
  const [habiaPlanes, habiaBasico] = await Promise.all([db.planComercial.count(), db.planComercial.findUnique({ where: { clave: 'basico' }, select: { clave: true } })]);
  await db.moduloComercial.createMany({ data: MODULOS_SEED.map((m) => ({ ...m, precio_por_unidad: new Prisma.Decimal(m.precio_por_unidad) })), skipDuplicates: true });
  await db.planComercial.createMany({ data: PLANES_SEED.map((p) => ({ ...p, modulos_incluidos: [...p.modulos_incluidos], caracteristicas: [...p.caracteristicas], precio_por_unidad: new Prisma.Decimal(p.precio_por_unidad) })), skipDuplicates: true });
  if (habiaPlanes > 0 && !habiaBasico) await db.planComercial.updateMany({ where: { clave: { not: 'basico' }, orden: { gte: 2 } }, data: { orden: { increment: 1 } } });
  await db.configuracionComercial.createMany({ data: [{ id: CONFIGURACION_ID, igv_tasa: new Prisma.Decimal('0.18'), dias_gracia: 7, dias_aviso_vencimiento: 5, dias_gratis: DIAS_GRATIS_INICIAL, url_publica: URL_PUBLICA_INICIAL }], skipDuplicates: true });
  const cfg = await db.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { igv_tasa: true } });
  await db.impuestoPais.createMany({ data: impuestosSeed(cfg?.igv_tasa), skipDuplicates: true });
}
