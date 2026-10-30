// Cierre del mes de la Junta central (a nivel condominio; el de cada block está en `calculo.ts`). Todo sale de lo registrado; nada se guarda calculado.
//  - INGRESOS = los aportes de los blocks (`EgresoBlock` con destino `central`) que el tesorero central ya confirmó, SIN la parte del fondo de contingencia del condominio
//    (que va aparte), más los ingresos manuales (`MovimientoCentral` tipo `ingreso`: alquiler de estacionamiento y otros). Los aportes aún sin conformidad se muestran aparte
//    y no cuentan hasta que llega la conformidad.
//  - EGRESOS = lo registrado (`MovimientoCentral` tipo `egreso`: servicios con su boleta, proveedores con su factura, otros).
//  - SALDO del mes = ingresos − egresos. Fondo de ahorros de la Junta central = suma de los saldos de todos los meses hasta el pedido (inclusive).
//  - FONDO DE CONTINGENCIA del condominio = lo confirmado de los conceptos «de contingencia» dentro del aporte de cada block (en proporción a lo transferido), acumulado.
//  - «Blocks que aún no aportan» = los blocks con aporte a la Junta central ese mes y sin pago registrado.
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { calcularBlocks, diaISO, dinero, incluirEgresoCierre, mesDeBlock, type MesesDeBlock, type RegistroLinea } from './calculo';
import { LINEA_CENTRAL } from './destinos';

export const CATEGORIAS_INGRESO = ['alquiler_estacionamiento', 'otro_ingreso'] as const;
export const CATEGORIAS_EGRESO = ['servicio', 'proveedor', 'otro_egreso'] as const;
export const CATEGORIAS = [...CATEGORIAS_INGRESO, ...CATEGORIAS_EGRESO] as const;
export type CategoriaCentral = (typeof CATEGORIAS)[number];

export const CATEGORIA_ETIQUETA: Record<CategoriaCentral, string> = {
  alquiler_estacionamiento: 'Alquiler de estacionamiento',
  otro_ingreso: 'Otro ingreso',
  servicio: 'Pago de servicios (agua, luz)',
  proveedor: 'Proveedor de áreas comunes',
  otro_egreso: 'Otro egreso',
};

export const esIngreso = (c: string): boolean => (CATEGORIAS_INGRESO as readonly string[]).includes(c);

const plano = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
/** El concepto del recibo que es el fondo de contingencia del condominio (por su nombre: «FONDO DE CONTINGENCIA DEL CONDOMINIO»). */
export const esFondoContingencia = (nombre: string): boolean => /\bcontingencia\b/.test(plano(nombre));

const cero = () => new Prisma.Decimal(0);
const clave = (anio: number, mes: number) => anio * 100 + mes;

export const incluirMovimiento = {
  registrado_por: { select: { id: true, nombre: true } },
  proveedor: { select: { id: true, razon_social: true } },
  voucher: { select: { nombre: true, tipo_mime: true, tamano: true } },
} as const;
type MovimientoCargado = Prisma.MovimientoCentralGetPayload<{ include: typeof incluirMovimiento }>;

export interface MovimientoVista {
  id: number;
  tipo: 'ingreso' | 'egreso';
  categoria: string;
  categoria_etiqueta: string;
  mes: number;
  anio: number;
  descripcion: string | null;
  pagador: string | null;
  estacionamiento: string | null;
  proveedor: { id: number; razon_social: string } | null;
  documento: string | null;
  monto: string;
  fecha: string;
  referencia: string | null;
  observaciones: string | null;
  registrado_por: { id: number; nombre: string } | null;
  created_at: Date;
  voucher: { nombre: string; tipo_mime: string; tamano: number } | null;
}

export function movimientoDe(m: MovimientoCargado): MovimientoVista {
  return {
    id: m.id,
    tipo: m.tipo as 'ingreso' | 'egreso',
    categoria: m.categoria,
    categoria_etiqueta: CATEGORIA_ETIQUETA[m.categoria as CategoriaCentral] ?? m.categoria,
    mes: m.mes,
    anio: m.anio,
    descripcion: m.descripcion,
    pagador: m.pagador,
    estacionamiento: m.estacionamiento,
    proveedor: m.proveedor,
    documento: m.documento,
    monto: dinero(m.monto),
    fecha: diaISO(m.fecha),
    referencia: m.referencia,
    observaciones: m.observaciones,
    registrado_por: m.registrado_por,
    created_at: m.created_at,
    voucher: m.voucher,
  };
}

export type EstadoAporte = 'sin_registrar' | 'sin_conformidad' | 'conforme';

export interface AporteBlock {
  estructura: { id: number; nombre: string | null };
  facturado: string;
  registro: RegistroLinea | null;
  estado: EstadoAporte;
}

export type EstadoCentral = 'sin_blocks' | 'faltan_aportes' | 'falta_conformidad' | 'al_dia';

export interface CierreCentral {
  complejo_id: number;
  anio: number;
  mes: number;
  estado: EstadoCentral;
  ingresos: {
    aportes: { confirmados: string; fondo_contingencia: string; por_confirmar: string; blocks: AporteBlock[] };
    otros: { total: string; movimientos: MovimientoVista[] };
    total: string;
  };
  egresos: { total: string; movimientos: MovimientoVista[] };
  saldo_mes: string;
  /** Acumulado de los saldos de todos los meses hasta este (inclusive), sin el fondo de contingencia. */
  fondo_ahorros: string;
  /** Fondo de contingencia del condominio: lo aportado por ese concepto (confirmado) en este mes y acumulado hasta este mes. */
  fondo_contingencia_mes: string;
  fondo_contingencia: string;
  /** Blocks con aporte a la Junta central este mes y sin pago registrado. */
  blocks_sin_aportar: { id: number; nombre: string | null; facturado: string }[];
}

