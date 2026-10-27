/**
 * Asigna su torre (`Recibo.estructura_id`) a los recibos viejos, que se emitían «para todo el condominio»: a cada recibo SIN torre cuyos cargos
 * sean TODOS de unidades de una misma torre le pone esa torre (y, si su descripción era la automática «Mantenimiento de 10 de 2026», la deja como
 * «Mantenimiento de octubre de 2026 · Block 1»). Un recibo que mezcla torres NO se toca: sólo se informa.
 *
 * Idempotente: una segunda corrida no cambia nada. No toca recibos sin cargos, de condominios sin torres, ni los que ya tienen torre.
 * Si ya existe otro recibo de esa torre y ese periodo, tampoco lo toca (lo informa como duplicado).
 *
 * Uso (lo corre el orquestador, contra la base que corresponda; sin DATABASE_URL usa la del .env):
 *   npx tsx scripts/migrar-recibos-por-torre.ts --seco   # sólo informa lo que haría
 *   npx tsx scripts/migrar-recibos-por-torre.ts          # aplica
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { descripcionRecibo } from '../src/server/lib/periodo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = Pick<PrismaClient<any, any, any>, 'recibo' | 'reciboConceptoUnidad'>;

export interface InformeMigracion {
  /** Recibos a los que se les asignó (o, en seco, se les asignaría) su torre. */
  asignados: { recibo_id: number; torre: string | null; estructura_id: number; descripcion: string | null }[];
  /** Recibos que mezclan unidades de varias torres (o torres y unidades sin torre): no se tocan. */
  mezclan: { recibo_id: number; torres: (string | null)[] }[];
  /** Recibos sin ningún cargo: no hay de dónde sacar la torre. */
  sin_cargos: number[];
  /** Recibos de condominios sin torres (o con cargos sólo de unidades sin torre): su lugar es no tener torre. */
  sin_torre: number[];
  /** Ya existe otro recibo de esa torre y ese periodo: no se toca (habría dos). */
  duplicados: { recibo_id: number; torre: string | null; con_recibo_id: number }[];
}

export async function migrarRecibosPorTorre(prisma: Cliente, opts: { seco?: boolean } = {}): Promise<InformeMigracion> {
  const informe: InformeMigracion = { asignados: [], mezclan: [], sin_cargos: [], sin_torre: [], duplicados: [] };
  const recibos = await prisma.recibo.findMany({
    where: { estructura_id: null, complejo_id: { not: null } },
    select: { id: true, complejo_id: true, mes: true, anio: true, descripcion: true },
    orderBy: { id: 'asc' },
  });
  for (const r of recibos) {
    const unidades = await prisma.reciboConceptoUnidad.findMany({
      where: { reciboConcepto: { recibo_id: r.id } },
      distinct: ['unidad_id'],
      select: { unidad: { select: { estructura_id: true, estructura: { select: { nombre: true } } } } },
    });
    if (!unidades.length) { informe.sin_cargos.push(r.id); continue; }
    const torres = new Map<number | null, string | null>();
    for (const u of unidades) torres.set(u.unidad?.estructura_id ?? null, u.unidad?.estructura?.nombre ?? null);
    if (torres.size > 1) { informe.mezclan.push({ recibo_id: r.id, torres: [...torres.values()] }); continue; }
    const [[estructuraId, nombre]] = [...torres.entries()] as [[number | null, string | null]];
    if (estructuraId == null) { informe.sin_torre.push(r.id); continue; }
    const otro = await prisma.recibo.findFirst({ where: { complejo_id: r.complejo_id, estructura_id: estructuraId, mes: r.mes, anio: r.anio, id: { not: r.id } }, select: { id: true } });
    if (otro) { informe.duplicados.push({ recibo_id: r.id, torre: nombre, con_recibo_id: otro.id }); continue; }
    // La descripción automática de antes llevaba el mes como número («Mantenimiento de 10 de 2026»): se reescribe; una escrita a mano se respeta.
    const automatica = !r.descripcion || /^Mantenimiento de \d{1,2} de \d{4}$/.test(r.descripcion.trim());
    const descripcion = automatica ? descripcionRecibo(r.mes, r.anio, nombre) : r.descripcion;
    informe.asignados.push({ recibo_id: r.id, torre: nombre, estructura_id: estructuraId, descripcion });
    if (!opts.seco) await prisma.recibo.update({ where: { id: r.id }, data: { estructura_id: estructuraId, descripcion } });
  }
  return informe;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const seco = process.argv.includes('--seco');
    const i = await migrarRecibosPorTorre(prisma, { seco });
    console.log(seco ? 'SIMULACRO (no se cambió nada)' : 'APLICADO');
    console.log(`Con torre asignada${seco ? ' (se asignaría)' : ''}: ${i.asignados.length}`);
    for (const a of i.asignados) console.log(`  recibo ${a.recibo_id} → ${a.torre ?? a.estructura_id} · «${a.descripcion ?? ''}»`);
    console.log(`Mezclan torres (NO se tocan): ${i.mezclan.length}`);
    for (const m of i.mezclan) console.log(`  recibo ${m.recibo_id}: ${m.torres.map((t) => t ?? 'sin torre').join(', ')}`);
    console.log(`Duplicados (NO se tocan): ${i.duplicados.length}`);
    for (const x of i.duplicados) console.log(`  recibo ${x.recibo_id} (${x.torre}) ya tiene a ${x.con_recibo_id} como recibo de esa torre y periodo`);
    console.log(`Sin cargos: ${i.sin_cargos.length} · sin torre (condominio sin torres): ${i.sin_torre.length}`);
  } finally {
    await prisma.$disconnect();
  }
}
