import { prisma } from '../db';
import type { AuthUser } from '../middleware/auth';
import { ambitoJunta } from './junta';

/**
 * Junta única: el condominio tiene una junta VIGENTE a nivel del condominio (sin block) y NINGUNA junta vigente de block.
 * Ej.: un edificio con una sola junta directiva. Se calcula al leer y nunca se guarda: si mañana registran la junta de un block,
 * el condominio deja de ser de junta única solo. Los condominios con juntas por block (Los Libertadores) no cambian.
 */
export function esJuntaUnicaDe(juntasVigentes: { estructura_id: number | null }[]): boolean {
  return juntasVigentes.some((j) => j.estructura_id == null) && !juntasVigentes.some((j) => j.estructura_id != null);
}

/** Los condominios de la lista que están en junta única. Una sola consulta para todos. */
export async function condominiosEnJuntaUnica(complejoIds: number[]): Promise<Set<number>> {
  const unicos = new Set<number>();
  if (!complejoIds.length) return unicos;
  const vigentes = await prisma.juntaDirectiva.findMany({ where: { hasta: null, complejo_id: { in: complejoIds } }, select: { complejo_id: true, estructura_id: true } });
  const porComplejo = new Map<number, { estructura_id: number | null }[]>();
  for (const j of vigentes) porComplejo.set(j.complejo_id, [...(porComplejo.get(j.complejo_id) ?? []), j]);
  for (const id of new Set(complejoIds)) if (esJuntaUnicaDe(porComplejo.get(id) ?? [])) unicos.add(id);
  return unicos;
}

/** ¿La junta del usuario (presidente o tesorero) está en un condominio de junta única? Quien no tiene ese cargo: false. */
export async function juntaUnicaDeUsuario(u: { rol: string | null; cargo_junta: string | null; complejo_id: number | null; estructura_id: number | null }): Promise<boolean> {
  // `ambitoJunta` sólo mira el rol, el cargo, el condominio y el block; el resto del usuario no le hace falta.
  const a = ambitoJunta({ ...u, id: 0, email: '', empresa_id: null } as AuthUser);
  return a !== null && (await condominiosEnJuntaUnica([a.complejo_id])).has(a.complejo_id);
}
