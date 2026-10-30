/**
 * «Mantenimiento» de un departamento = todos los cargos de UNA unidad en UN recibo del mes (agua, luz, limpieza, mora…).
 * Es un concepto derivado: no tiene tabla. Aquí viven sus cuentas (puras, probadas) y las consultas agregadas en SQL
 * que usan el residente y la administración. Los PAGOS son del mantenimiento completo; los conceptos son sólo el desglose.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { MONEDA_POR_DEFECTO } from '../../lib/paises';
import { z } from '../validation';
import { relojDeCondominios, sqlHoy, type Reloj } from './zonas';
import { nombreMes } from './periodo';

export type EstadoMantenimiento = 'pagado' | 'en_revision' | 'parcial' | 'vencido' | 'pendiente';
export const ESTADOS_MANTENIMIENTO = ['pagado', 'en_revision', 'parcial', 'vencido', 'pendiente'] as const;

/** `2026-10-B01-804`: periodo + código de la unidad; estable y legible. */
export const numeroMantenimiento = (anio: number, mes: number, codigo: string) => `${anio}-${String(mes).padStart(2, '0')}-${codigo}`;

/** «Mantenimiento de octubre de 2026 · B01-804». */
export const tituloMantenimiento = (anio: number, mes: number, codigo: string) => `Mantenimiento de ${nombreMes(mes)} de ${anio} · ${codigo}`;

type Num = Prisma.Decimal | number | string | null | undefined;
const dec = (v: Num) => new Prisma.Decimal(v ?? 0);

/** Lo que cuenta de un cargo para el resumen: su monto, lo ya validado y lo que espera validación. */
export interface CargoCuenta {
  monto: Num;
  estado_pago: string | null;
  /** Suma de pagos VALIDADOS del cargo. */
  validado?: Num;
  /** Suma de pagos POR VALIDAR del cargo. */
  por_validar?: Num;
}

export interface CuentaCargo {
  total: Prisma.Decimal;
  cobrado: Prisma.Decimal;
  en_revision: Prisma.Decimal;
  /** Lo que aún se puede pagar (no está cobrado ni en revisión). */
  saldo: Prisma.Decimal;
}

/** Cuenta de UN cargo. `pagado` manda; un cargo marcado `en_revision` cuenta entero lo que le falta como en revisión. */
export function cuentaCargo(c: CargoCuenta): CuentaCargo {
  const total = dec(c.monto);
  if (c.estado_pago === 'pagado') return { total, cobrado: total, en_revision: dec(0), saldo: dec(0) };
  const cobrado = Prisma.Decimal.min(total, dec(c.validado));
  const falta = total.minus(cobrado);
  const en_revision = c.estado_pago === 'en_revision' ? falta : Prisma.Decimal.min(falta, dec(c.por_validar));
  return { total, cobrado, en_revision, saldo: falta.minus(en_revision) };
}

export interface CuentaMantenimiento {
  total: string;
  cobrado: string;
  en_revision: string;
  saldo: string;
}

export function sumarCuentas(cargos: CargoCuenta[]): CuentaMantenimiento {
  const z = { total: dec(0), cobrado: dec(0), en_revision: dec(0), saldo: dec(0) };
  for (const c of cargos) {
    const x = cuentaCargo(c);
    z.total = z.total.plus(x.total);
    z.cobrado = z.cobrado.plus(x.cobrado);
    z.en_revision = z.en_revision.plus(x.en_revision);
    z.saldo = z.saldo.plus(x.saldo);
  }
  return { total: z.total.toFixed(2), cobrado: z.cobrado.toFixed(2), en_revision: z.en_revision.toFixed(2), saldo: z.saldo.toFixed(2) };
}

/**
 * Estado del mantenimiento (mismas reglas que `estadoCargo`, a nivel recibo del departamento):
 *  - `pagado`: todo cobrado; `en_revision`: lo que falta está entero en revisión (no es moroso);
 *  - `hoy` es el día de hoy en la zona del condominio del recibo (`hoyEn(zona)`);
 *  - con saldo por pagar: `vencido` si el vencimiento ya pasó; si no, `parcial` (algo cobrado o en revisión) o `pendiente`.
 */
