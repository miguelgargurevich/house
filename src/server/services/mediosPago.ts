/** Reglas de los medios de pago de un block: catálogo de entidades, validación por tipo y límites del QR. */
import { idSchema, texto, z } from '../validation';

export const TIPOS_MEDIO = ['banco', 'yape', 'plin', 'recaudacion'] as const;
export const TIPOS_CUENTA = ['ahorros', 'corriente'] as const;
export const MONEDAS = ['PEN', 'USD'] as const;
export const CODIGOS_PAGO = ['departamento', 'dni', 'otro'] as const;
export const MAX_ACTIVOS = 6;

export type GrupoEntidad = 'banco' | 'caja' | 'financiera' | 'otra';

/** Una entidad del catálogo. Los datos de formato (`largo_*`, `codigo_cci`) sólo alimentan AVISOS en el formulario: el servidor no rechaza por ellos. */
export interface Entidad {
  nombre: string;
  grupo: GrupoEntidad;
  /** Largo habitual (en dígitos) del número de cuenta de ahorros / corriente; `null` = sin aviso. */
  largo_ahorros: number | null;
  largo_corriente: number | null;
  /** Los 3 primeros dígitos del CCI de esa entidad; `null` = sin aviso. */
  codigo_cci: string | null;
}

export const GRUPOS_ENTIDAD: { grupo: GrupoEntidad; etiqueta: string }[] = [
  { grupo: 'banco', etiqueta: 'Bancos' },
  { grupo: 'caja', etiqueta: 'Cajas municipales' },
  { grupo: 'financiera', etiqueta: 'Financieras' },
  { grupo: 'otra', etiqueta: 'Otra entidad' },
];

const e = (nombre: string, grupo: GrupoEntidad, extra: Partial<Pick<Entidad, 'largo_ahorros' | 'largo_corriente' | 'codigo_cci'>> = {}): Entidad =>
  ({ nombre, grupo, largo_ahorros: null, largo_corriente: null, codigo_cci: null, ...extra });

/** Valor que se guarda en `banco` cuando la entidad no está en la lista; el nombre va en `banco_otro`. */
export const ENTIDAD_OTRA = 'Otro';

/** Fuente única de las entidades: el formulario la pide a `GET /api/medios-pago/catalogo`. Los nombres de los 9 bancos originales no cambian. */
export const ENTIDADES: readonly Entidad[] = [
  e('BCP', 'banco', { largo_ahorros: 14, largo_corriente: 13, codigo_cci: '002' }),
  e('BBVA', 'banco', { largo_ahorros: 18, largo_corriente: 18, codigo_cci: '011' }),
  e('Interbank', 'banco', { largo_ahorros: 13, largo_corriente: 13, codigo_cci: '003' }),
  e('Scotiabank', 'banco', { largo_ahorros: 10, largo_corriente: 10, codigo_cci: '009' }),
  e('Banco de la Nación', 'banco', { largo_ahorros: 11, largo_corriente: 11, codigo_cci: '018' }),
  e('BanBif', 'banco', { codigo_cci: '038' }),
  e('Pichincha', 'banco', { codigo_cci: '035' }),
  e('Mibanco', 'banco', { codigo_cci: '049' }),
  e('Banco Falabella', 'banco'),
  e('Banco Ripley', 'banco'),
  e('Banco GNB', 'banco'),
  e('Santander', 'banco'),
  e('Citibank', 'banco'),
  e('Alfin Banco', 'banco'),
  e('Banco de Comercio', 'banco'),
  e('Compartamos Banco', 'banco'),
  e('Caja Arequipa', 'caja'),
  e('Caja Huancayo', 'caja'),
  e('Caja Piura', 'caja'),
  e('Caja Cusco', 'caja'),
  e('Caja Trujillo', 'caja'),
  e('Caja Sullana', 'caja'),
  e('Caja Ica', 'caja'),
  e('Caja Tacna', 'caja'),
  e('Caja Metropolitana de Lima', 'caja'),
  e('Caja Maynas', 'caja'),
  e('Financiera Confianza', 'financiera'),
  e('Financiera Efectiva', 'financiera'),
  e(ENTIDAD_OTRA, 'otra'),
];
export const NOMBRES_ENTIDAD = ENTIDADES.map((x) => x.nombre) as [string, ...string[]];

export const MAX_BANCO_OTRO = 60;
export const MAX_SERVICIO = 80;
export const MAX_INSTRUCCION = 120;

export const TIPOS_QR = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type TipoQr = (typeof TIPOS_QR)[number];
export const MAX_QR = 500 * 1024;

