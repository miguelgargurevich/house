/**
 * Estado de cuenta (EECC) de UN departamento: el documento que la administradora le manda al vecino que reclama y que el vecino ve de lo suyo.
 * Una cuenta corriente por recibo: cargo (con su mora), pagos (voucher: fecha, n.º de operación, monto, estado), lo que falta y el SALDO ACUMULADO.
 * Es una vista derivada (no hay tabla): las cuentas salen de `lib/mantenimientos.ts` (`sumarCuentas`, `estadoMantenimiento`), las mismas de
 * «Mi historial», «Mis recibos» y Morosidad; aquí no se reinventa ningún saldo.
 *
 * Reglas (documentadas en docs/API-CONTRATO.md):
 *  - Alcance: lo decide `alcanceEstadoCuenta` (admin = su empresa; junta = su block, o todo el condominio si no tiene block; residente = sus unidades). Una
 *    unidad fuera de él es 404, igual que una inexistente.
 *  - Cada fila es el ESTADO ACTUAL del recibo (no «como estaba» el día de cada pago): los pagos se listan con su fecha, el saldo es el de hoy.
 *  - Sólo suman los pagos VALIDADOS. Los «por validar» se muestran y van en `en_revision` (no son deuda ni están cobrados). Los RECHAZADOS se
 *    muestran en la lista de pagos marcados «rechazado» (el vecino ve que se intentó) pero NO suman en ninguna cifra.
 *  - La mora es un cargo más del recibo (concepto «multa»/«mora»): va dentro del cargo y se desglosa en `mora`.
 *  - El saldo deudor es lo que aún se puede pagar (cargo − cobrado − en revisión): igual que `deuda_actual` de «Mi historial».
 *  - Cambio de propietario: la cuenta es de la UNIDAD (la deuda la sigue); la cabecera muestra al propietario e inquilino ACTUALES.
 */
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { MONEDA_POR_DEFECTO, ZONA_POR_DEFECTO, simboloDe } from '../../lib/paises';
import { prisma } from '../db';
import { forbidden, notFound } from '../errors';
import { diaEn, hoyEn } from '../lib/fechas';
import { filtroAmbito, ambitoJunta } from '../lib/junta';
import { estadoMantenimiento, sumarCuentas, type EstadoMantenimiento } from '../lib/mantenimientos';
import { nombreMes } from '../lib/periodo';
import { scopeUnidades, unidadesDeResidente } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { esConceptoMora } from './mora';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const dec = (v: Prisma.Decimal.Value | null | undefined) => new D(v ?? 0);

/** Meses con recibo que se muestran cuando no se pide un rango (como «Mi historial»). */
export const MESES_POR_DEFECTO = 12;

export type EstadoPagoEECC = 'validado' | 'por_validar' | 'rechazado';

export interface PagoEECC {
  /** Id del pago (el principal de su grupo); `null` si es un pago registrado sin detalle de voucher. */
  id: number | null;
  /** `AAAA-MM-DD` en la zona del condominio; `null` si no se conoce. */
  fecha: string | null;
  /** N.º de operación: el que anotó quien pagó, o el que leyó la IA del voucher. Dato de terceros: sólo se muestra como texto. */
  operacion: string | null;
  metodo: string | null;
  monto: string;
  estado: EstadoPagoEECC;
  /** `true` si el pago se registró (cargo pagado) sin voucher: el monto es la diferencia que lo cuadra con lo cobrado. */
  sin_detalle: boolean;
}

export interface FilaEECC {
  recibo_id: number;
  anio: number;
  mes: number;
  /** `AAAA-MM`. */
  periodo: string;
  /** `AAAA-MM-DD`. */
  fecha_vencimiento: string;
  estado: EstadoMantenimiento;
  /** Total del mantenimiento (incluye la mora). */
  cargo: string;
  por_concepto: { concepto: string; monto: string; es_mora: boolean }[];
  /** La parte del cargo que es mora. */
  mora: string;
  /** Pagos validados (lo cobrado). */
  pagado: string;
  /** Pagos por validar: no son deuda ni están cobrados. */
  en_revision: string;
  /** Lo que aún se puede pagar de este recibo. */
  saldo: string;
  /** Saldo anterior + los saldos de las filas hasta ésta. */
  saldo_acumulado: string;
  pagos: PagoEECC[];
}

