import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { Canal } from './avisos/canales';
import { encolarAviso } from './avisos/cola';

/** Comunicados que alcanzan a quien tiene unidades en estos condominios y blocks: los de todo su condominio (sin block) y los de su block. */
export function comunicadoDeUnidades(unidades: { complejo_id: number | null; estructura_id: number | null }[]): Prisma.ComunicadoWhereInput {
  const ors = unidades
    .filter((x): x is { complejo_id: number; estructura_id: number | null } => x.complejo_id != null)
    .map((x) => ({ complejo_id: x.complejo_id, OR: [{ estructura_id: null }, ...(x.estructura_id != null ? [{ estructura_id: x.estructura_id }] : [])] }));
  return ors.length ? { OR: ors } : { id: -1 };
}

/** Quién escribió el comunicado: la administración (admin, superadmin o sin autor) o la junta (un propietario con cargo). */
export const origenDe = (autor: { rol: string | null } | null | undefined): 'administracion' | 'junta' => (autor?.rol === 'propietario' ? 'junta' : 'administracion');

/** Propietarios e inquilinos de las unidades que alcanza el comunicado (una sola vez cada uno). */
export async function destinatariosDe(c: { complejo_id: number; estructura_id: number | null }): Promise<number[]> {
  const unidades = await prisma.unidad.findMany({
    where: { complejo_id: c.complejo_id, ...(c.estructura_id != null ? { estructura_id: c.estructura_id } : {}) },
    select: { propietario_id: true, inquilino_id: true },
  });
  const ids = new Set<number>();
  for (const u of unidades) for (const id of [u.propietario_id, u.inquilino_id]) if (id != null) ids.add(id);
  return [...ids];
}

/**
 * Encola el aviso `comunicado` por los canales que pidió el autor, a cada propietario e inquilino alcanzado, respetando sus preferencias
 * (`aviso_email`, `aviso_whatsapp`) como el resto de los avisos. Idempotente por persona y canal: repetir la llamada no duplica nada.
 * Devuelve cuántos avisos se encolaron (no cuántas personas).
 */
export async function encolarComunicado(c: { id: number; complejo_id: number; estructura_id: number | null; enviar_correo: boolean; enviar_whatsapp: boolean }): Promise<number> {
  const canales: Canal[] = [];
  if (c.enviar_correo) canales.push('email');
  if (c.enviar_whatsapp) canales.push('whatsapp');
  if (!canales.length) return 0;
  let creados = 0;
  for (const id of await destinatariosDe(c)) creados += await encolarAviso('comunicado', id, { entidad: 'comunicado', id: c.id }, { canales });
  return creados;
}
