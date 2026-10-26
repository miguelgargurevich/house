import { z } from 'zod';
import type { Request } from 'express';
import { HttpError } from './errors';
import { ROLES } from './config';
import { esContrasenaComun } from './lib/contrasenasComunes';

z.config(z.locales.es());

export { z };

// ---------- Primitivos reutilizables ----------
const INT_MAX = 2_147_483_647;

export const idSchema = z.coerce.number({ error: 'Debe ser un número' }).int('Debe ser un entero').positive('Debe ser positivo').max(INT_MAX, 'Id fuera de rango');
export const idParams = z.object({ id: idSchema });

export const texto = (max = 255, min = 1) =>
  z.string({ error: 'Debe ser un texto' }).trim().min(min, 'Es obligatorio').max(max, `Máximo ${max} caracteres`);
export const textoOpcional = (max = 255) =>
  z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max, `Máximo ${max} caracteres`).nullish());

export const emailSchema = z.string({ error: 'Debe ser un texto' }).trim().toLowerCase().max(160).pipe(z.email('Correo electrónico inválido'));
export const telefonoSchema = z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(30).regex(/^[0-9+()\-\s]*$/, 'Teléfono inválido').nullish());
/** Sólo al CREAR o CAMBIAR una contraseña (nunca en el login: las cuentas existentes siguen entrando). */
export const passwordSchema = z
  .string({ error: 'Debe ser un texto' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(72, 'La contraseña admite hasta 72 caracteres')
  .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), 'La contraseña debe incluir al menos una letra y un número')
  .refine((p) => !esContrasenaComun(p), 'Esa contraseña es demasiado común, elige otra');

/** ¿La contraseña es el correo o su parte antes de la @? (sin distinguir mayúsculas). */
export const contrasenaIgualACorreo = (password: string, email: string): boolean => {
  const p = password.toLowerCase();
  const e = email.trim().toLowerCase();
  return p === e || p === e.split('@')[0];
};
export const MENSAJE_PASSWORD_CORREO = 'La contraseña no puede ser igual a tu correo';
export const rolSchema = z.enum(ROLES, { error: `Rol inválido (${ROLES.join(', ')})` });

/** Monto en soles: número o texto con hasta 2 decimales; se envía a Prisma como texto para no perder precisión. */
export const montoSchema = z
  .union([z.number(), z.string()], { error: 'Monto inválido' })
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Monto inválido (máx. 2 decimales)'))
  .refine((v) => Number(v) > 0, 'El monto debe ser mayor que cero');

export const fechaSchema = z
  .string({ error: 'Fecha inválida' })
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, 'Fecha inválida (usa AAAA-MM-DD)')
  .transform((s) => new Date(s))
  .refine((d) => !Number.isNaN(d.getTime()), 'Fecha inválida');

export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

// ---------- Listas ----------
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page debe ser ≥ 1').max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1, 'pageSize debe ser ≥ 1').max(100, 'pageSize máximo 100').default(20),
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  orden: z.string().regex(/^[a-z_]+:(asc|desc)$/i, 'orden debe ser campo:asc|desc').optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

// ---------- Parseo ----------
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const campos: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const campo = issue.path.join('.') || '_';
    if (!(campo in campos)) campos[campo] = issue.message;
  }
  const [campo, mensaje] = Object.entries(campos)[0] ?? ['_', 'Datos inválidos'];
  throw new HttpError(422, campo === '_' ? `Datos inválidos: ${mensaje}` : `Datos inválidos: ${campo}: ${mensaje}`, campos);
}

export const parseBody = <S extends z.ZodType>(schema: S, req: Request) => parse(schema, req.body);
export const parseQuery = <S extends z.ZodType>(schema: S, req: Request) => parse(schema, req.query);
export const parseId = (req: Request) => parse(idParams, req.params).id;

export function parseOrden(orden: string | undefined, permitidos: string[], porDefecto: Record<string, 'asc' | 'desc'>) {
  if (!orden) return porDefecto;
  const [campo, dir] = orden.split(':');
  if (!permitidos.includes(campo)) throw new HttpError(422, `Datos inválidos: orden: campo no permitido (${permitidos.join(', ')})`, { orden: 'Campo no permitido' });
  return { [campo]: dir.toLowerCase() as 'asc' | 'desc' };
}
