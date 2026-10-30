// Cierre del mes de un block. Todo sale de los recibos y de lo que la junta registró; nada se guarda calculado (salvo la foto de `facturado` al registrar).
//  - FACTURADO de un concepto = suma de los cargos (`ReciboConceptoUnidad.monto`) de ese concepto en el recibo del block de ese mes.
//  - COBRADO = lo mismo, sólo de los cargos ya pagados (el pago se validó).
//  - Líneas por pagar: la empresa administradora (lo facturado), la Junta central (lo facturado), el agua y la luz (por la boleta) y los proveedores (por la factura).
//  - AHORRO del mes = lo cobrado de los conceptos con destino «ahorro del block» y de las multas por pago fuera de fecha (recargos): no se paga a nadie.
//  - SOBRANTE del mes = cobrado (sin lo de ahorro) − pagado ese mes. Fondo de ahorros del block = suma de (ahorro + sobrante) de los meses con todas sus líneas registradas.
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { esDestino, lineaDe, llevaConformidad, LINEA_NOMBRE, type Destino } from './destinos';

const cero = () => new Prisma.Decimal(0);
export const dinero = (d: Prisma.Decimal.Value): string => new Prisma.Decimal(d).toFixed(2);
export const diaISO = (f: Date): string => f.toISOString().slice(0, 10);
const clave = (anio: number, mes: number) => anio * 100 + mes;

export type EstadoCierre = 'sin_recibo' | 'pendiente' | 'por_clasificar' | 'sin_conformidad' | 'cerrado';

export interface RegistroLinea {
  id: number;
  monto_pagado: string;
  fecha_pago: string;
  referencia: string | null;
  observaciones: string | null;
  registrado_por: { id: number; nombre: string } | null;
  created_at: Date;
  voucher: { nombre: string; tipo_mime: string; tamano: number } | null;
  conformidad: { at: Date; por: { id: number; nombre: string } | null } | null;
}

export interface CuentaDestino { banco: string | null; tipo: string | null; numero: string | null; cci: string | null; titular: string | null }

export interface LineaCierre {
  /** `administradora` | `central` | `concepto:<id>`. */
  linea: string;
  destino: Destino | string;
  concepto_id: number | null;
  nombre: string;
  proveedor: { id: number; razon_social: string; cuenta: CuentaDestino } | null;
  facturado: string;
  cobrado: string;
  /** Qué conceptos del recibo la componen (una línea a la Junta central junta varios). */
  detalle: { nombre: string; facturado: string }[];
  registro: RegistroLinea | null;
  /** Registro de una línea que ya no existe (se cambió el destino del concepto después de pagar): se conserva y cuenta en lo pagado. */
  obsoleta: boolean;
}

export interface ConceptoSinLinea { concepto_id: number; nombre: string; facturado: string; cobrado: string }

export interface CierreMes {
  estructura_id: number;
  complejo_id: number | null;
  anio: number;
  mes: number;
  hay_recibo: boolean;
  lineas: LineaCierre[];
  /** Lo que va al Fondo de ahorros del block (multas, fondo de contingencia del block): lo facturado y lo cobrado, por concepto. No se paga a nadie. */
  ahorro: { facturado: string; cobrado: string; conceptos: { nombre: string; facturado: string }[] };
  /** Conceptos del recibo sin destino: la administración debe clasificarlos antes de cerrar el mes. */
  sin_clasificar: ConceptoSinLinea[];
  facturado_total: string;
  cobrado_total: string;
  pagado_total: string;
  /** Lo cobrado de multas y del fondo de contingencia del block: entra al Fondo de ahorros. */
  ahorro_mes: string;
  /** Cobrado (sin lo de ahorro) − pagado ese mes. */
  sobrante_mes: string;
  estado: EstadoCierre;
  /** Todas las líneas ya tienen su pago registrado (y no hay conceptos sin clasificar): ahorro y sobrante del mes entran al Fondo de ahorros del block. */
  registrado_completo: boolean;
  lineas_total: number;
  lineas_pagadas: number;
}

interface Acc {
  destino: Destino;
  concepto_id: number | null;
  nombre: string;
  proveedor: { id: number; razon_social: string; cuenta: CuentaDestino } | null;
  facturado: Prisma.Decimal;
  cobrado: Prisma.Decimal;
  detalle: Map<string, Prisma.Decimal>;
}

