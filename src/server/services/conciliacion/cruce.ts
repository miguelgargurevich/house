// Cruce de los abonos del banco con los pagos registrados. `emparejar` es PURO (sin base de datos) y decide; `cruzar` carga, decide y guarda en una
// transacción con la cuenta bloqueada. Es idempotente: sólo se vuelven a mirar los abonos `sin_pago` y `por_revisar` que la administración no tocó a mano
// (`manual = false`); lo ya conciliado (a mano o solo) y lo ignorado no cambia.
//
// Reglas (todo en Decimal, al centavo):
//  · Un pago candidato es el principal del grupo (o un pago suelto) del mismo condominio (y del mismo block si la cuenta es de un block), `por_validar` o
//    `validado` —nunca `rechazado`—, todavía sin abono. Su monto es el TOTAL del grupo.
//  · Monto igual y fecha del pago dentro de ±`ventana_dias` (por cuenta, en la base; 3 por defecto) de la del abono.
//  · El número de operación igual (el de `Pago.referencia` o el que leyó la IA) es la señal más fuerte: con el mismo monto gana y no exige la ventana
//    (hasta `TOPE_OPERACION_DIAS`, una cota de sentido común).
//  · Un solo candidato, que ningún otro abono pretende → `conciliado` (automático). Varios, o uno que se disputan dos abonos → `por_revisar` con las
//    sugerencias ordenadas. Ninguno → `sin_pago`.
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { diaEn } from '../../lib/fechas';
import { soloPrincipales } from '../mantenimiento';
import { MIN_OPERACION, normalizarOperacion } from './lectura';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const VENTANA_POR_DEFECTO = 3;
export const VENTANA_MAXIMA = 15;
/** Con el mismo número de operación y el mismo monto, el pago puede estar hasta tantos días de distancia (el banco a veces abona al día hábil siguiente o más). */
export const TOPE_OPERACION_DIAS = 31;
const DIA_MS = 86_400_000;
/** Espacio de los candados de cuenta (primer entero de `pg_advisory_xact_lock`). */
const ESPACIO_CANDADO = 1_900_000_000;

export interface MovParaCruce { id: number; dia: number; monto: Prisma.Decimal; operacion: string | null }
export interface PagoParaCruce { id: number; dia: number; total: Prisma.Decimal; operaciones: string[] }
export interface Decision { movimientoId: number; estado: 'conciliado' | 'por_revisar' | 'sin_pago'; pagoId: number | null; candidatos: number[] }

const distancia = (a: number, b: number) => Math.abs(Math.round((a - b) / DIA_MS));

export function emparejar(movs: MovParaCruce[], pagos: PagoParaCruce[], ventanaDias: number): Decision[] {
  interface Cand { fuertes: PagoParaCruce[]; normales: PagoParaCruce[] }
  const porMov = new Map<number, Cand>();
  // Pagos por monto exacto (al centavo): con miles de abonos y de pagos, un índice evita comparar cada abono con cada pago.
  const porMonto = new Map<string, PagoParaCruce[]>();
  for (const p of pagos) { const k = p.total.toFixed(2); porMonto.set(k, [...(porMonto.get(k) ?? []), p]); }
  for (const m of movs) {
    const iguales = porMonto.get(m.monto.toFixed(2)) ?? [];
    const conOp = m.operacion != null && m.operacion.length >= MIN_OPERACION;
    porMov.set(m.id, {
      fuertes: conOp ? iguales.filter((p) => p.operaciones.includes(m.operacion!) && distancia(p.dia, m.dia) <= TOPE_OPERACION_DIAS) : [],
      normales: iguales.filter((p) => distancia(p.dia, m.dia) <= ventanaDias),
    });
  }
  const resultado = new Map<number, Decision>();
  const tomados = new Set<number>();

  // Fase 1: el número de operación. Un pago que coincide por operación con un solo abono (y viceversa) se concilia sin dudar.
  const vecesFuerte = new Map<number, number>();
  for (const c of porMov.values()) for (const p of c.fuertes) vecesFuerte.set(p.id, (vecesFuerte.get(p.id) ?? 0) + 1);
  for (const m of movs) {
    const c = porMov.get(m.id)!;
    if (c.fuertes.length === 1 && vecesFuerte.get(c.fuertes[0]!.id) === 1) {
      resultado.set(m.id, { movimientoId: m.id, estado: 'conciliado', pagoId: c.fuertes[0]!.id, candidatos: [] });
      tomados.add(c.fuertes[0]!.id);
    }
  }

  // Fase 2: monto y fecha, con lo que queda. Se ordena por señal (operación primero), luego por cercanía de la fecha.
  const pendientes = movs.filter((m) => !resultado.has(m.id));
  const listas = new Map<number, PagoParaCruce[]>();
  const pretendientes = new Map<number, number>();
  for (const m of pendientes) {
    const c = porMov.get(m.id)!;
    const fuertes = new Set(c.fuertes.map((p) => p.id));
    const lista = [...new Map([...c.fuertes, ...c.normales].map((p) => [p.id, p])).values()]
      .filter((p) => !tomados.has(p.id))
      .sort((a, b) => Number(fuertes.has(b.id)) - Number(fuertes.has(a.id)) || distancia(a.dia, m.dia) - distancia(b.dia, m.dia) || a.id - b.id);
    listas.set(m.id, lista);
    for (const p of lista) pretendientes.set(p.id, (pretendientes.get(p.id) ?? 0) + 1);
  }
  for (const m of pendientes) {
    const lista = listas.get(m.id)!;
    if (lista.length === 1 && pretendientes.get(lista[0]!.id) === 1) resultado.set(m.id, { movimientoId: m.id, estado: 'conciliado', pagoId: lista[0]!.id, candidatos: [] });
    else if (lista.length > 0) resultado.set(m.id, { movimientoId: m.id, estado: 'por_revisar', pagoId: null, candidatos: lista.map((p) => p.id) });
    else resultado.set(m.id, { movimientoId: m.id, estado: 'sin_pago', pagoId: null, candidatos: [] });
  }
  return movs.map((m) => resultado.get(m.id)!);
}