const sinEspacios = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '') : v);
const vacioANull = (v: unknown) => (v === '' ? null : v);

export const MIN_DIGITOS_CUENTA = 6;
export const MAX_LARGO_CUENTA = 25;
const numeroCuenta = z
  .preprocess(sinEspacios, z.string({ error: 'Debe ser un texto' }).regex(/^[0-9-]{6,25}$/, 'Usa de 6 a 25 caracteres: dígitos y guiones'))
  .refine((v) => v.replace(/-/g, '').length >= MIN_DIGITOS_CUENTA, `Debe tener al menos ${MIN_DIGITOS_CUENTA} dígitos`);
/** El CCI se escribe a menudo con guiones (002-194…): se aceptan y se guarda sólo con los 20 dígitos. */
const cci = z.preprocess((v) => vacioANull(typeof v === 'string' ? v.replace(/[\s-]+/g, '') : v), z.string().regex(/^\d{20}$/, 'El CCI tiene 20 dígitos').nullish());
const documento = z.preprocess((v) => vacioANull(sinEspacios(v)), z.string().regex(/^(\d{8}|\d{11})$/, 'Usa un DNI de 8 o un RUC de 11 dígitos').nullish());
const celular = z.preprocess(sinEspacios, z.string({ error: 'Debe ser un texto' }).regex(/^9\d{8}$/, 'Usa un celular peruano de 9 dígitos que empiece con 9'));
const entidad = z.enum(NOMBRES_ENTIDAD, { error: `banco debe ser una entidad de la lista (GET /api/medios-pago/catalogo)` });
const bancoOtro = z.preprocess(vacioANull, texto(MAX_BANCO_OTRO).nullish());
const opcionalTexto = (max: number) => z.preprocess(vacioANull, texto(max).nullish());

const comunes = {
  /** Obligatorio para la administradora; la junta usa el suyo por defecto. */
  complejo_id: idSchema.optional(),
  /** Omitido = el block de la junta (o todo el condominio para la administradora); `null` = todo el condominio. */
  estructura_id: idSchema.nullish(),
  titular: texto(120),
  orden: z.coerce.number({ error: 'Debe ser un número' }).int().min(0).max(999).optional(),
  activo: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
};

/** «Otro» sin nombre no se acepta al crear ni al editar (un medio viejo así sólo se LEE). */
const exigeNombreSiOtro = (v: { banco: string; banco_otro?: string | null }, ctx: z.RefinementCtx) => {
  if (v.banco === ENTIDAD_OTRA && !v.banco_otro) ctx.addIssue({ code: 'custom', path: ['banco_otro'], message: 'Escribe el nombre de la entidad' });
};

export const medioSchema = z.discriminatedUnion(
  'tipo',
  [
    z.object({
      tipo: z.literal('banco'),
      banco: entidad,
      banco_otro: bancoOtro,
      tipo_cuenta: z.enum(TIPOS_CUENTA, { error: `tipo_cuenta debe ser: ${TIPOS_CUENTA.join(', ')}` }),
      numero_cuenta: numeroCuenta,
      /** Omitida = PEN al crear y se conserva al editar. */
      moneda: z.enum(MONEDAS, { error: `moneda debe ser: ${MONEDAS.join(', ')}` }).optional(),
      cci,
      documento_titular: documento,
      ...comunes,
    }).superRefine(exigeNombreSiOtro),
    z.object({ tipo: z.literal('yape'), celular, ...comunes }),
    z.object({ tipo: z.literal('plin'), celular, ...comunes }),
    z.object({
      tipo: z.literal('recaudacion'),
      banco: entidad,
      banco_otro: bancoOtro,
      servicio: texto(MAX_SERVICIO),
      codigo_pago: z.enum(CODIGOS_PAGO, { error: `codigo_pago debe ser: ${CODIGOS_PAGO.join(', ')}` }),
      codigo_instruccion: opcionalTexto(MAX_INSTRUCCION),
      ...comunes,
    }).superRefine((v, ctx) => {
      exigeNombreSiOtro(v, ctx);
      if (v.codigo_pago === 'otro' && !v.codigo_instruccion) ctx.addIssue({ code: 'custom', path: ['codigo_instruccion'], message: 'Indica qué código debe escribir el vecino' });
    }),
  ],
  { error: `tipo debe ser: ${TIPOS_MEDIO.join(', ')}` },
);
export type MedioInput = z.infer<typeof medioSchema>;

export const ajusteSchema = z
  .object({ activo: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(), orden: z.coerce.number({ error: 'Debe ser un número' }).int().min(0).max(999).optional() })
  .refine((v) => v.activo !== undefined || v.orden !== undefined, 'Indica activo u orden');