const suma = (m: Map<string, Prisma.Decimal>, k: string, v: Prisma.Decimal) => m.set(k, (m.get(k) ?? cero()).plus(v));
const detalleDe = (m: Map<string, Prisma.Decimal>) => [...m].map(([nombre, f]) => ({ nombre, facturado: dinero(f) }));

const ORDEN_DESTINO: Record<string, number> = { administradora: 0, central: 1, servicio: 2, proveedor: 3 };

export const cuentaDe = (x: { cuenta_banco: string | null; cuenta_tipo: string | null; cuenta_numero: string | null; cuenta_cci: string | null; cuenta_titular: string | null }): CuentaDestino =>
  ({ banco: x.cuenta_banco, tipo: x.cuenta_tipo, numero: x.cuenta_numero, cci: x.cuenta_cci, titular: x.cuenta_titular });

function registroDe(e: EgresoCargado): RegistroLinea {
  return {
    id: e.id,
    monto_pagado: dinero(e.monto_pagado),
    fecha_pago: diaISO(e.fecha_pago),
    referencia: e.referencia,
    observaciones: e.observaciones,
    registrado_por: e.registrado_por,
    created_at: e.created_at,
    voucher: e.voucher,
    conformidad: e.conformidad_at ? { at: e.conformidad_at, por: e.conformidad_por } : null,
  };
}

const incluirEgreso = {
  registrado_por: { select: { id: true, nombre: true } },
  conformidad_por: { select: { id: true, nombre: true } },
  voucher: { select: { nombre: true, tipo_mime: true, tamano: true } },
  concepto: { select: { nombre: true } },
} as const;
type EgresoCargado = Prisma.EgresoBlockGetPayload<{ include: typeof incluirEgreso }>;
export const incluirEgresoCierre = incluirEgreso;
export const registroDeEgreso = registroDe;

export interface MesesDeBlock {
  /** Del más antiguo al más nuevo. */
  meses: CierreMes[];
}

/**
 * Los cierres de TODOS los meses de cada block dado (los que tienen recibo o algún pago registrado). Pocas consultas en lote: una por recibos, conceptos,
 * sumas de cargos y egresos; nunca una por unidad.
 */