// ---------- Datos ----------
export interface CuentaDeConciliacion { id: number; complejo_id: number; estructura_id: number | null }

/** Los pagos del condominio (y del block, si la cuenta es de un block) que esta cuenta puede haber recibido. */
export const alcanceDePagos = (c: CuentaDeConciliacion): Prisma.PagoWhereInput => ({
  reciboConceptoUnidad: { unidad: { complejo_id: c.complejo_id, ...(c.estructura_id != null ? { estructura_id: c.estructura_id } : {}) } },
});

export async function ventanaDe(db: Db, medioId: number): Promise<number> {
  const cfg = await db.configuracionConciliacion.findUnique({ where: { medio_pago_id: medioId }, select: { ventana_dias: true } });
  return cfg?.ventana_dias ?? VENTANA_POR_DEFECTO;
}

/** Total de cada grupo de pagos (un pago del mantenimiento completo = varios `Pago` por concepto con el mismo `grupo`). */
async function totalesPorGrupo(db: Db, grupos: string[]): Promise<Map<string, Prisma.Decimal>> {
  if (!grupos.length) return new Map();
  const filas = await db.pago.groupBy({ by: ['grupo'], where: { grupo: { in: grupos } }, _sum: { monto: true } });
  return new Map(filas.map((f) => [f.grupo!, new Prisma.Decimal(f._sum.monto ?? 0)]));
}

const operacionesDe = (p: { referencia: string | null; evaluacion: { extraido: Prisma.JsonValue } | null }): string[] => {
  const ex = p.evaluacion?.extraido;
  const leida = ex && typeof ex === 'object' && !Array.isArray(ex) ? (ex as Record<string, unknown>).numero_operacion : null;
  const ops = [normalizarOperacion(p.referencia), normalizarOperacion(typeof leida === 'string' || typeof leida === 'number' ? String(leida) : null)];
  return [...new Set(ops.filter((o): o is string => o != null && o.length >= MIN_OPERACION))];
};

/** Pagos candidatos de la cuenta con su fecha como día del condominio y su total. `desde`/`hasta` acotan por fecha de pago (con holgura). */
export async function pagosCandidatos(db: Db, cuenta: CuentaDeConciliacion, zona: string, desde: Date, hasta: Date): Promise<PagoParaCruce[]> {
  const holgura = (TOPE_OPERACION_DIAS + 2) * DIA_MS;
  const pagos = await db.pago.findMany({
    where: {
      AND: [
        soloPrincipales,
        alcanceDePagos(cuenta),
        { estado_validacion: { in: ['por_validar', 'validado'] }, movimientoBancario: { is: null }, fecha_pago: { gte: new Date(desde.getTime() - holgura), lte: new Date(hasta.getTime() + holgura) } },
      ],
    },
    select: { id: true, monto: true, fecha_pago: true, referencia: true, grupo: true, evaluacion: { select: { extraido: true } } },
  });
  const totales = await totalesPorGrupo(db, [...new Set(pagos.map((p) => p.grupo).filter((g): g is string => g != null))]);
  return pagos.map((p) => ({
    id: p.id,
    dia: Date.parse(`${diaEn(p.fecha_pago, zona)}T00:00:00Z`),
    total: p.grupo != null ? (totales.get(p.grupo) ?? new Prisma.Decimal(p.monto)) : new Prisma.Decimal(p.monto),
    operaciones: operacionesDe(p),
  }));
}

