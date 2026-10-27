import { prisma } from '../../db';
import type { Rol } from '../../config';
import type { AuthUser } from '../../middleware/auth';

/** Arma el `AuthUser` desde la base, igual que `authenticate` en la sesión web: rol, cargo de junta, empresa y alcance vigentes AHORA. */
export async function cargarAuthUser(usuarioId: number): Promise<AuthUser | null> {
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, email: true, rol: true, empresa_id: true, complejo_id: true, cargo_junta: true, estructura_id: true } });
  if (!u || !u.rol) return null;
  return { id: u.id, email: u.email, rol: u.rol as Rol, empresa_id: u.empresa_id, complejo_id: u.complejo_id, cargo_junta: u.cargo_junta, estructura_id: u.estructura_id };
}

/** Unidades de un residente dentro de una empresa (por la empresa de la unidad o la de su condominio). */
export const unidadesDeResidenteEnEmpresa = (usuarioId: number, empresaId: number) => ({
  AND: [
    { OR: [{ propietario_id: usuarioId }, { inquilino_id: usuarioId }] },
    { OR: [{ empresa_id: empresaId }, { complejo: { empresa_id: empresaId } }] },
  ],
});

/** Empresas administradoras con las que la persona tiene relación: la suya (personal) o las de sus unidades (residentes). */
export async function empresasDelUsuario(u: Pick<AuthUser, 'id' | 'empresa_id'>): Promise<number[]> {
  const ids = new Set<number>();
  if (u.empresa_id != null) ids.add(u.empresa_id);
  const unidades = await prisma.unidad.findMany({
    where: { OR: [{ propietario_id: u.id }, { inquilino_id: u.id }] },
    select: { empresa_id: true, complejo: { select: { empresa_id: true } } },
  });
  for (const x of unidades) for (const e of [x.empresa_id, x.complejo?.empresa_id]) if (e != null) ids.add(e);
  return [...ids];
}

/** ¿Esta persona pertenece a esa empresa administradora? Sin ello no puede vincularse ni usar el bot de esa empresa. */
export async function perteneceAEmpresa(u: Pick<AuthUser, 'id' | 'empresa_id'>, empresaId: number): Promise<boolean> {
  if (u.empresa_id === empresaId) return true;
  return (await prisma.unidad.count({ where: unidadesDeResidenteEnEmpresa(u.id, empresaId) })) > 0;
}
