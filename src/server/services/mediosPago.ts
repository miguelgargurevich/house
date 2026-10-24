/** Reglas de los medios de pago de un block: catálogo de bancos, validación por tipo y límites del QR. */
import { idSchema, texto, z } from '../validation';

export const TIPOS_MEDIO = ['banco', 'yape', 'plin'] as const;
export const BANCOS = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación', 'Mibanco', 'BanBif', 'Pichincha', 'Otro'] as const;
export const TIPOS_CUENTA = ['ahorros', 'corriente'] as const;
export const MAX_ACTIVOS = 6;

export const TIPOS_QR = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type TipoQr = (typeof TIPOS_QR)[number];
export const MAX_QR = 500 * 1024;

const sinEspacios = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '') : v);
const vacioANull = (v: unknown) => (v === '' ? null : v);

const numeroCuenta = z
  .preprocess(sinEspacios, z.string({ error: 'Debe ser un texto' }).regex(/^[0-9-]{8,20}$/, 'Usa de 8 a 20 dígitos (puedes separarlos con guiones)'))
  .refine((v) => v.replace(/-/g, '').length >= 8, 'Debe tener al menos 8 dígitos');
const cci = z.preprocess((v) => vacioANull(sinEspacios(v)), z.string().regex(/^\d{20}$/, 'El CCI tiene 20 dígitos').nullish());
const documento = z.preprocess((v) => vacioANull(sinEspacios(v)), z.string().regex(/^(\d{8}|\d{11})$/, 'Usa un DNI de 8 o un RUC de 11 dígitos').nullish());
const celular = z.preprocess(sinEspacios, z.string({ error: 'Debe ser un texto' }).regex(/^9\d{8}$/, 'Usa un celular peruano de 9 dígitos que empiece con 9'));

const comunes = {
  /** Obligatorio para la administradora; la junta usa el suyo por defecto. */
  complejo_id: idSchema.optional(),
  /** Omitido = el block de la junta (o todo el condominio para la administradora); `null` = todo el condominio. */
  estructura_id: idSchema.nullish(),
  titular: texto(120),
  orden: z.coerce.number({ error: 'Debe ser un número' }).int().min(0).max(999).optional(),
  activo: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
};

export const medioSchema = z.discriminatedUnion(
  'tipo',
  [
    z.object({
      tipo: z.literal('banco'),
      banco: z.enum(BANCOS, { error: `banco debe ser: ${BANCOS.join(', ')}` }),
      tipo_cuenta: z.enum(TIPOS_CUENTA, { error: `tipo_cuenta debe ser: ${TIPOS_CUENTA.join(', ')}` }),
      numero_cuenta: numeroCuenta,
      cci,
      documento_titular: documento,
      ...comunes,
    }),
    z.object({ tipo: z.literal('yape'), celular, ...comunes }),
    z.object({ tipo: z.literal('plin'), celular, ...comunes }),
  ],
  { error: `tipo debe ser: ${TIPOS_MEDIO.join(', ')}` },
);
export type MedioInput = z.infer<typeof medioSchema>;

export const ajusteSchema = z
  .object({ activo: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(), orden: z.coerce.number({ error: 'Debe ser un número' }).int().min(0).max(999).optional() })
  .refine((v) => v.activo !== undefined || v.orden !== undefined, 'Indica activo u orden');

/** Columnas de la base para un medio validado; lo que no aplica al tipo queda en null (al cambiar de tipo no sobran datos). */
export function columnas(m: MedioInput) {
  const base = { tipo: m.tipo, titular: m.titular, banco: null as string | null, tipo_cuenta: null as string | null, numero_cuenta: null as string | null, cci: null as string | null, documento_titular: null as string | null, celular: null as string | null };
  if (m.tipo === 'banco') return { ...base, banco: m.banco, tipo_cuenta: m.tipo_cuenta, numero_cuenta: m.numero_cuenta, cci: m.cci ?? null, documento_titular: m.documento_titular ?? null };
  return { ...base, celular: m.celular };
}

/** Últimos 4 dígitos del número de cuenta o del celular: lo único que la auditoría guarda del dato de pago. */
export const ultimos4 = (m: { numero_cuenta?: string | null; celular?: string | null }) => (m.numero_cuenta ?? m.celular ?? '').replace(/\D/g, '').slice(-4);