/** Columnas de la base para un medio validado; lo que no aplica al tipo queda en null (al cambiar de tipo no sobran datos). */
export function columnas(m: MedioInput) {
  const base = {
    tipo: m.tipo, titular: m.titular, banco: null as string | null, banco_otro: null as string | null, tipo_cuenta: null as string | null, numero_cuenta: null as string | null,
    cci: null as string | null, documento_titular: null as string | null, celular: null as string | null, moneda: 'PEN' as string | undefined,
    servicio: null as string | null, codigo_pago: null as string | null, codigo_instruccion: null as string | null,
  };
  const otro = (b: string, nombre?: string | null) => (b === ENTIDAD_OTRA ? (nombre ?? null) : null);
  if (m.tipo === 'banco') {
    // `moneda` omitida: undefined → Prisma la deja como está (PEN por defecto al crear).
    return { ...base, banco: m.banco, banco_otro: otro(m.banco, m.banco_otro), tipo_cuenta: m.tipo_cuenta, numero_cuenta: m.numero_cuenta, moneda: m.moneda, cci: m.cci ?? null, documento_titular: m.documento_titular ?? null };
  }
  if (m.tipo === 'recaudacion') {
    return { ...base, banco: m.banco, banco_otro: otro(m.banco, m.banco_otro), servicio: m.servicio, codigo_pago: m.codigo_pago, codigo_instruccion: m.codigo_pago === 'otro' ? (m.codigo_instruccion ?? null) : null };
  }
  return { ...base, celular: m.celular };
}

/** Últimos 4 dígitos del número de cuenta o del celular: lo único que la auditoría guarda del dato de pago (la recaudación no tiene ninguno). */
export const ultimos4 = (m: { numero_cuenta?: string | null; celular?: string | null }) => (m.numero_cuenta ?? m.celular ?? '').replace(/\D/g, '').slice(-4);

// ---------- Lo que ve el vecino ----------
type DeEntidad = { banco: string | null; banco_otro?: string | null };

/** Nombre real de la entidad: si es «Otro», el que escribió la junta (un medio antiguo sin nombre se lee como «Otra entidad»). */
export function nombreEntidad(m: DeEntidad): string | null {
  if (m.banco == null) return null;
  if (m.banco !== ENTIDAD_OTRA) return m.banco;
  return m.banco_otro?.trim() || 'Otra entidad';
}

export const monedaNombre = (moneda: string | null | undefined): 'Soles' | 'Dólares' => (moneda === 'USD' ? 'Dólares' : 'Soles');

/** Código de la unidad a la que le sirve el medio (la primera de sus unidades en el block del medio o, si es de todo el condominio, en el condominio). */
export function codigoUnidadDelMedio(m: { complejo_id: number; estructura_id: number | null }, unidades: { codigo: string; complejo_id: number | null; estructura_id: number | null }[]): string | null {
  return unidades.find((u) => u.complejo_id === m.complejo_id && (m.estructura_id == null || u.estructura_id === m.estructura_id))?.codigo ?? null;
}

/** «Paga desde Pago de servicios en BCP → Servicio, con el código: B01-804». `null` si el medio no es de recaudación. */
export function instruccionRecaudacion(
  m: DeEntidad & { tipo: string; servicio: string | null; codigo_pago: string | null; codigo_instruccion: string | null },
  codigoUnidad: string | null,
): string | null {
  if (m.tipo !== 'recaudacion') return null;
  const codigo = m.codigo_pago === 'dni' ? 'tu DNI'
    : m.codigo_pago === 'departamento' ? (codigoUnidad ?? 'el código de tu departamento')
    : (m.codigo_instruccion?.trim() || 'el que te indique la junta');
  return `Paga desde Pago de servicios en ${nombreEntidad(m) ?? 'tu banco'} → ${m.servicio?.trim() || 'el servicio indicado'}, con el código: ${codigo}`;
}

/** Los campos nuevos que ven el vecino, el recibo imprimible y el asistente (el resto de la fila no cambia). */
export function camposDePago(
  m: DeEntidad & { tipo: string; moneda: string; servicio: string | null; codigo_pago: string | null; codigo_instruccion: string | null },
  codigoUnidad: string | null,
) {
  return {
    entidad: nombreEntidad(m),
    moneda: (m.moneda === 'USD' ? 'USD' : 'PEN') as (typeof MONEDAS)[number],
    moneda_nombre: monedaNombre(m.moneda),
    servicio: m.servicio,
    codigo_pago: m.codigo_pago,
    instruccion: instruccionRecaudacion(m, codigoUnidad),
  };
}
