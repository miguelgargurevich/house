/**
 * Cuentas (`Usuario`) de las personas de un departamento. Mismas reglas de seguridad que la carga de contactos (fase 1):
 *  - un correo que ya es de personal, de superadmin, de OTRA empresa o de una cuenta sin vínculo con este condominio NO se vincula (409, nada se guarda);
 *  - el mismo correo en varios departamentos es UNA sola cuenta con todos ellos;
 *  - un correo que ya es de alguien con un nombre que no se parece al de la persona NO se vincula (evita darle acceso a la cuenta equivocada por un error de tipeo).
 */
import type { Prisma } from '@prisma/client';
import { ROLES_RESIDENTE } from '../../config';
import { HttpError } from '../../errors';
import { mismaPersona } from '../contactos/plan';
import { correoReal, rolDeRelacion, type Relacion } from './tipos';

type Tx = Prisma.TransactionClient;

export const MENSAJE_CUENTA_AJENA = 'Ese correo ya está en uso por una cuenta que no se puede vincular a este condominio';
export const MENSAJE_OTRA_PERSONA = 'Ese correo ya pertenece a otra persona (el nombre no coincide). Revisa el correo';

export interface ContextoCondominio { complejoId: number; empresaId: number | null }

interface CuentaDb { id: number; nombre: string; email: string; rol: string | null; empresa_id: number | null; complejo_id: number | null }
const SELECT_CUENTA = { id: true, nombre: true, email: true, rol: true, empresa_id: true, complejo_id: true } as const;

const esResidente = (rol: string | null) => (ROLES_RESIDENTE as readonly string[]).includes(rol ?? '');

/** ¿Se puede vincular esta cuenta a un departamento de ESTE condominio? Sólo un residente de esta empresa, y con todos sus vínculos dentro de ella. */
export async function cuentaVinculable(tx: Tx, q: CuentaDb, ctx: ContextoCondominio): Promise<boolean> {
  if (!esResidente(q.rol)) return false;
  if (q.empresa_id != null && q.empresa_id !== ctx.empresaId) return false;
  const vinculos: { empresa: number | null; complejo: number | null }[] = [];
  const unidades = await tx.unidad.findMany({
    where: { OR: [{ propietario_id: q.id }, { inquilino_id: q.id }, { personas: { some: { usuario_id: q.id } } }] },
    select: { complejo_id: true, empresa_id: true, complejo: { select: { empresa_id: true } } },
  });
  for (const u of unidades) vinculos.push({ empresa: u.complejo?.empresa_id ?? u.empresa_id, complejo: u.complejo_id });
  if (q.complejo_id != null) {
    const c = await tx.complejoHabitacional.findUnique({ where: { id: q.complejo_id }, select: { empresa_id: true } });
    vinculos.push({ empresa: c?.empresa_id ?? null, complejo: q.complejo_id });
  }
  const propio = (v: { empresa: number | null; complejo: number | null }) => (ctx.empresaId != null ? v.empresa === ctx.empresaId : v.complejo === ctx.complejoId);
  return vinculos.length > 0 && vinculos.every(propio);
}

export interface PersonaParaCuenta {
  id: number;
  nombre: string;
  relacion: Relacion | string;
  correo: string | null;
  celular: string | null;
  unidad_id: number;
}

/**
 * La cuenta de una persona: la que ya tiene ese correo (si se puede vincular) o una nueva. Sin correo real se crea una ficha con correo de relleno
 * (sirve sólo para mandarle avisos por WhatsApp). La cuenta nueva no tiene contraseña ni acceso hasta que se encienda.
 */
export async function buscarOCrearCuenta(tx: Tx, p: PersonaParaCuenta, ctx: ContextoCondominio): Promise<{ id: number; creada: boolean }> {
  const correo = correoReal(p.correo);
  if (correo) {
    const q = await tx.usuario.findFirst({ where: { email: { equals: correo, mode: 'insensitive' } }, select: SELECT_CUENTA });
    if (q) {
      if (!(await cuentaVinculable(tx, q, ctx))) throw new HttpError(409, MENSAJE_CUENTA_AJENA, undefined, 'CUENTA_AJENA');
      if (!mismaPersona(p.nombre, q.nombre)) throw new HttpError(409, MENSAJE_OTRA_PERSONA, undefined, 'OTRA_PERSONA');
      return { id: q.id, creada: false };
    }
  }
  const u = await tx.usuario.create({
    data: {
      nombre: p.nombre,
      email: correo ?? `u${p.unidad_id}-p${p.id}@sin-correo.invalid`,
      telefono: p.celular,
      rol: rolDeRelacion(p.relacion),
      empresa_id: null,
      complejo_id: ctx.complejoId,
      aviso_email: !!correo,
      aviso_whatsapp: !!p.celular,
    },
    select: { id: true },
  });
  return { id: u.id, creada: true };
}