export interface TotalesEECC {
  /** Suma de los cargos de las filas mostradas. */
  cargado: string;
  mora: string;
  pagado: string;
  en_revision: string;
  /** Deuda de los recibos anteriores al rango mostrado. */
  saldo_anterior: string;
  /** Lo que se debe al cierre del rango: saldo anterior + saldos de las filas. Es el `saldo_acumulado` de la última fila. */
  saldo_deudor: string;
  /** Recibos vencidos y sin pagar hasta el cierre del rango (incluye los anteriores al rango). */
  meses_vencidos: number;
  /** Lo vencido (saldo de esos recibos): es la `deuda_total` de Morosidad para esta unidad cuando el rango llega al último recibo. */
  deuda_vencida: string;
  /** Pagos rechazados en el rango: se muestran pero no suman. */
  pagos_rechazados: number;
}

export interface EstadoCuenta {
  unidad: { id: number; codigo: string; tipo: string };
  estructura: { id: number; nombre: string | null } | null;
  condominio: { id: number; nombre: string } | null;
  administradora: string | null;
  /** Sólo el nombre (nunca correo ni teléfono). */
  propietario: string | null;
  inquilino: string | null;
  moneda: string;
  zona_horaria: string;
  /** Hoy en la zona del condominio, `AAAA-MM-DD`. */
  fecha_corte: string;
  /** El rango efectivo (`AAAA-MM`); `null` si la unidad no tiene recibos en él. */
  desde: string | null;
  hasta: string | null;
  totales: TotalesEECC;
  filas: FilaEECC[];
}

/** `AAAA-MM` ya validado. */
export interface MesAnio { anio: number; mes: number }

/** `hoy` fija el mismo día para todos (pruebas); `ahora` es el instante con el que el condominio saca SU día. */
export interface OpcionesEstadoCuenta { desde?: MesAnio; hasta?: MesAnio; hoy?: Date; ahora?: Date }

/** Unidades cuyo estado de cuenta alcanza el usuario. Cualquier otro rol (personal) → 403. */
export function alcanceEstadoCuenta(u: AuthUser): Prisma.UnidadWhereInput {
  switch (u.rol) {
    case 'superadmin':
      return {};
    case 'admin':
      return scopeUnidades(u);
    case 'inquilino':
      return unidadesDeResidente(u);
    case 'propietario': {
      const propias: Prisma.UnidadWhereInput = unidadesDeResidente(u);
      const a = ambitoJunta(u); // presidente o tesorero: además, las unidades de su block (o de todo su condominio, si no tiene block)
      return a ? { OR: [propias, filtroAmbito(a)] } : propias;
    }
    default:
      throw forbidden();
  }
}

