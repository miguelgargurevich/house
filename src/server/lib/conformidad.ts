/** Conformidad del tesorero: «el dinero llegó a la cuenta». La da el tesorero de la junta; la administradora la ve al validar (no la bloquea). */
import { prisma } from '../db';

/** Cómo sale la conformidad en el pago: quién y cuándo, o null si el tesorero aún no la da. */
export function formatearConformidad(p: { conformidad_at: Date | null; conformidad_por?: { id: number; nombre: string } | null }) {
  return p.conformidad_at ? { at: p.conformidad_at, por: { nombre: p.conformidad_por?.nombre ?? '—' } } : null;
}

type ConUnidad = { unidad?: { estructura?: { id: number } | null; complejo?: { id: number } | null } | null };

/**
 * Agrega `tesorero_registrado` a cada pago: ¿el block de la unidad tiene un tesorero vigente que pueda dar la conformidad?
 * Mismo criterio que sus permisos (`lib/junta.ts`): un tesorero sin block cubre todos los blocks de su condominio; el de un block, sólo ese.
 * Una sola consulta por página, no una por pago.
 */
export async function conTesoreroRegistrado<T extends ConUnidad>(items: T[]): Promise<(T & { tesorero_registrado: boolean })[]> {
  const complejos = [...new Set(items.map((p) => p.unidad?.complejo?.id).filter((id): id is number => id != null))];
  const tesoreros = complejos.length
    ? await prisma.usuario.findMany({ where: { rol: 'propietario', cargo_junta: 'tesorero', complejo_id: { in: complejos } }, select: { complejo_id: true, estructura_id: true } })
    : [];
  return items.map((p) => {
    const complejo = p.unidad?.complejo?.id;
    const estructura = p.unidad?.estructura?.id ?? null;
    return { ...p, tesorero_registrado: tesoreros.some((t) => t.complejo_id === complejo && (t.estructura_id == null || t.estructura_id === estructura)) };
  });
}