export const bloquearCuenta = (tx: Tx, medioId: number): Promise<number> => tx.$executeRaw`SELECT pg_advisory_xact_lock(${ESPACIO_CANDADO}::int, ${medioId}::int)`;

/**
 * Deja la cuenta coherente antes de cruzar: un abono «conciliado» cuyo pago ya no existe (se borró) vuelve a `sin_pago`, y uno conciliado SOLO con un pago que
 * luego se rechazó se suelta (lo vinculado a mano se respeta: la administración lo decidió).
 */
export async function sanearCuenta(tx: Tx, medioId: number): Promise<void> {
  await tx.movimientoBancario.updateMany({
    where: { medio_pago_id: medioId, estado: 'conciliado', pago_id: null },
    data: { estado: 'sin_pago', vinculo: null, vinculado_por_id: null, vinculado_at: null, manual: false, candidatos: [] },
  });
  await tx.movimientoBancario.updateMany({
    where: { medio_pago_id: medioId, estado: 'conciliado', vinculo: 'automatico', pago: { estado_validacion: 'rechazado' } },
    data: { estado: 'sin_pago', pago_id: null, vinculo: null, vinculado_por_id: null, vinculado_at: null, candidatos: [] },
  });
}

export interface ResultadoCruce { revisados: number; conciliados: number; por_revisar: number; sin_pago: number }

/** Cruza los abonos abiertos de una cuenta con sus pagos. Siempre dentro de una transacción (y con la cuenta bloqueada por quien llama o aquí). */
export async function cruzarEn(tx: Tx, cuenta: CuentaDeConciliacion): Promise<ResultadoCruce> {
  await sanearCuenta(tx, cuenta.id);
  const abiertos = await tx.movimientoBancario.findMany({
    where: { medio_pago_id: cuenta.id, manual: false, estado: { in: ['sin_pago', 'por_revisar'] } },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    select: { id: true, fecha: true, monto: true, numero_operacion: true, estado: true, candidatos: true },
  });
  const vacio: ResultadoCruce = { revisados: 0, conciliados: 0, por_revisar: 0, sin_pago: 0 };
  if (!abiertos.length) return vacio;
  const [ventana, complejo] = await Promise.all([ventanaDe(tx, cuenta.id), tx.complejoHabitacional.findUnique({ where: { id: cuenta.complejo_id }, select: { zona_horaria: true } })]);
  const fechas = abiertos.map((a) => a.fecha.getTime());
  const pagos = await pagosCandidatos(tx, cuenta, complejo?.zona_horaria ?? 'America/Lima', new Date(Math.min(...fechas)), new Date(Math.max(...fechas)));
  const decisiones = emparejar(abiertos.map((a) => ({ id: a.id, dia: a.fecha.getTime(), monto: new Prisma.Decimal(a.monto), operacion: normalizarOperacion(a.numero_operacion) })), pagos, ventana);

  const res = { ...vacio, revisados: abiertos.length };
  const ahora = new Date();
  for (const d of decisiones) {
    res[d.estado === 'conciliado' ? 'conciliados' : d.estado]++;
    const actual = abiertos.find((a) => a.id === d.movimientoId)!;
    const igual = actual.estado === d.estado && d.pagoId == null && actual.candidatos.length === d.candidatos.length && actual.candidatos.every((c, i) => c === d.candidatos[i]);
    if (igual) continue;
    await tx.movimientoBancario.update({
      where: { id: d.movimientoId },
      data: d.estado === 'conciliado'
        ? { estado: 'conciliado', pago_id: d.pagoId, vinculo: 'automatico', vinculado_at: ahora, vinculado_por_id: null, candidatos: [] }
        : { estado: d.estado, candidatos: d.candidatos },
    });
  }
  return res;
}

/** Cruza una cuenta en su propia transacción. */
export async function cruzar(cuenta: CuentaDeConciliacion): Promise<ResultadoCruce> {
  return prisma.$transaction(async (tx) => {
    await bloquearCuenta(tx, cuenta.id);
    return cruzarEn(tx, cuenta);
  }, { timeout: 60_000, maxWait: 15_000 });
}
