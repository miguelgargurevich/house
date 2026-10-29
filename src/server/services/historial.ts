/**
 * «Mi historial» del residente: sus mantenimientos mes a mes (uno por recibo + departamento) con lo pagado, lo que debe, la puntualidad y el
 * agua, más un resumen. Es una vista derivada (no hay tabla): las cuentas salen de `lib/mantenimientos.ts`, así que cuadran con «Mis recibos».
 * El alcance lo decide quien llama (`unidadWhere` = `unidadesPropias`); una unidad fuera de él es 404. Los montos son Decimal y salen como texto.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { notFound } from '../errors';
import { diasEntre, hoyLima } from '../lib/fechas';
import { estadoMantenimiento, sumarCuentas, type EstadoMantenimiento } from '../lib/mantenimientos';
import { consumoM3 } from '../lib/agua';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** Meses con recibo que se muestran cuando no se pide un año. */
export const MESES_POR_DEFECTO = 12;
/** Con menos lecturas en el recibo, el promedio del block no se publica: con 1 o 2 vecinos se podría adivinar el consumo de otro. */
export const MIN_LECTURAS_PROMEDIO = 3;

export interface UnidadHistorial { id: number; codigo: string; estructura: { id: number; nombre: string | null } | null }

export interface MesHistorial {
  recibo_id: number;
  anio: number;
  mes: number;
  unidad: { id: number; codigo: string };
  total: string;
  por_concepto: { concepto: string; monto: string }[];
  /** Lo ya cobrado (pagos validados). */
  pagado: string;
  /** Lo que aún se puede pagar (no está cobrado ni en revisión). */
  saldo: string;
  estado: EstadoMantenimiento;
  /** `AAAA-MM-DD`. */
  fecha_vencimiento: string;
  /** Sólo si el mantenimiento está pagado completo: cuándo se completó el pago. */
  fecha_pago: string | null;
  /** Negativo = pagó antes del vencimiento; positivo = después; 0 = el mismo día. */
  dias_vs_vencimiento: number | null;
  /** Consumo de agua del departamento en ese recibo (3 decimales). */
  agua_m3: string | null;
  /** Promedio del recibo (block) en m³; `null` si hay menos de `MIN_LECTURAS_PROMEDIO` lecturas. */
  agua_promedio_block: string | null;
}

export interface ResumenHistorial {
  /** Lo cobrado en los meses del periodo. */
  pagado: string;
  /** Pagado ÷ meses del periodo en los que hubo algún pago. */
  promedio_mes: string;
  /** Todo lo que se puede pagar hoy (incluida la mora), de cualquier periodo: no depende del año elegido. */
  deuda_actual: string;
  /** Lo que ya enviaste y espera validación; no cuenta como deuda. */
  en_revision: string;
  /** Meses pagados con fecha de pago ≤ vencimiento… */
  meses_a_tiempo: number;
  /** …de los meses evaluados: los pagados con fecha conocida y los vencidos sin pagar (los que están en revisión se esperan). */
  meses_evaluados: number;
  meses_en_periodo: number;
  agua_promedio_m3: string | null;
}

export interface Historial {
  unidades: UnidadHistorial[];
  /** Años con recibo, del más reciente al más antiguo. */
  anios: number[];
  /** El año pedido; `null` = últimos meses con recibo. */
  anio: number | null;
  resumen: ResumenHistorial;
  meses: MesHistorial[];
}

export interface OpcionesHistorial { unidadId?: number; anio?: number; hoy?: Date }

interface Grupo {
  recibo_id: number;
  unidad: { id: number; codigo: string };
  anio: number;
  mes: number;
  vence: Date;
  cargos: { monto: Dec; estado_pago: string | null; validado: Dec; por_validar: Dec; fecha_pago: Date | null; fechasValidadas: Date[] }[];
  conceptos: Map<string, { orden: number; monto: Dec }>;
}