export async function calcularBlocks(estructuraIds: number[]): Promise<Map<number, MesesDeBlock>> {
  const salida = new Map<number, MesesDeBlock>(estructuraIds.map((id) => [id, { meses: [] }]));
  if (!estructuraIds.length) return salida;

  const recibos = await prisma.recibo.findMany({ where: { estructura_id: { in: estructuraIds } }, select: { id: true, estructura_id: true, complejo_id: true, mes: true, anio: true } });
  const reciboPor = new Map(recibos.map((r) => [r.id, r]));
  const rcs = recibos.length
    ? await prisma.reciboConcepto.findMany({
        where: { recibo_id: { in: [...reciboPor.keys()] }, concepto_id: { not: null } },
        select: { id: true, recibo_id: true, es_recargo: true, concepto: { select: { id: true, nombre: true, destino: true, proveedor: { select: { id: true, razon_social: true, cuenta_banco: true, cuenta_tipo: true, cuenta_numero: true, cuenta_cci: true, cuenta_titular: true } } } } },
      })
    : [];
  const sumas = rcs.length
    ? await prisma.reciboConceptoUnidad.groupBy({ by: ['recibo_concepto_id', 'estado_pago'], where: { recibo_concepto_id: { in: rcs.map((r) => r.id) } }, _sum: { monto: true } })
    : [];
  const facturadoDe = new Map<number, { facturado: Prisma.Decimal; cobrado: Prisma.Decimal }>();
  for (const s of sumas) {
    if (s.recibo_concepto_id == null) continue;
    const x = facturadoDe.get(s.recibo_concepto_id) ?? { facturado: cero(), cobrado: cero() };
    const m = s._sum.monto ?? cero();
    facturadoDe.set(s.recibo_concepto_id, { facturado: x.facturado.plus(m), cobrado: s.estado_pago === 'pagado' ? x.cobrado.plus(m) : x.cobrado });
  }
  const egresos = await prisma.egresoBlock.findMany({ where: { estructura_id: { in: estructuraIds } }, include: incluirEgreso, orderBy: { id: 'asc' } });

  // Agrupa por (block, año, mes).
  interface Mes { estructura_id: number; complejo_id: number | null; anio: number; mes: number; hay_recibo: boolean; lineas: Map<string, Acc>; ahorro: { f: Prisma.Decimal; c: Prisma.Decimal; det: Map<string, Prisma.Decimal> }; sin: Map<number, { nombre: string; f: Prisma.Decimal; c: Prisma.Decimal }>; egresos: EgresoCargado[] }
  const meses = new Map<string, Mes>();
  const mesDe = (estructura_id: number, complejo_id: number | null, anio: number, mes: number): Mes => {
    const k = `${estructura_id}|${clave(anio, mes)}`;
    let m = meses.get(k);
    if (!m) { m = { estructura_id, complejo_id, anio, mes, hay_recibo: false, lineas: new Map(), ahorro: { f: cero(), c: cero(), det: new Map() }, sin: new Map(), egresos: [] }; meses.set(k, m); }
    return m;
  };
  for (const r of recibos) if (r.estructura_id != null) mesDe(r.estructura_id, r.complejo_id, r.anio, r.mes).hay_recibo = true;
  for (const rc of rcs) {
    const r = rc.recibo_id == null ? undefined : reciboPor.get(rc.recibo_id);
    const c = rc.concepto;
    if (!r || r.estructura_id == null || !c) continue;
    const m = mesDe(r.estructura_id, r.complejo_id, r.anio, r.mes);
    const x = facturadoDe.get(rc.id) ?? { facturado: cero(), cobrado: cero() };
    // Un recargo es la multa por pago fuera de fecha: siempre va al Fondo de ahorros, sea cual sea el destino de su concepto.
    const destino = rc.es_recargo ? 'ahorro_block' : esDestino(c.destino) ? c.destino : null;
    if (destino === 'ahorro_block') {
      m.ahorro.f = m.ahorro.f.plus(x.facturado); m.ahorro.c = m.ahorro.c.plus(x.cobrado); suma(m.ahorro.det, c.nombre, x.facturado);
    } else if (destino) {
      const linea = lineaDe(destino, c.id)!;
      const a = m.lineas.get(linea) ?? { destino, concepto_id: linea.startsWith('concepto:') ? c.id : null, nombre: LINEA_NOMBRE[linea] ?? c.nombre, proveedor: destino === 'proveedor' && c.proveedor ? { id: c.proveedor.id, razon_social: c.proveedor.razon_social, cuenta: cuentaDe(c.proveedor) } : null, facturado: cero(), cobrado: cero(), detalle: new Map() };
      a.facturado = a.facturado.plus(x.facturado); a.cobrado = a.cobrado.plus(x.cobrado); suma(a.detalle, c.nombre, x.facturado);
      m.lineas.set(linea, a);
    } else {
      const s = m.sin.get(c.id) ?? { nombre: c.nombre, f: cero(), c: cero() };
      m.sin.set(c.id, { nombre: s.nombre, f: s.f.plus(x.facturado), c: s.c.plus(x.cobrado) });
    }
  }
  for (const e of egresos) mesDe(e.estructura_id, e.complejo_id, e.anio, e.mes).egresos.push(e);

  for (const m of meses.values()) {
    const porLinea = new Map(m.egresos.map((e) => [e.linea, e]));
    const usadas = new Set<string>();
    const lineas: LineaCierre[] = [...m.lineas].sort(([ka, a], [kb, b]) => (ORDEN_DESTINO[a.destino] ?? 9) - (ORDEN_DESTINO[b.destino] ?? 9) || a.nombre.localeCompare(b.nombre, 'es') || ka.localeCompare(kb)).map(([linea, a]) => {
      const e = porLinea.get(linea);
      if (e) usadas.add(linea);
      return { linea, destino: a.destino, concepto_id: a.concepto_id, nombre: a.nombre, proveedor: a.proveedor, facturado: dinero(a.facturado), cobrado: dinero(a.cobrado), detalle: detalleDe(a.detalle), registro: e ? registroDe(e) : null, obsoleta: false };
    });
    for (const e of m.egresos) {
      if (usadas.has(e.linea)) continue;
      lineas.push({ linea: e.linea, destino: e.destino, concepto_id: e.concepto_id, nombre: LINEA_NOMBRE[e.linea] ?? e.concepto?.nombre ?? 'Línea anterior', proveedor: null, facturado: dinero(e.facturado), cobrado: '0.00', detalle: [], registro: registroDe(e), obsoleta: true });
    }
    const vivas = lineas.filter((l) => !l.obsoleta);
    const sinPago = vivas.filter((l) => !l.registro);
    const facturado = [...m.lineas.values()].reduce((s, a) => s.plus(a.facturado), m.ahorro.f);
    const cobrado = [...m.lineas.values()].reduce((s, a) => s.plus(a.cobrado), m.ahorro.c);
    const sinClasificar = [...m.sin].map(([concepto_id, s]) => ({ concepto_id, nombre: s.nombre, facturado: dinero(s.f), cobrado: dinero(s.c) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const facturadoTotal = sinClasificar.reduce((s, x) => s.plus(x.facturado), facturado);
    const cobradoTotal = sinClasificar.reduce((s, x) => s.plus(x.cobrado), cobrado);
    const pagado = m.egresos.reduce((s, e) => s.plus(e.monto_pagado), cero());
    const completo = m.hay_recibo && sinPago.length === 0 && sinClasificar.length === 0;
    let estado: EstadoCierre;
    if (!m.hay_recibo) estado = 'sin_recibo';
    else if (sinPago.length) estado = 'pendiente';
    else if (sinClasificar.length) estado = 'por_clasificar';
    else if (vivas.some((l) => llevaConformidad(l.destino) && !l.registro?.conformidad)) estado = 'sin_conformidad';
    else estado = 'cerrado';
    salida.get(m.estructura_id)!.meses.push({
      estructura_id: m.estructura_id, complejo_id: m.complejo_id, anio: m.anio, mes: m.mes, hay_recibo: m.hay_recibo, lineas,
      ahorro: { facturado: dinero(m.ahorro.f), cobrado: dinero(m.ahorro.c), conceptos: detalleDe(m.ahorro.det) },
      sin_clasificar: sinClasificar,
      facturado_total: dinero(facturadoTotal), cobrado_total: dinero(cobradoTotal), pagado_total: dinero(pagado), ahorro_mes: dinero(m.ahorro.c), sobrante_mes: dinero(cobradoTotal.minus(m.ahorro.c).minus(pagado)),
      estado, registrado_completo: completo, lineas_total: vivas.length, lineas_pagadas: vivas.length - sinPago.length,
    });
  }
  for (const b of salida.values()) b.meses.sort((a, b2) => clave(a.anio, a.mes) - clave(b2.anio, b2.mes));
  return salida;
}

/** Fondo de ahorros del block al cierre de ese mes: suma de (ahorro + sobrante) de los meses ya registrados por completo, hasta ese mes inclusive. */
export function fondoAl(b: MesesDeBlock, anio: number, mes: number): string {
  return dinero(b.meses.filter((m) => m.registrado_completo && clave(m.anio, m.mes) <= clave(anio, mes)).reduce((s, m) => s.plus(m.ahorro_mes).plus(m.sobrante_mes), cero()));
}

/** El mes pedido de un block (aunque no tenga recibo: queda `sin_recibo`). */
export function mesDeBlock(b: MesesDeBlock, estructuraId: number, complejoId: number | null, anio: number, mes: number): CierreMes {
  return b.meses.find((m) => m.anio === anio && m.mes === mes) ?? {
    estructura_id: estructuraId, complejo_id: complejoId, anio, mes, hay_recibo: false, lineas: [], ahorro: { facturado: '0.00', cobrado: '0.00', conceptos: [] }, sin_clasificar: [],
    facturado_total: '0.00', cobrado_total: '0.00', pagado_total: '0.00', ahorro_mes: '0.00', sobrante_mes: '0.00', estado: 'sin_recibo', registrado_completo: false, lineas_total: 0, lineas_pagadas: 0,
  };
}