interface Mes { aportes: Prisma.Decimal; fondo: Prisma.Decimal; otros: Prisma.Decimal; egresos: Prisma.Decimal }

/** Parte de un aporte que corresponde al fondo de contingencia: la proporción de ese concepto en lo facturado de la línea, aplicada a lo transferido. */
function parteFondo(b: MesesDeBlock | undefined, anio: number, mes: number, monto: Prisma.Decimal): Prisma.Decimal {
  const l = b?.meses.find((m) => m.anio === anio && m.mes === mes)?.lineas.find((x) => x.linea === LINEA_CENTRAL && !x.obsoleta);
  if (!l) return cero();
  const total = new Prisma.Decimal(l.facturado);
  if (total.lte(0)) return cero();
  const fondo = l.detalle.filter((d) => esFondoContingencia(d.nombre)).reduce((s, d) => s.plus(d.facturado), cero());
  return fondo.isZero() ? cero() : monto.times(fondo).div(total).toDecimalPlaces(2);
}

/** El cierre central del mes pedido, con los acumulados de todos los meses anteriores. */
export async function calcularCentral(complejoId: number, anio: number, mes: number): Promise<CierreCentral> {
  const blocks = await prisma.estructura.findMany({
    where: { complejo_id: complejoId, OR: [{ recibos: { some: {} } }, { egresosBlock: { some: {} } }] },
    select: { id: true, nombre: true },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
  });
  const calculo = await calcularBlocks(blocks.map((b) => b.id));
  const aportes = await prisma.egresoBlock.findMany({ where: { complejo_id: complejoId, destino: LINEA_CENTRAL }, include: incluirEgresoCierre, orderBy: { id: 'asc' } });
  const movimientos = await prisma.movimientoCentral.findMany({ where: { complejo_id: complejoId }, include: incluirMovimiento, orderBy: [{ fecha: 'asc' }, { id: 'asc' }] });

  const meses = new Map<number, Mes>();
  const de = (a: number, m: number): Mes => {
    const k = clave(a, m);
    let x = meses.get(k);
    if (!x) { x = { aportes: cero(), fondo: cero(), otros: cero(), egresos: cero() }; meses.set(k, x); }
    return x;
  };
  let porConfirmar = cero();
  for (const e of aportes) {
    const monto = new Prisma.Decimal(e.monto_pagado);
    if (!e.conformidad_at) { if (e.anio === anio && e.mes === mes) porConfirmar = porConfirmar.plus(monto); continue; }
    const fondo = parteFondo(calculo.get(e.estructura_id), e.anio, e.mes, monto);
    const x = de(e.anio, e.mes);
    x.fondo = x.fondo.plus(fondo);
    x.aportes = x.aportes.plus(monto.minus(fondo));
  }
  for (const m of movimientos) {
    const x = de(m.anio, m.mes);
    if (m.tipo === 'ingreso') x.otros = x.otros.plus(m.monto); else x.egresos = x.egresos.plus(m.monto);
  }

  const hasta = clave(anio, mes);
  let fondoAhorros = cero();
  let fondoContingencia = cero();
  for (const [k, x] of meses) {
    if (k > hasta) continue;
    fondoAhorros = fondoAhorros.plus(x.aportes).plus(x.otros).minus(x.egresos);
    fondoContingencia = fondoContingencia.plus(x.fondo);
  }
  const actual = meses.get(hasta) ?? { aportes: cero(), fondo: cero(), otros: cero(), egresos: cero() };

  const filas: AporteBlock[] = [];
  for (const b of blocks) {
    const l = mesDeBlock(calculo.get(b.id)!, b.id, complejoId, anio, mes).lineas.find((x) => x.linea === LINEA_CENTRAL);
    if (!l || (!l.registro && (l.obsoleta || new Prisma.Decimal(l.facturado).lte(0)))) continue;
    filas.push({ estructura: b, facturado: l.facturado, registro: l.registro, estado: !l.registro ? 'sin_registrar' : l.registro.conformidad ? 'conforme' : 'sin_conformidad' });
  }
  const sinAportar = filas.filter((f) => f.estado === 'sin_registrar').map((f) => ({ id: f.estructura.id, nombre: f.estructura.nombre, facturado: f.facturado }));
  const delMes = (tipo: string) => movimientos.filter((m) => m.tipo === tipo && m.anio === anio && m.mes === mes).map(movimientoDe);
  const estado: EstadoCentral = !filas.length ? 'sin_blocks' : sinAportar.length ? 'faltan_aportes' : filas.some((f) => f.estado === 'sin_conformidad') ? 'falta_conformidad' : 'al_dia';
  const ingresosTotal = actual.aportes.plus(actual.otros);
  return {
    complejo_id: complejoId, anio, mes, estado,
    ingresos: {
      aportes: { confirmados: dinero(actual.aportes), fondo_contingencia: dinero(actual.fondo), por_confirmar: dinero(porConfirmar), blocks: filas },
      otros: { total: dinero(actual.otros), movimientos: delMes('ingreso') },
      total: dinero(ingresosTotal),
    },
    egresos: { total: dinero(actual.egresos), movimientos: delMes('egreso') },
    saldo_mes: dinero(ingresosTotal.minus(actual.egresos)),
    fondo_ahorros: dinero(fondoAhorros),
    fondo_contingencia_mes: dinero(actual.fondo),
    fondo_contingencia: dinero(fondoContingencia),
    blocks_sin_aportar: sinAportar,
  };
}