export function estadoMantenimiento(c: Pick<CuentaMantenimiento, 'total' | 'cobrado' | 'en_revision' | 'saldo'>, vencimiento: Date | null | undefined, hoy: Date): EstadoMantenimiento {
  const saldo = dec(c.saldo);
  if (saldo.lte(0)) return dec(c.en_revision).gt(0) ? 'en_revision' : dec(c.total).gt(0) ? 'pagado' : 'pendiente';
  if (vencimiento && vencimiento < hoy) return 'vencido';
  return dec(c.cobrado).gt(0) || dec(c.en_revision).gt(0) ? 'parcial' : 'pendiente';
}

/**
 * Reparto de un pago del mantenimiento: un `Pago` por cargo con saldo, de monto = el saldo de ese cargo
 * (lo calcula el servidor; el cliente nunca manda montos por cargo).
 */
export function repartirSaldos(cargos: (CargoCuenta & { id: number })[]): { cargoId: number; monto: Prisma.Decimal }[] {
  return cargos.map((c) => ({ cargoId: c.id, monto: cuentaCargo(c).saldo })).filter((x) => x.monto.gt(0));
}

// ---------- Consultas agregadas ----------
export interface FiltroMantenimientos {
  reciboId?: number;
  unidadIds?: number[];
  /** `null` = unidades sin block. */
  estructuraId?: number | null;
  /** Uno o varios estados (p. ej. «por pagar» = pendiente + parcial). */
  estado?: EstadoMantenimiento | EstadoMantenimiento[];
  q?: string;
}

export interface FilaMantenimiento {
  recibo_id: number;
  unidad_id: number;
  numero: string;
  titulo: string;
  mes: number;
  anio: number;
  fecha_vencimiento: Date;
  unidad: { id: number; codigo: string; estructura: { id: number; nombre: string | null } | null };
  propietario: { id: number; nombre: string } | null;
  /** Moneda del condominio (ISO 4217): todos los montos de la fila van en ella. */
  moneda: string;
  total: string;
  cobrado: string;
  en_revision: string;
  saldo: string;
  estado: EstadoMantenimiento;
}

/** `cargos`: un renglón por cargo con lo cobrado y lo que está en revisión; sólo los cargos del filtro (el LEFT JOIN de pagos se acota a ellos). */
function cteCargos(f: FiltroMantenimientos): Prisma.Sql {
  const w: Prisma.Sql[] = [];
  if (f.reciboId !== undefined) w.push(Prisma.sql`rc.recibo_id = ${f.reciboId}`);
  if (f.unidadIds) w.push(f.unidadIds.length ? Prisma.sql`rcu.unidad_id IN (${Prisma.join(f.unidadIds)})` : Prisma.sql`FALSE`);
  if (f.estructuraId !== undefined) w.push(f.estructuraId === null ? Prisma.sql`u.estructura_id IS NULL` : Prisma.sql`u.estructura_id = ${f.estructuraId}`);
  if (f.q) w.push(Prisma.sql`u.codigo ILIKE ${`%${f.q.replace(/[\\%_]/g, '\\$&')}%`}`);
  const donde = w.length ? Prisma.sql`WHERE ${Prisma.join(w, ' AND ')}` : Prisma.empty;
  return Prisma.sql`
    cargos AS (
      SELECT rcu.id, rc.recibo_id, rcu.unidad_id, rcu.monto, rcu.estado_pago
      FROM "ReciboConceptoUnidad" rcu
      JOIN "ReciboConcepto" rc ON rc.id = rcu.recibo_concepto_id
      JOIN "Unidad" u ON u.id = rcu.unidad_id
      ${donde}
    ),
    pagos AS (
      SELECT p.recibo_concepto_unidad_id AS cid,
             COALESCE(SUM(p.monto) FILTER (WHERE p.estado_validacion = 'validado'), 0) AS validado,
             COALESCE(SUM(p.monto) FILTER (WHERE p.estado_validacion = 'por_validar'), 0) AS por_validar
      FROM "Pago" p
      WHERE p.recibo_concepto_unidad_id IN (SELECT id FROM cargos)
      GROUP BY p.recibo_concepto_unidad_id
    ),
    cuentas AS (
      SELECT c.recibo_id, c.unidad_id, c.monto,
             CASE WHEN c.estado_pago = 'pagado' THEN c.monto ELSE LEAST(c.monto, COALESCE(p.validado, 0)) END AS cobrado,
             CASE WHEN c.estado_pago = 'pagado' THEN 0
                  WHEN c.estado_pago = 'en_revision' THEN c.monto - LEAST(c.monto, COALESCE(p.validado, 0))
                  ELSE LEAST(c.monto - LEAST(c.monto, COALESCE(p.validado, 0)), COALESCE(p.por_validar, 0)) END AS en_revision
      FROM cargos c
      LEFT JOIN pagos p ON p.cid = c.id
    ),
    mant AS (
      SELECT recibo_id, unidad_id,
             SUM(monto) AS total, SUM(cobrado) AS cobrado, SUM(en_revision) AS en_revision,
             SUM(monto - cobrado - en_revision) AS saldo
      FROM cuentas
      GROUP BY recibo_id, unidad_id
    )`;
}

