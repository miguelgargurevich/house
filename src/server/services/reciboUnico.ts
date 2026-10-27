/**
 * Un recibo por (condominio, torre, mes, año). La base NO lo garantiza (ver el comentario de `Recibo` en el esquema: Postgres no compara
 * NULL con NULL y un @@unique nuevo rompería el arranque de producción con `db push`), así que lo imponen estas dos piezas, siempre juntas y
 * dentro de la MISMA transacción:
 *  1. `bloquearPeriodo`: candado de transacción por (condominio, mes, año); dos emisiones o dos Excel del mismo periodo se hacen cola.
 *  2. `recibosDelPeriodo`: ya con el candado, mira si existe el recibo de esa torre (o, sin torre, el general) y si un recibo general
 *     (sin torre) ya tiene cargos de las unidades de esa torre (caso de un recibo viejo que aún no se migró a su torre).
 */
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface PeriodoDeRecibo {
  complejoId: number;
  /** null = recibo sin torre (condominio sin torres, o general). */
  estructuraId: number | null;
  mes: number;
  anio: number;
  /** Para editar un recibo: no cuenta a sí mismo. */
  excluirId?: number;
}

/** Espera su turno si otra transacción trabaja el mismo periodo del mismo condominio. Se libera sola al terminar la transacción. */
export async function bloquearPeriodo(tx: Tx, complejoId: number, mes: number, anio: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${complejoId}::int, ${anio * 100 + mes}::int)`;
}

export interface ReciboDelPeriodo {
  /** El recibo de esa misma torre (o el general, si no hay torre). */
  mismo: { id: number } | null;
  /** Un recibo SIN torre que ya cobra a unidades de esa torre (sólo se busca cuando se pide una torre). */
  general: { id: number } | null;
}

export async function recibosDelPeriodo(tx: Tx, p: PeriodoDeRecibo): Promise<ReciboDelPeriodo> {
  const existentes = await tx.recibo.findMany({
    where: { complejo_id: p.complejoId, mes: p.mes, anio: p.anio, ...(p.excluirId !== undefined ? { id: { not: p.excluirId } } : {}) },
    select: { id: true, estructura_id: true },
    orderBy: { id: 'asc' },
  });
  const mismo = existentes.find((r) => r.estructura_id === p.estructuraId) ?? null;
  let general: { id: number } | null = null;
  if (p.estructuraId != null) {
    for (const g of existentes.filter((r) => r.estructura_id == null)) {
      const cargo = await tx.reciboConceptoUnidad.findFirst({
        where: { reciboConcepto: { recibo_id: g.id }, unidad: { estructura_id: p.estructuraId } },
        select: { id: true },
      });
      if (cargo) { general = { id: g.id }; break; }
    }
  }
  return { mismo: mismo ? { id: mismo.id } : null, general };
}