const clave = (m: MesAnio) => m.anio * 12 + m.mes;
const periodo = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, '0')}`;
const soloDia = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** El n.º de operación de un pago: lo que anotó quien pagó o, si no, lo que leyó la IA. Corto y sin saltos de línea (es texto de terceros). */
function operacionDe(referencia: string | null, extraido: unknown): string | null {
  const limpio = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : '');
  const ia = extraido && typeof extraido === 'object' && !Array.isArray(extraido) ? limpio((extraido as Record<string, unknown>).numero_operacion) : '';
  return limpio(referencia) || ia || null;
}

interface Grupo {
  recibo_id: number;
  anio: number;
  mes: number;
  vence: Date;
  cargos: { monto: Dec; estado_pago: string | null; validado: Dec; por_validar: Dec; fecha_pago: Date | null }[];
  conceptos: Map<string, { orden: number; monto: Dec }>;
  pagos: Map<string, { id: number | null; fecha: Date; operacion: string | null; metodo: string | null; monto: Dec; estado: EstadoPagoEECC; principal: boolean }>;
}

/** El estado de cuenta de `unidadId`. `alcance` es el filtro de unidades del usuario (`alcanceEstadoCuenta`): fuera de él, 404. */
export async function estadoCuentaUnidad(alcance: Prisma.UnidadWhereInput, unidadId: number, opts: OpcionesEstadoCuenta = {}): Promise<EstadoCuenta> {
  const unidad = await prisma.unidad.findFirst({
    where: { AND: [{ id: unidadId }, alcance] },
    select: {
      id: true, codigo: true, tipo: true,
      estructura: { select: { id: true, nombre: true } },
      complejo: { select: { id: true, nombre: true, moneda: true, zona_horaria: true, empresa: { select: { nombre: true } } } },
      propietario: { select: { nombre: true } },
      inquilino: { select: { nombre: true } },
    },
  });
  if (!unidad) throw notFound('Unidad'); // una unidad ajena no se distingue de una que no existe
  const zona = unidad.complejo?.zona_horaria ?? ZONA_POR_DEFECTO;
  const moneda = unidad.complejo?.moneda ?? MONEDA_POR_DEFECTO;
  const hoy = opts.hoy ?? hoyEn(zona, opts.ahora ?? new Date());

  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: { unidad_id: unidad.id, reciboConcepto: { recibo_id: { not: null } } },
    select: {
      monto: true,
      estado_pago: true,
      fecha_pago: true,
      pagos: {
        select: {
          id: true, monto: true, estado_validacion: true, fecha_pago: true, referencia: true, metodo_pago: true, grupo: true, grupo_principal: true,
          evaluacion: { select: { extraido: true } },
        },
        orderBy: { id: 'asc' },
      },
      reciboConcepto: { select: { orden: true, concepto: { select: { nombre: true } }, recibo: { select: { id: true, mes: true, anio: true, fecha_vencimiento: true } } } },
    },
  });

  const grupos = new Map<number, Grupo>();
  for (const c of cargos) {
    const recibo = c.reciboConcepto?.recibo;
    if (!recibo) continue;
    let g = grupos.get(recibo.id);
    if (!g) grupos.set(recibo.id, (g = { recibo_id: recibo.id, anio: recibo.anio, mes: recibo.mes, vence: soloDia(recibo.fecha_vencimiento), cargos: [], conceptos: new Map(), pagos: new Map() }));
    const suma = (estado: string) => c.pagos.filter((p) => p.estado_validacion === estado).reduce((a, p) => a.plus(p.monto), dec(0));
    g.cargos.push({ monto: dec(c.monto), estado_pago: c.estado_pago, validado: suma('validado'), por_validar: suma('por_validar'), fecha_pago: c.fecha_pago });
    const nombre = c.reciboConcepto?.concepto?.nombre ?? 'Otros';
    const previo = g.conceptos.get(nombre);
    g.conceptos.set(nombre, { orden: previo?.orden ?? c.reciboConcepto?.orden ?? 0, monto: (previo?.monto ?? dec(0)).plus(c.monto) });
    // Un voucher del mantenimiento son varios `Pago` (uno por cargo) con el mismo `grupo`: se muestra UNO, con la suma. Cada estado va aparte.
    for (const p of c.pagos) {
      const estado: EstadoPagoEECC = p.estado_validacion === 'validado' || p.estado_validacion === 'por_validar' ? p.estado_validacion : 'rechazado';
      const k = `${p.grupo ?? `p${p.id}`}|${estado}`;
      const previoPago = g.pagos.get(k);
      const op = operacionDe(p.referencia, p.evaluacion?.extraido);
      if (!previoPago) g.pagos.set(k, { id: p.id, fecha: p.fecha_pago, operacion: op, metodo: p.metodo_pago, monto: dec(p.monto), estado, principal: p.grupo_principal });
      else {
        previoPago.monto = previoPago.monto.plus(p.monto);
        // Los datos del voucher son los del pago principal del grupo (lleva el comprobante y la evaluación); si no, el primero que los tenga.
        if (p.grupo_principal && !previoPago.principal) Object.assign(previoPago, { id: p.id, fecha: p.fecha_pago, operacion: op ?? previoPago.operacion, metodo: p.metodo_pago, principal: true });
        else if (!previoPago.operacion && op) previoPago.operacion = op;
      }
    }
  }

  // Todos los recibos de la unidad, del más viejo al más nuevo, con su cuenta.
  const todos = [...grupos.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes || a.recibo_id - b.recibo_id);
  const cuentas = new Map(todos.map((g) => [g, sumarCuentas(g.cargos)]));
  const estados = new Map(todos.map((g) => [g, estadoMantenimiento(cuentas.get(g)!, g.vence, hoy)]));

  // Universo = hasta el cierre pedido; ventana = lo que se muestra. Sin rango: todo el historial y los últimos MESES_POR_DEFECTO meses con recibo.
  const universo = opts.hasta ? todos.filter((g) => clave(g) <= clave(opts.hasta!)) : todos;
  let desdeK: number;
  if (opts.desde) desdeK = clave(opts.desde);
  else {
    const recientes = [...new Set(universo.map(clave))].sort((a, b) => b - a).slice(0, MESES_POR_DEFECTO);
    desdeK = recientes.length ? Math.min(...recientes) : 0;
  }
  const anteriores = universo.filter((g) => clave(g) < desdeK);
  const enRango = universo.filter((g) => clave(g) >= desdeK);

  const saldoAnterior = anteriores.reduce((a, g) => a.plus(cuentas.get(g)!.saldo), dec(0));
  let acumulado = saldoAnterior;
  let cargado = dec(0), mora = dec(0), pagado = dec(0), enRevision = dec(0);
  let rechazados = 0;
  const filas: FilaEECC[] = enRango.map((g) => {
    const cuenta = cuentas.get(g)!;
    const conceptos = [...g.conceptos.entries()].sort((a, b) => a[1].orden - b[1].orden).map(([concepto, v]) => ({ concepto, monto: v.monto, es_mora: esConceptoMora(concepto) }));
    const moraFila = conceptos.filter((c) => c.es_mora).reduce((a, c) => a.plus(c.monto), dec(0));
    acumulado = acumulado.plus(cuenta.saldo);
    cargado = cargado.plus(cuenta.total);
    mora = mora.plus(moraFila);
    pagado = pagado.plus(cuenta.cobrado);
    enRevision = enRevision.plus(cuenta.en_revision);

    const pagos: PagoEECC[] = [...g.pagos.values()].map((p) => ({ id: p.id, fecha: diaEn(p.fecha, zona), operacion: p.operacion, metodo: p.metodo, monto: p.monto.toFixed(2), estado: p.estado, sin_detalle: false }));
    // Un cargo marcado «pagado» sin (todos) sus pagos (datos anteriores al flujo de pagos): una línea que cuadra la lista con lo cobrado.
    const listado = [...g.pagos.values()].filter((p) => p.estado === 'validado').reduce((a, p) => a.plus(p.monto), dec(0));
    const falta = dec(cuenta.cobrado).minus(listado);
    if (falta.gt(0)) {
      const fechas = g.cargos.filter((c) => c.estado_pago === 'pagado' && c.fecha_pago).map((c) => c.fecha_pago!.getTime());
      pagos.push({ id: null, fecha: fechas.length ? diaEn(new Date(Math.max(...fechas)), zona) : null, operacion: null, metodo: null, monto: falta.toFixed(2), estado: 'validado', sin_detalle: true });
    }
    pagos.sort((a, b) => (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999') || (a.id ?? 0) - (b.id ?? 0));
    rechazados += pagos.filter((p) => p.estado === 'rechazado').length;

    return {
      recibo_id: g.recibo_id,
      anio: g.anio,
      mes: g.mes,
      periodo: periodo(g.anio, g.mes),
      fecha_vencimiento: g.vence.toISOString().slice(0, 10),
      estado: estados.get(g)!,
      cargo: cuenta.total,
      por_concepto: conceptos.map((c) => ({ concepto: c.concepto, monto: c.monto.toFixed(2), es_mora: c.es_mora })),
      mora: moraFila.toFixed(2),
      pagado: cuenta.cobrado,
      en_revision: cuenta.en_revision,
      saldo: cuenta.saldo,
      saldo_acumulado: acumulado.toFixed(2),
      pagos,
    };
  });

  const vencidos = universo.filter((g) => estados.get(g) === 'vencido');
  return {
    unidad: { id: unidad.id, codigo: unidad.codigo, tipo: unidad.tipo },
    estructura: unidad.estructura,
    condominio: unidad.complejo ? { id: unidad.complejo.id, nombre: unidad.complejo.nombre } : null,
    administradora: unidad.complejo?.empresa?.nombre ?? null,
    propietario: unidad.propietario?.nombre ?? null,
    inquilino: unidad.inquilino?.nombre ?? null,
    moneda,
    zona_horaria: zona,
    fecha_corte: hoy.toISOString().slice(0, 10),
    desde: filas[0]?.periodo ?? null,
    hasta: filas.at(-1)?.periodo ?? null,
    totales: {
      cargado: cargado.toFixed(2),
      mora: mora.toFixed(2),
      pagado: pagado.toFixed(2),
      en_revision: enRevision.toFixed(2),
      saldo_anterior: saldoAnterior.toFixed(2),
      saldo_deudor: acumulado.toFixed(2),
      meses_vencidos: vencidos.length,
      deuda_vencida: vencidos.reduce((a, g) => a.plus(cuentas.get(g)!.saldo), dec(0)).toFixed(2),
      pagos_rechazados: rechazados,
    },
    filas,
  };
}

// ---------- Excel ----------
const dma = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mesTexto = (f: { anio: number; mes: number }) => `${mayuscula(nombreMes(f.mes))} ${f.anio}`;
const ESTADOS_MES: Record<string, string> = { pagado: 'Pagado', en_revision: 'En revisión', parcial: 'Pago parcial', vencido: 'Vencido', pendiente: 'Por pagar' };
const ESTADOS_PAGO: Record<EstadoPagoEECC, string> = { validado: 'Validado', por_validar: 'Por validar', rechazado: 'Rechazado (no suma)' };
/** Los montos van como número de Excel (con 2 decimales) para que se puedan sumar; el servidor no hace cuentas con ellos. */
const num = (v: string) => Number(v);

export const HOJAS_ESTADO_CUENTA = { resumen: 'Resumen', cuenta: 'Cuenta corriente', pagos: 'Pagos' } as const;

/** Un `.xlsx` con las mismas cifras que la pantalla: «Resumen» (cabecera y totales), «Cuenta corriente» (una fila por recibo) y «Pagos» (uno por voucher). */
export function estadoCuentaXlsx(e: EstadoCuenta): Buffer {
  const s = simboloDe(e.moneda);
  const t = e.totales;
  const resumen = XLSX.utils.aoa_to_sheet([
    ['Estado de cuenta', ''],
    ['Condominio', e.condominio?.nombre ?? ''],
    ['Administradora', e.administradora ?? ''],
    ['Block', e.estructura?.nombre ?? ''],
    ['Departamento', e.unidad.codigo],
    ['Propietario', e.propietario ?? ''],
    ['Inquilino', e.inquilino ?? ''],
    ['Fecha de corte', dma(e.fecha_corte)],
    ['Periodo', e.desde && e.hasta ? `${mesTexto({ anio: Number(e.desde.slice(0, 4)), mes: Number(e.desde.slice(5)) })} a ${mesTexto({ anio: Number(e.hasta.slice(0, 4)), mes: Number(e.hasta.slice(5)) })}` : 'Sin recibos'],
    [`Saldo anterior (${s})`, num(t.saldo_anterior)],
    [`Total cargado (${s})`, num(t.cargado)],
    [`  de los cuales mora (${s})`, num(t.mora)],
    [`Total pagado (${s})`, num(t.pagado)],
    [`En revisión (${s})`, num(t.en_revision)],
    [`Saldo deudor (${s})`, num(t.saldo_deudor)],
    ['Meses vencidos', t.meses_vencidos],
    [`Deuda vencida (${s})`, num(t.deuda_vencida)],
    ['Pagos rechazados (no suman)', t.pagos_rechazados],
  ]);
  resumen['!cols'] = [{ wch: 32 }, { wch: 34 }];

  const cuenta = XLSX.utils.aoa_to_sheet([
    ['Mes', 'Conceptos', 'Vence', `Cargo (${s})`, `Mora incluida (${s})`, `Pagado (${s})`, `En revisión (${s})`, `Saldo del mes (${s})`, `Saldo acumulado (${s})`, 'Estado'],
    ...(num(t.saldo_anterior) !== 0 ? [['Saldo anterior', '', '', '', '', '', '', '', num(t.saldo_anterior), '']] : []),
    ...e.filas.map((f) => [
      mesTexto(f),
      f.por_concepto.map((c) => `${c.concepto}: ${s} ${c.monto}`).join('; '),
      dma(f.fecha_vencimiento),
      num(f.cargo), num(f.mora), num(f.pagado), num(f.en_revision), num(f.saldo), num(f.saldo_acumulado),
      ESTADOS_MES[f.estado] ?? f.estado,
    ]),
    ['Total', '', '', num(t.cargado), num(t.mora), num(t.pagado), num(t.en_revision), '', num(t.saldo_deudor), ''],
  ]);
  cuenta['!cols'] = [{ wch: 18 }, { wch: 56 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 14 }];

  const pagos = XLSX.utils.aoa_to_sheet([
    ['Mes', 'Fecha del pago', 'N.º de operación', 'Medio', `Monto (${s})`, 'Estado'],
    ...e.filas.flatMap((f) => f.pagos.map((p) => [mesTexto(f), p.fecha ? dma(p.fecha) : '', p.operacion ?? (p.sin_detalle ? 'Sin detalle de voucher' : ''), p.metodo ?? '', num(p.monto), ESTADOS_PAGO[p.estado]])),
  ]);
  pagos['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 22 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, resumen, HOJAS_ESTADO_CUENTA.resumen);
  XLSX.utils.book_append_sheet(libro, cuenta, HOJAS_ESTADO_CUENTA.cuenta);
  XLSX.utils.book_append_sheet(libro, pagos, HOJAS_ESTADO_CUENTA.pagos);
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
