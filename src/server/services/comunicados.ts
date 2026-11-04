import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { Canal } from './avisos/canales';
import { encolarAviso } from './avisos/cola';

/**
 * Comunicados que alcanzan a quien tiene unidades en estos condominios y blocks: los de todo su condominio (sin block) y los de su block.
 * Un comunicado a «departamentos elegidos» (`unidades` con ids) sólo lo ve quien tiene una de ESAS unidades (`id`): estar en el mismo block no basta.
 */
export function comunicadoDeUnidades(unidades: { id?: number; complejo_id: number | null; estructura_id: number | null }[]): Prisma.ComunicadoWhereInput {
  const ors = unidades
    .filter((x): x is { id?: number; complejo_id: number; estructura_id: number | null } => x.complejo_id != null)
    .map((x) => ({ complejo_id: x.complejo_id, OR: [{ estructura_id: null }, ...(x.estructura_id != null ? [{ estructura_id: x.estructura_id }] : [])] }));
  if (!ors.length) return { id: -1 };
  const ids = unidades.flatMap((x) => (x.id != null ? [x.id] : []));
  return { AND: [{ OR: ors }, { OR: [{ unidades: { isEmpty: true } }, ...(ids.length ? [{ unidades: { hasSome: ids } }] : [])] }] };
}

/** Quién escribió el comunicado: la administración (admin, superadmin o sin autor) o la junta (un propietario con cargo). */
export const origenDe = (autor: { rol: string | null } | null | undefined): 'administracion' | 'junta' => (autor?.rol === 'propietario' ? 'junta' : 'administracion');

/**
 * Las personas a quienes les llega un comunicado «a cada vecino» (una sola vez cada una): en cada unidad con personas cargadas, las marcadas «Recibe comunicados»
 * (con su cuenta, que es donde viven su correo, su celular y sus preferencias); en las que aún no tienen personas, el propietario y el inquilino de siempre.
 * Con `unidades` (departamentos elegidos) la misma regla, pero sólo en esas unidades.
 */
export async function destinatariosDe(c: { complejo_id: number; estructura_id: number | null; unidades?: number[] }): Promise<number[]> {
  const unidades = await prisma.unidad.findMany({
    // Con «departamentos elegidos» (`unidades`), sólo esas unidades; sin ellos, todo el condominio o el block.
    where: { complejo_id: c.complejo_id, ...(c.estructura_id != null ? { estructura_id: c.estructura_id } : {}), ...(c.unidades?.length ? { id: { in: c.unidades } } : {}) },
    select: { propietario_id: true, inquilino_id: true, personas: { select: { usuario_id: true, recibe_comunicados: true } } },
  });
  const ids = new Set<number>();
  for (const u of unidades) {
    if (u.personas.length) { for (const p of u.personas) if (p.recibe_comunicados && p.usuario_id != null) ids.add(p.usuario_id); }
    else for (const id of [u.propietario_id, u.inquilino_id]) if (id != null) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** Miembros vigentes de la junta del alcance: la del block, o (comunicado de todo el condominio) las de todos los blocks y la junta central. */
export async function miembrosDeJunta(c: { complejo_id: number; estructura_id: number | null }): Promise<number[]> {
  const juntas = await prisma.juntaDirectiva.findMany({
    where: { complejo_id: c.complejo_id, hasta: null, ...(c.estructura_id != null ? { estructura_id: c.estructura_id } : {}) },
    select: { miembros: { select: { usuario_id: true } } },
  });
  return [...new Set(juntas.flatMap((j) => j.miembros.map((m) => m.usuario_id)))];
}

/**
 * Encola el aviso `comunicado` por los canales que pidió el autor, respetando las preferencias de cada persona (`aviso_email`, `aviso_whatsapp`)
 * como el resto de los avisos:
 *  - `enviar_correo` / `enviar_whatsapp`: a cada persona alcanzada que recibe comunicados (`destinatariosDe`; `enviar_whatsapp` = «por WhatsApp a cada vecino»);
 *  - `enviar_junta`: correo y WhatsApp a los miembros vigentes de la junta del alcance (aunque no se pida a los vecinos). No aplica con `unidades` (departamentos elegidos): la ruta lo rechaza y aquí se ignora.
 * Idempotente por persona y canal: repetir la llamada no duplica nada. Devuelve cuántos avisos se encolaron (no cuántas personas).
 */
export async function encolarComunicado(c: { id: number; complejo_id: number; estructura_id: number | null; unidades?: number[]; enviar_correo: boolean; enviar_whatsapp: boolean; enviar_junta?: boolean }): Promise<number> {
  const vecinos: Canal[] = [];
  if (c.enviar_correo) vecinos.push('email');
  if (c.enviar_whatsapp) vecinos.push('whatsapp');
  const porPersona = new Map<number, Set<Canal>>();
  const sumar = (id: number, canales: readonly Canal[]) => porPersona.set(id, new Set([...(porPersona.get(id) ?? []), ...canales]));
  if (vecinos.length) for (const id of await destinatariosDe(c)) sumar(id, vecinos);
  if (c.enviar_junta && !c.unidades?.length) for (const id of await miembrosDeJunta(c)) sumar(id, ['email', 'whatsapp']);
  let creados = 0;
  for (const [id, canales] of porPersona) creados += await encolarAviso('comunicado', id, { entidad: 'comunicado', id: c.id }, { canales: [...canales] });
  return creados;
}