/** Misma regla que `estadoMantenimiento`, en SQL (para filtrar y contar sin traer todo). Un test los compara. */
const sqlEstado = (hoy: Prisma.Sql) => Prisma.sql`CASE
  WHEN m.saldo <= 0 THEN (CASE WHEN m.en_revision > 0 THEN 'en_revision' WHEN m.total > 0 THEN 'pagado' ELSE 'pendiente' END)
  WHEN r.fecha_vencimiento < ${hoy} THEN 'vencido'
  WHEN m.cobrado > 0 OR m.en_revision > 0 THEN 'parcial'
  ELSE 'pendiente' END`;

type FilaSql = {
  recibo_id: number; unidad_id: number; mes: number; anio: number; fecha_vencimiento: Date; codigo: string;
  estructura_id: number | null; estructura_nombre: string | null; propietario_id: number | null; propietario_nombre: string | null; moneda: string;
  total: Prisma.Decimal; cobrado: Prisma.Decimal; en_revision: Prisma.Decimal; saldo: Prisma.Decimal; estado: EstadoMantenimiento; n: bigint;
};

const aFila = (f: FilaSql): FilaMantenimiento => ({
  recibo_id: f.recibo_id,
  unidad_id: f.unidad_id,
  numero: numeroMantenimiento(f.anio, f.mes, f.codigo),
  titulo: tituloMantenimiento(f.anio, f.mes, f.codigo),
  mes: f.mes,
  anio: f.anio,
  fecha_vencimiento: f.fecha_vencimiento,
  unidad: { id: f.unidad_id, codigo: f.codigo, estructura: f.estructura_id != null ? { id: f.estructura_id, nombre: f.estructura_nombre } : null },
  propietario: f.propietario_id != null ? { id: f.propietario_id, nombre: f.propietario_nombre ?? '' } : null,
  moneda: f.moneda,
  total: dec(f.total).toFixed(2),
  cobrado: dec(f.cobrado).toFixed(2),
  en_revision: dec(f.en_revision).toFixed(2),
  saldo: dec(f.saldo).toFixed(2),
  estado: f.estado,
});

export const ORDEN_MANTENIMIENTOS = ['codigo', 'total', 'saldo', 'vencimiento'] as const;
export type OrdenMantenimientos = (typeof ORDEN_MANTENIMIENTOS)[number];