const dec = (v: Prisma.Decimal.Value | null | undefined) => new D(v ?? 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** El vencimiento es una fecha sin hora (medianoche UTC): se compara como día de calendario. */
const soloDia = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const vacio = (unidades: UnidadHistorial[], anio: number | null): Historial => ({
  unidades,
  anios: [],
  anio,
  resumen: { pagado: '0.00', promedio_mes: '0.00', deuda_actual: '0.00', en_revision: '0.00', meses_a_tiempo: 0, meses_evaluados: 0, meses_en_periodo: 0, agua_promedio_m3: null },
  meses: [],
});

export async function historialResidente(unidadWhere: Prisma.UnidadWhereInput, opts: OpcionesHistorial = {}): Promise<Historial> {
  const hoy = opts.hoy ?? hoyLima();
  const unidades = (await prisma.unidad.findMany({
    where: unidadWhere,
    select: { id: true, codigo: true, estructura: { select: { id: true, nombre: true } } },
    orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
  })) as UnidadHistorial[];
  if (opts.unidadId !== undefined && !unidades.some((u) => u.id === opts.unidadId)) throw notFound('Unidad'); // una unidad ajena no se distingue de una que no existe
  const elegidas = opts.unidadId !== undefined ? unidades.filter((u) => u.id === opts.unidadId) : unidades;
  const anioPedido = opts.anio ?? null;
  if (!elegidas.length) return vacio(unidades, anioPedido);

  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: { unidad_id: { in: elegidas.map((u) => u.id) }, reciboConcepto: { recibo_id: { not: null } } },
    select: {
      monto: true,
      estado_pago: true,
      fecha_pago: true,
      unidad_id: true,
      pagos: { select: { monto: true, estado_validacion: true, fecha_pago: true } },
      reciboConcepto: { select: { orden: true, concepto: { select: { nombre: true } }, recibo: { select: { id: true, mes: true, anio: true, fecha_vencimiento: true } } } },
    },
  });

  const codigo = new Map(elegidas.map((u) => [u.id, u.codigo]));
  const grupos = new Map<string, Grupo>();
  for (const c of cargos) {
    const recibo = c.reciboConcepto?.recibo;
    if (!recibo || c.unidad_id == null) continue;
    const k = `${recibo.id}-${c.unidad_id}`;
    let g = grupos.get(k);
    if (!g) grupos.set(k, (g = { recibo_id: recibo.id, unidad: { id: c.unidad_id, codigo: codigo.get(c.unidad_id) ?? '' }, anio: recibo.anio, mes: recibo.mes, vence: soloDia(recibo.fecha_vencimiento), cargos: [], conceptos: new Map() }));
    const suma = (estado: string) => c.pagos.filter((p) => p.estado_validacion === estado).reduce((a, p) => a.plus(p.monto), dec(0));
    g.cargos.push({
      monto: dec(c.monto),
      estado_pago: c.estado_pago,
      validado: suma('validado'),
      por_validar: suma('por_validar'),
      fecha_pago: c.fecha_pago,
      fechasValidadas: c.pagos.filter((p) => p.estado_validacion === 'validado').map((p) => p.fecha_pago),
    });
    const nombre = c.reciboConcepto?.concepto?.nombre ?? 'Otros';
    const previo = g.conceptos.get(nombre);
    g.conceptos.set(nombre, { orden: previo?.orden ?? c.reciboConcepto?.orden ?? 0, monto: (previo?.monto ?? dec(0)).plus(c.monto) });
  }

  const cuentas = new Map<Grupo, ReturnType<typeof sumarCuentas>>();
  const estados = new Map<Grupo, EstadoMantenimiento>();
  for (const g of grupos.values()) {
    const cuenta = sumarCuentas(g.cargos);
    cuentas.set(g, cuenta);
    estados.set(g, estadoMantenimiento(cuenta, g.vence, hoy));
  }

  const todos = [...grupos.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes || a.unidad.codigo.localeCompare(b.unidad.codigo, 'es', { numeric: true }) || a.unidad.id - b.unidad.id);
  const anios = [...new Set(todos.map((g) => g.anio))].sort((a, b) => b - a);

  // Periodo: el año pedido, o los últimos meses con recibo.
  const claveMes = (g: Grupo) => g.anio * 12 + g.mes;
  const recientes = new Set([...new Set(todos.map(claveMes))].sort((a, b) => b - a).slice(0, MESES_POR_DEFECTO));
  const enPeriodo = todos.filter((g) => (anioPedido !== null ? g.anio === anioPedido : recientes.has(claveMes(g))));

  // Agua: la lectura de cada departamento y el promedio de TODAS las del recibo (sólo si hay las suficientes).
  const reciboIds = [...new Set(enPeriodo.map((g) => g.recibo_id))];
  const lecturas = reciboIds.length
    ? await prisma.lecturaAgua.findMany({ where: { unidad_id: { in: elegidas.map((u) => u.id) }, recibo_id: { in: reciboIds } }, select: { unidad_id: true, recibo_id: true, lectura_anterior: true, lectura_actual: true } })
    : [];
  const promedios = reciboIds.length
    ? await prisma.$queryRaw<{ recibo_id: number; n: bigint; promedio: Dec }[]>`
        SELECT recibo_id, COUNT(*) AS n, AVG(lectura_actual - lectura_anterior) AS promedio
        FROM "LecturaAgua"
        WHERE recibo_id IN (${Prisma.join(reciboIds)})
        GROUP BY recibo_id`
    : [];
  const aguaDe = new Map(lecturas.map((l) => [`${l.recibo_id}-${l.unidad_id}`, consumoM3(l.lectura_anterior, l.lectura_actual)]));
  const promedioDe = new Map(promedios.filter((p) => Number(p.n) >= MIN_LECTURAS_PROMEDIO).map((p) => [p.recibo_id, dec(p.promedio)]));

  const meses: MesHistorial[] = enPeriodo.map((g) => {
    const cuenta = cuentas.get(g)!;
    const estado = estados.get(g)!;
    // Pagado completo: el pago que lo completó (el más reciente de los validados; si sólo hay cargos marcados pagados sin pago, su fecha).
    const fechas = g.cargos.flatMap((c) => (c.fechasValidadas.length ? c.fechasValidadas : c.fecha_pago ? [c.fecha_pago] : []));
    const fechaPago = estado === 'pagado' && fechas.length ? new Date(Math.max(...fechas.map((f) => f.getTime()))) : null;
    const agua = aguaDe.get(`${g.recibo_id}-${g.unidad.id}`);
    const promedio = promedioDe.get(g.recibo_id);
    return {
      recibo_id: g.recibo_id,
      anio: g.anio,
      mes: g.mes,
      unidad: g.unidad,
      total: cuenta.total,
      por_concepto: [...g.conceptos.entries()].sort((a, b) => a[1].orden - b[1].orden).map(([concepto, v]) => ({ concepto, monto: v.monto.toFixed(2) })),
      pagado: cuenta.cobrado,
      saldo: cuenta.saldo,
      estado,
      fecha_vencimiento: iso(g.vence),
      fecha_pago: fechaPago ? fechaPago.toISOString() : null,
      dias_vs_vencimiento: fechaPago ? diasEntre(g.vence, hoyLima(fechaPago)) : null, // el día en Lima, no en UTC
      agua_m3: agua ? agua.toFixed(3) : null,
      agua_promedio_block: agua && promedio ? promedio.toFixed(3) : null,
    };
  });

  // Resumen. La deuda mira todos los periodos (es «hoy»); lo demás, sólo los meses mostrados.
  const deuda = [...cuentas.values()].reduce((a, c) => a.plus(c.saldo), dec(0));
  const enRevision = [...cuentas.values()].reduce((a, c) => a.plus(c.en_revision), dec(0));
  const pagado = meses.reduce((a, m) => a.plus(m.pagado), dec(0));
  const mesesConPago = new Set(meses.filter((m) => dec(m.pagado).gt(0)).map((m) => m.anio * 12 + m.mes));
  const evaluados = meses.filter((m) => m.estado === 'vencido' || (m.estado === 'pagado' && m.dias_vs_vencimiento !== null));
  const consumos = meses.flatMap((m) => (m.agua_m3 ? [dec(m.agua_m3)] : []));

  return {
    unidades,
    anios,
    anio: anioPedido,
    resumen: {
      pagado: pagado.toFixed(2),
      promedio_mes: (mesesConPago.size ? pagado.div(mesesConPago.size) : dec(0)).toFixed(2),
      deuda_actual: deuda.toFixed(2),
      en_revision: enRevision.toFixed(2),
      meses_a_tiempo: evaluados.filter((m) => m.estado === 'pagado' && m.dias_vs_vencimiento! <= 0).length,
      meses_evaluados: evaluados.length,
      meses_en_periodo: new Set(meses.map((m) => m.anio * 12 + m.mes)).size,
      agua_promedio_m3: consumos.length ? consumos.reduce((a, c) => a.plus(c), dec(0)).div(consumos.length).toFixed(3) : null,
    },
    meses,
  };
}
