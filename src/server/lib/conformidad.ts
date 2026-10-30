/** Conformidad del tesorero: «el dinero llegó a la cuenta». La da el tesorero de la junta; la administradora la necesita para validar (salvo `ExencionConformidad`) y la IA valida sola sólo con ella. */
import { prisma } from '../db';

/** Cómo sale la conformidad en el pago: quién y cuándo, o null si el tesorero aún no la da. */
export function formatearConformidad(p: { conformidad_at: Date | null; conformidad_por?: { id: number; nombre: string } | null }) {
  return p.conformidad_at ? { at: p.conformidad_at, por: { nombre: p.conformidad_por?.nombre ?? '—' } } : null;
}

type ConUnidad = { usuario?: { id: number } | null; unidad?: { estructura?: { id: number } | null; complejo?: { id: number } | null } | null };

/**
 * Por qué un pago NO necesita el check del tesorero (nadie puede darlo): el block no tiene tesorero vigente, o el único que lo cubre es quien
 * registró el pago (nadie da la conformidad de su propio pago). `null` = la conformidad se exige.
 */
export type ExencionConformidad = 'sin_tesorero' | 'pago_del_tesorero';

type TesoreroDeAmbito = { id: number; complejo_id: number | null; estructura_id: number | null };

/** Mismo criterio que sus permisos (`lib/junta.ts`): un tesorero sin block cubre todos los blocks de su condominio; el de un block, sólo ese. */
function exencionDe(tesoreros: TesoreroDeAmbito[], complejo: number | null | undefined, estructura: number | null, pagadorId: number | null | undefined): ExencionConformidad | null {
  const cubren = tesoreros.filter((t) => t.complejo_id === complejo && (t.estructura_id == null || t.estructura_id === estructura));
  if (cubren.length === 0) return 'sin_tesorero';
  return cubren.every((t) => t.id === pagadorId) ? 'pago_del_tesorero' : null;
}

const tesorerosDe = (complejos: number[]) => complejos.length
  ? prisma.usuario.findMany({ where: { rol: 'propietario', cargo_junta: 'tesorero', complejo_id: { in: complejos } }, select: { id: true, complejo_id: true, estructura_id: true } })
  : Promise.resolve([] as TesoreroDeAmbito[]);

/**
 * Agrega a cada pago `tesorero_registrado` (¿el block de la unidad tiene un tesorero vigente?) y `conformidad_exencion` (¿hay alguien que pueda
 * darla? si no, por qué: la administradora puede validar sola). Una sola consulta por página, no una por pago.
 */
export async function conTesoreroRegistrado<T extends ConUnidad>(items: T[]): Promise<(T & { tesorero_registrado: boolean; conformidad_exencion: ExencionConformidad | null })[]> {
  const complejos = [...new Set(items.map((p) => p.unidad?.complejo?.id).filter((id): id is number => id != null))];
  const tesoreros = await tesorerosDe(complejos);
  return items.map((p) => {
    const complejo = p.unidad?.complejo?.id;
    const estructura = p.unidad?.estructura?.id ?? null;
    return {
      ...p,
      tesorero_registrado: tesoreros.some((t) => t.complejo_id === complejo && (t.estructura_id == null || t.estructura_id === estructura)),
      conformidad_exencion: exencionDe(tesoreros, complejo, estructura, p.usuario?.id),
    };
  });
}

/** Lo mismo para un pago por su id (la validación manual y la automática): `null` = se exige la conformidad. Sin unidad no hay quien la dé. */
export async function exencionDelPago(pagoId: number): Promise<ExencionConformidad | null> {
  const p = await prisma.pago.findUnique({ where: { id: pagoId }, select: { usuario_id: true, reciboConceptoUnidad: { select: { unidad: { select: { complejo_id: true, estructura_id: true } } } } } });
  const u = p?.reciboConceptoUnidad?.unidad;
  if (!p || !u) return 'sin_tesorero';
  return exencionDe(await tesorerosDe(u.complejo_id != null ? [u.complejo_id] : []), u.complejo_id, u.estructura_id, p.usuario_id);
}