/** Una página de mantenimientos (uno por recibo + unidad). El alcance lo decide quien llama (recibo ya verificado / unidades propias). */
export async function listarMantenimientos(
  f: FiltroMantenimientos,
  p: { page: number; pageSize: number; orden?: { campo: OrdenMantenimientos; dir: 'asc' | 'desc' }; hoy?: Date; reloj?: Reloj },
): Promise<{ items: FilaMantenimiento[]; total: number }> {
  // Cada mantenimiento se compara con el «hoy» de la zona de su condominio. `hoy` fija el mismo día para todos (pruebas).
  const hoy = p.hoy ? Prisma.sql`${p.hoy}` : sqlHoy(p.reloj ?? (await relojDeCondominios()), Prisma.sql`co.zona_horaria`);
  const dir = p.orden?.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const orden =
    p.orden?.campo === 'codigo' ? Prisma.sql`ORDER BY u.codigo ${dir}, r.fecha_vencimiento DESC`
    : p.orden?.campo === 'total' ? Prisma.sql`ORDER BY m.total ${dir}, u.codigo ASC`
    : p.orden?.campo === 'saldo' ? Prisma.sql`ORDER BY m.saldo ${dir}, u.codigo ASC`
    : p.orden?.campo === 'vencimiento' ? Prisma.sql`ORDER BY r.fecha_vencimiento ${dir}, u.codigo ASC`
    : Prisma.sql`ORDER BY r.fecha_vencimiento DESC, u.codigo ASC`;
  const estado = sqlEstado(hoy);
  const estados = f.estado === undefined ? [] : Array.isArray(f.estado) ? f.estado : [f.estado];
  const filas = await prisma.$queryRaw<FilaSql[]>`
    WITH ${cteCargos(f)}
    SELECT * FROM (
      SELECT m.recibo_id, m.unidad_id, r.mes, r.anio, r.fecha_vencimiento, u.codigo,
             e.id AS estructura_id, e.nombre AS estructura_nombre, pr.id AS propietario_id, pr.nombre AS propietario_nombre,
             COALESCE(co.moneda, ${MONEDA_POR_DEFECTO}) AS moneda,
             m.total, m.cobrado, m.en_revision, m.saldo, ${estado} AS estado,
             COUNT(*) OVER () AS n, ROW_NUMBER() OVER (${orden}) AS rn
      FROM mant m
      JOIN "Recibo" r ON r.id = m.recibo_id
      JOIN "Unidad" u ON u.id = m.unidad_id
      LEFT JOIN "Estructura" e ON e.id = u.estructura_id
      LEFT JOIN "Usuario" pr ON pr.id = u.propietario_id
      LEFT JOIN "ComplejoHabitacional" co ON co.id = r.complejo_id
      ${estados.length ? Prisma.sql`WHERE ${estado} IN (${Prisma.join(estados)})` : Prisma.empty}
    ) t
    WHERE t.rn > ${(p.page - 1) * p.pageSize} AND t.rn <= ${p.page * p.pageSize}
    ORDER BY t.rn`;
  return { items: filas.map(aFila), total: filas.length ? Number(filas[0].n) : 0 };
}

export interface FilaBlock {
  estructura_id: number | null;
  nombre: string;
  unidades: number;
  emitido: string;
  cobrado: string;
  en_revision: string;
  saldo: string;
  porcentaje: number;
  morosos: number;
}

/** Totales de un recibo por block (agregados en SQL; un renglón por block, no por unidad). */
export async function resumenPorBlock(reciboId: number, hoy: Date): Promise<FilaBlock[]> {
  const filas = await prisma.$queryRaw<{ estructura_id: number | null; nombre: string | null; unidades: bigint; emitido: Prisma.Decimal; cobrado: Prisma.Decimal; en_revision: Prisma.Decimal; saldo: Prisma.Decimal; morosos: bigint }[]>`
    WITH ${cteCargos({ reciboId })}
    SELECT u.estructura_id, e.nombre, COUNT(*) AS unidades,
           SUM(m.total) AS emitido, SUM(m.cobrado) AS cobrado, SUM(m.en_revision) AS en_revision, SUM(m.saldo) AS saldo,
           COUNT(*) FILTER (WHERE m.saldo > 0 AND r.fecha_vencimiento < ${hoy}) AS morosos
    FROM mant m
    JOIN "Recibo" r ON r.id = m.recibo_id
    JOIN "Unidad" u ON u.id = m.unidad_id
    LEFT JOIN "Estructura" e ON e.id = u.estructura_id
    GROUP BY u.estructura_id, e.nombre`;
  // «Block 2» antes que «Block 10» (orden natural); las unidades sin block, al final.
  filas.sort((a, b) => (a.nombre == null ? 1 : b.nombre == null ? -1 : a.nombre.localeCompare(b.nombre, 'es', { numeric: true })) || (a.estructura_id ?? 0) - (b.estructura_id ?? 0));
  return filas.map((f) => {
    const emitido = dec(f.emitido);
    return {
      estructura_id: f.estructura_id,
      nombre: f.nombre ?? 'Sin block',
      unidades: Number(f.unidades),
      emitido: emitido.toFixed(2),
      cobrado: dec(f.cobrado).toFixed(2),
      en_revision: dec(f.en_revision).toFixed(2),
      saldo: dec(f.saldo).toFixed(2),
      porcentaje: emitido.gt(0) ? Math.round(dec(f.cobrado).div(emitido).mul(1000).toNumber()) / 10 : 0,
      morosos: Number(f.morosos),
    };
  });
}

/**
 * Deuda acumulada de UN departamento al emitirse el recibo de (anio, mes): la suma de lo que todavía se puede pagar (`saldo`: ni cobrado ni
 * en revisión) de sus mantenimientos de periodos ANTERIORES. El periodo en curso no cuenta (ya está en el total del recibo). No existe saldo a
 * favor: el pago siempre es el saldo exacto de cada cargo, así que nunca sobra. Se calcula al mostrar; no se guarda.
 */
export async function deudaAcumulada(unidadId: number, anio: number, mes: number): Promise<string> {
  const filas = await prisma.$queryRaw<{ deuda: Prisma.Decimal | null }[]>`
    WITH ${cteCargos({ unidadIds: [unidadId] })}
    SELECT COALESCE(SUM(m.saldo), 0) AS deuda
    FROM mant m
    JOIN "Recibo" r ON r.id = m.recibo_id
    WHERE r.anio * 12 + r.mes < ${anio * 12 + mes}`;
  return dec(filas[0]?.deuda).toFixed(2);
}

/**
 * `deudaAcumulada` de VARIAS unidades en una sola consulta (el consolidado del block la pide para todos los departamentos). Misma regla y mismas
 * cuentas (`cteCargos`): una unidad sin periodos anteriores con saldo sale en «0.00»; un test compara ambas funciones.
 */
export async function deudasAcumuladas(unidadIds: number[], anio: number, mes: number): Promise<Map<number, string>> {
  const mapa = new Map<number, string>(unidadIds.map((id) => [id, '0.00']));
  if (unidadIds.length === 0) return mapa;
  const filas = await prisma.$queryRaw<{ unidad_id: number; deuda: Prisma.Decimal | null }[]>`
    WITH ${cteCargos({ unidadIds })}
    SELECT m.unidad_id, COALESCE(SUM(m.saldo), 0) AS deuda
    FROM mant m
    JOIN "Recibo" r ON r.id = m.recibo_id
    WHERE r.anio * 12 + r.mes < ${anio * 12 + mes}
    GROUP BY m.unidad_id`;
  for (const f of filas) mapa.set(f.unidad_id, dec(f.deuda).toFixed(2));
  return mapa;
}

/** ¿Se agrupa por block? Sólo si el recibo toca más de un block (un solo block, o casas sin estructura, va directo a la lista). */
export const agruparPorBlock = (filas: FilaBlock[]) => filas.length > 1;

/** Query `?estado=pendiente,parcial`: uno o varios estados válidos separados por coma; otro valor → 422. */
export const estadosQuery = z
  .string()
  .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.enum(ESTADOS_MANTENIMIENTO, { error: `estado debe ser: ${ESTADOS_MANTENIMIENTO.join(', ')}` })).min(1))
  .optional();
