// Rendición de cuentas del mes: el informe que la administración entrega a la junta o a la asamblea, por block o del condominio completo.
// Todo se CALCULA al pedirlo desde lo que ya existe (recibos y cargos, pagos, cierres de los blocks, cierre de la Junta central, extractos del banco); no se guarda nada.
//  - INGRESOS = lo COBRADO del mes: pagos VALIDADOS cuya fecha de pago (la del voucher) cae en el mes, de cualquier recibo. Se separa «del mes» (el recibo de ese mes), «de meses
//    anteriores» y «adelantado» (recibo de un mes posterior). Los pagos POR VALIDAR se muestran aparte y NO suman; los rechazados no cuentan. «Emitido» = suma de los cargos de los recibos del mes.
//  - EGRESOS = los pagos de los CIERRES del mes (`EgresoBlock` de ese mes de cierre, aunque se paguen el 5 del mes siguiente), con lo facturado, lo pagado y la conformidad.
//    En el condominio completo, el aporte a la Junta central es un traspaso interno (sale del block y entra a la Junta central): se muestra pero no se resta; se suman los egresos de la Junta central.
//  - CUADRE = saldo inicial + ingresos − egresos = saldo final. El saldo inicial NO se carga a mano: es el saldo final del mes anterior calculado igual, y parte de 0 desde el primer mes con datos.
//  - Todo en la zona horaria y la moneda del condominio. Ver docs/API-CONTRATO.md («Rendición de cuentas del mes»).
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { prisma } from '../db';
import { forbidden, invalid, notFound } from '../errors';
import { diaEn, diasEntre, mesesHasta } from '../lib/fechas';
import { ambitoJunta } from '../lib/junta';
import { MESES } from '../lib/periodo';
import { scopeBlocksCierre, scopeCargos, scopeComplejos } from '../lib/scope';
import { relojDeCondominios } from '../lib/zonas';
import { filtroEstadoCargo } from '../lib/cargos';
import type { AuthUser } from '../middleware/auth';
import { calcularBlocks, dinero, fondoAl, mesDeBlock } from './cierres/calculo';
import { calcularCentral } from './cierres/central';
import { DESTINO_ETIQUETA, llevaConformidad } from './cierres/destinos';
import { esAdministracion } from './cierres/permisos';
import { exigirModulo, moduloActivo } from './comercial/modulos';

type D = Prisma.Decimal;
const cero = (): D => new Prisma.Decimal(0);
const clave = (anio: number, mes: number) => anio * 100 + mes;
const LIMITE_MOROSOS = 300;

/** Block de un cargo: el del recibo; si el recibo no tiene block (general o viejo), el de la unidad; si tampoco, `null` («Sin block»). */
type Clave = number | null;
const blockDe = (recibo: number | null | undefined, unidad: number | null | undefined): Clave => recibo ?? unidad ?? null;

export interface ConsultaRendicion { complejo_id?: number; estructura_id?: number; mes?: number; anio?: number }

interface Alcance {
  complejo: { id: number; nombre: string; moneda: string; zona_horaria: string };
  estructura: { id: number; nombre: string | null } | null;
  /** Administración (admin o superadmin): filtra los cargos por la empresa y ve el banco. La junta se acota por su condominio y su block. */
  administracion: boolean;
}

/**
 * Quién pide y de qué. La administración: `complejo_id` obligatorio, de su empresa (otra → 404). La junta: su condominio, y la de un block, SU block
 * (otro block, otro condominio u otra empresa → 404); la Junta central ve el condominio entero o cualquier block de él. Otro rol → 403.
 */
async function resolverAlcance(u: AuthUser, q: ConsultaRendicion): Promise<Alcance> {
  const administracion = esAdministracion(u);
  const junta = ambitoJunta(u);
  if (!administracion && !junta) throw forbidden('La rendición de cuentas la ven la administración y la junta directiva');

  let complejoId: number;
  if (junta) {
    if (q.complejo_id !== undefined && q.complejo_id !== junta.complejo_id) throw notFound('Condominio');
    complejoId = junta.complejo_id;
  } else {
    if (q.complejo_id === undefined) throw invalid('Datos inválidos: complejo_id: es obligatorio', { complejo_id: 'Obligatorio' });
    complejoId = q.complejo_id;
  }
  const complejo = await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id: complejoId }, scopeComplejos(u)] }, select: { id: true, nombre: true, moneda: true, zona_horaria: true } });
  if (!complejo) throw notFound('Condominio');

  let estructuraId = q.estructura_id ?? null;
  if (junta?.estructura_id != null) {
    if (estructuraId !== null && estructuraId !== junta.estructura_id) throw notFound('Block');
    estructuraId = junta.estructura_id; // la junta de un block sólo ve el suyo, lo pida o no
  }
  let estructura: Alcance['estructura'] = null;
  if (estructuraId !== null) {
    const b = await prisma.estructura.findFirst({ where: { AND: [{ id: estructuraId }, { complejo_id: complejo.id }, scopeBlocksCierre(u)] }, select: { id: true, nombre: true } });
    if (!b) throw notFound('Block');
    estructura = b;
  }
  return { complejo, estructura, administracion };
}

// ---------- Tipos de la respuesta ----------
export interface LineaEgreso {
  estructura: { id: number; nombre: string | null };
  linea: string;
  nombre: string;
  destino: string;
  destino_etiqueta: string;
  facturado: string;
  /** null = aún sin pago registrado. */
  pagado: string | null;
  fecha_pago: string | null;
  referencia: string | null;
  estado: 'pagada' | 'por_pagar';
  /** `no_aplica` = esa línea no lleva conformidad (servicios, proveedores). */
  conformidad: 'conforme' | 'sin_conformidad' | 'por_pagar' | 'no_aplica';
}

export interface FilaBlock {
  estructura: { id: number | null; nombre: string };
  emitido: string;
  cobrado: string;
  por_validar: string;
  egresos_pagado: string;
  egresos_facturado: string;
  traspaso_central: string;
  saldo_inicial: string;
  saldo_final: string;
  fondo_ahorros: string;
  unidades_morosas: number;
  deuda_morosa: string;
  pct_cobrado: number | null;
}

export interface Rendicion {
  complejo: { id: number; nombre: string; moneda: string };
  periodo: { mes: number; anio: number; desde: string; hasta: string };
  alcance: 'condominio' | 'block';
  estructura: { id: number; nombre: string | null } | null;
  ingresos: {
    emitido: string;
    cobrado: { total: string; del_mes: string; de_meses_anteriores: string; adelantado: string; pagos: number };
    por_validar: { total: string; pagos: number };
    /** null = no aplica (la junta no ve la conciliación); `activa: false` = el condominio no tiene el módulo. */
    conciliacion: null | { activa: false } | { activa: true; conciliado: string; efectivo: string; sin_conciliar: string };
    /** Sólo en el condominio completo: alquileres y otros ingresos de la Junta central. */
    otros_central: null | { total: string; movimientos: { fecha: string; concepto: string; detalle: string; monto: string }[] };
    total: string;
  };
  egresos: {
    facturado: string;
    pagado: string;
    /** Aporte de los blocks a la Junta central pagado en el mes (traspaso interno en el condominio completo). */
    traspaso_central: string;
    por_pagar: { lineas: number; facturado: string };
    sin_conformidad: { lineas: number; monto: string };
    por_destino: { destino: string; etiqueta: string; facturado: string; pagado: string; lineas: number; sin_registrar: number; sin_conformidad: number }[];
    lineas: LineaEgreso[];
    sin_clasificar: { estructura: { id: number; nombre: string | null }; nombre: string; facturado: string }[];
    /** Sólo en el condominio completo: lo que pagó la Junta central. */
    central: null | { total: string; movimientos: { fecha: string; concepto: string; detalle: string; monto: string }[] };
    total: string;
  };
  cuadre: {
    saldo_inicial: string;
    ingresos: string;
    egresos: string;
    saldo_final: string;
    saldo_inicial_cargado: false;
    /** Primer mes con movimientos: de ahí parte el saldo en 0. null si aún no hay ninguno. */
    primer_mes: { mes: number; anio: number } | null;
    nota: string;
    /** null = no hay extracto con saldo en el mes, o no corresponde mostrarlo (la junta no ve el banco). */
    extracto: null | {
      saldo_banco: string;
      saldo_rendicion: string;
      /** rendición − banco. */
      diferencia: string;
      cuadra: boolean;
      cuentas: { medio_pago_id: number; cuenta: string; extracto_id: number; hasta: string | null; saldo_final: string; saldo_cuadra: boolean | null }[];
    };
  };
  fondos: {
    /** Fondo de ahorros de cada block (acumulado hasta el mes); en un block, sólo el suyo. */
    blocks: { estructura: { id: number; nombre: string | null }; fondo_ahorros: string }[];
    fondo_ahorros_blocks: string;
    central: null | { fondo_ahorros: string; fondo_contingencia: string };
  };
  morosidad: {
    /** «Al día de hoy» (en la zona del condominio): la deuda vencida de los recibos hasta este mes. */
    al: string;
    emitido: string;
    pagado_del_recibo: string;
    pct_cobrado: number | null;
    unidades_morosas: number;
    deuda_total: string;
    deuda_del_mes: string;
    unidades: { unidad: { id: number; codigo: string }; estructura: { id: number; nombre: string | null } | null; deuda: string; meses: number; deuda_del_mes: string; dias_max_atraso: number }[];
    /** Con más de {LIMITE_MOROSOS} morosos la lista se corta (las cifras de arriba son de todos). */
    lista_completa: boolean;
  };
  /** Sólo en el condominio completo: una fila por block (y «Sin block» si hay movimientos sin block). */
  blocks: FilaBlock[] | null;
  generado_at: string;
}

interface Parcial {
  emitido: D;
  emitido_pagado: D;
  cobrado_mes: D;
  cobrado_anteriores: D;
  cobrado_adelantado: D;
  pagos: number;
  por_validar: D;
  pagos_por_validar: number;
  conciliado: D;
  efectivo: D;
  sin_conciliar: D;
  prior_cobrado: D;
  egresos_pagado: D;
  egresos_facturado: D;
  traspaso: D;
  prior_egresos: D;
  prior_traspaso: D;
  fondo: D;
  moroso_deuda: D;
  moroso_del_mes: D;
  morosas: Set<number>;
}
const parcialVacio = (): Parcial => ({
  emitido: cero(), emitido_pagado: cero(), cobrado_mes: cero(), cobrado_anteriores: cero(), cobrado_adelantado: cero(), pagos: 0, por_validar: cero(), pagos_por_validar: 0,
  conciliado: cero(), efectivo: cero(), sin_conciliar: cero(), prior_cobrado: cero(), egresos_pagado: cero(), egresos_facturado: cero(), traspaso: cero(), prior_egresos: cero(), prior_traspaso: cero(),
  fondo: cero(), moroso_deuda: cero(), moroso_del_mes: cero(), morosas: new Set(),
});

const cobradoDe = (p: Parcial): D => p.cobrado_mes.plus(p.cobrado_anteriores).plus(p.cobrado_adelantado);
const pct = (parte: D, todo: D): number | null => (todo.lte(0) ? null : parte.div(todo).times(100).toDecimalPlaces(1).toNumber());
const finDeMes = (anio: number, mes: number): string => new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
const inicioDeMes = (anio: number, mes: number): string => `${anio}-${String(mes).padStart(2, '0')}-01`;
const sumar = (xs: Iterable<D>): D => { let s = cero(); for (const x of xs) s = s.plus(x); return s; };

/** Mismo criterio que la pantalla de cierres: sin periodo pedido, el mes ANTERIOR al de hoy en la zona del condominio. */
function periodoDe(q: ConsultaRendicion, zona: string, ahora: Date): { mes: number; anio: number } {
  if (q.mes !== undefined && q.anio !== undefined) return { mes: q.mes, anio: q.anio };
  const hoy = diaEn(ahora, zona);
  const previo = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 2, 1));
  return { mes: q.mes ?? previo.getUTCMonth() + 1, anio: q.anio ?? previo.getUTCFullYear() };
}

const textoMovimiento = (m: { categoria_etiqueta: string; descripcion: string | null; pagador: string | null; estacionamiento: string | null; proveedor: { razon_social: string } | null; documento: string | null }): string =>
  [m.descripcion, m.estacionamiento, m.pagador, m.proveedor?.razon_social, m.documento].filter(Boolean).join(' · ') || m.categoria_etiqueta;

/** La rendición del mes pedido. Autoriza (403/404), exige el módulo `reportes` (403 `MODULO_NO_ACTIVO`) y calcula. `ahora` se inyecta en las pruebas. */
export async function rendicionDe(u: AuthUser, q: ConsultaRendicion, ahora: Date = new Date()): Promise<Rendicion> {
  const alcance = await resolverAlcance(u, q);
  // Los reportes son del plan Pro (como la morosidad); el superadmin siempre entra. La puerta va DESPUÉS del alcance: otro condominio es 404, no 403.
  if (u.rol !== 'superadmin') await exigirModulo(alcance.complejo.id, 'reportes');
  const { complejo, estructura, administracion } = alcance;
  const complejoId = complejo.id;
  const { mes, anio } = periodoDe(q, complejo.zona_horaria, ahora);
  const [{ desde, hasta }] = mesesHasta(1, anio, mes, complejo.zona_horaria);
  const kMes = clave(anio, mes);
  const enBlock = estructura !== null;

  // ---------- Filtros ----------
  const cargosDe = (bloque: 'todos' | Clave): Prisma.ReciboConceptoUnidadWhereInput => ({
    AND: [
      { reciboConcepto: { recibo: { complejo_id: complejoId } } },
      ...(administracion ? [scopeCargos(u)] : []), // lo cobrado por una administradora anterior no le llega a la nueva (igual que en recibos y pagos)
      ...(bloque === 'todos' ? [] : bloque === null
        ? [{ reciboConcepto: { recibo: { estructura_id: null } } }, { OR: [{ unidad_id: null }, { unidad: { estructura_id: null } }] }]
        : [{ OR: [{ reciboConcepto: { recibo: { estructura_id: bloque } } }, { reciboConcepto: { recibo: { estructura_id: null } }, unidad: { estructura_id: bloque } }] }]),
    ],
  });
  const alcanceBloque: 'todos' | Clave = enBlock ? estructura.id : 'todos';

  const conciliacionActiva = administracion && (u.rol === 'superadmin' || (await moduloActivo(complejoId, 'conciliacion')));

  // ---------- Blocks del condominio (o el único) ----------
  const estructuras = enBlock
    ? [estructura]
    : await prisma.estructura.findMany({
        where: { complejo_id: complejoId, OR: [{ recibos: { some: {} } }, { egresosBlock: { some: {} } }, { unidades: { some: {} } }] },
        select: { id: true, nombre: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      });
  const nombres = new Map<number, string | null>(estructuras.map((b) => [b.id, b.nombre]));
  const parciales = new Map<Clave, Parcial>();
  const de = (k: Clave): Parcial => {
    let p = parciales.get(k);
    if (!p) { p = parcialVacio(); parciales.set(k, p); }
    return p;
  };
  for (const b of estructuras) de(b.id);
  if (!enBlock) de(null);
  const idsBlocks = estructuras.map((b) => b.id);

  // ---------- Emitido del mes (cargos de los recibos de ese mes) ----------
  const emitidos = await prisma.reciboConceptoUnidad.findMany({
    where: { AND: [cargosDe(alcanceBloque), { reciboConcepto: { recibo: { mes, anio } } }] },
    select: { monto: true, estado_pago: true, unidad: { select: { estructura_id: true } }, reciboConcepto: { select: { recibo: { select: { estructura_id: true } } } } },
  });
  for (const c of emitidos) {
    const p = de(blockDe(c.reciboConcepto?.recibo?.estructura_id, c.unidad?.estructura_id));
    p.emitido = p.emitido.plus(c.monto);
    if (c.estado_pago === 'pagado') p.emitido_pagado = p.emitido_pagado.plus(c.monto);
  }

  // ---------- Cobrado del mes: pagos con fecha de voucher en el mes ----------
  const pagos = await prisma.pago.findMany({
    where: { estado_validacion: { in: ['validado', 'por_validar'] }, fecha_pago: { gte: desde, lt: hasta }, reciboConceptoUnidad: cargosDe(alcanceBloque) },
    select: {
      monto: true, estado_validacion: true, grupo: true, metodo_pago: true,
      ...(conciliacionActiva ? { movimientoBancario: { select: { estado: true } } } : {}),
      reciboConceptoUnidad: { select: { unidad: { select: { estructura_id: true } }, reciboConcepto: { select: { recibo: { select: { estructura_id: true, mes: true, anio: true } } } } } },
    },
  });
  let gruposConciliados = new Set<string>();
  if (conciliacionActiva) {
    const grupos = [...new Set(pagos.filter((p) => p.estado_validacion === 'validado' && p.grupo).map((p) => p.grupo!))];
    if (grupos.length) {
      // El abono se vincula al pago principal del grupo: todo el grupo cuenta como conciliado.
      const conciliados = await prisma.pago.findMany({ where: { grupo: { in: grupos }, movimientoBancario: { is: { estado: 'conciliado' } } }, select: { grupo: true } });
      gruposConciliados = new Set(conciliados.map((p) => p.grupo!));
    }
  }
  for (const pg of pagos) {
    const r = pg.reciboConceptoUnidad?.reciboConcepto?.recibo;
    const p = de(blockDe(r?.estructura_id, pg.reciboConceptoUnidad?.unidad?.estructura_id));
    if (pg.estado_validacion === 'por_validar') { p.por_validar = p.por_validar.plus(pg.monto); p.pagos_por_validar += 1; continue; }
    p.pagos += 1;
    const kr = r ? clave(r.anio, r.mes) : kMes; // sin recibo (no debería) cuenta como del mes
    if (kr === kMes) p.cobrado_mes = p.cobrado_mes.plus(pg.monto);
    else if (kr < kMes) p.cobrado_anteriores = p.cobrado_anteriores.plus(pg.monto);
    else p.cobrado_adelantado = p.cobrado_adelantado.plus(pg.monto);
    if (conciliacionActiva) {
      const mb = (pg as { movimientoBancario?: { estado: string } | null }).movimientoBancario;
      const conciliado = mb?.estado === 'conciliado' || (pg.grupo != null && gruposConciliados.has(pg.grupo));
      if (conciliado) p.conciliado = p.conciliado.plus(pg.monto);
      else if (pg.metodo_pago === 'efectivo') p.efectivo = p.efectivo.plus(pg.monto);
      else p.sin_conciliar = p.sin_conciliar.plus(pg.monto);
    }
  }

  // ---------- Cobrado ANTES del mes (para el saldo inicial) ----------
  // Una suma por block, todas en paralelo (antes eran en serie: ≈ 1 consulta por block y ~300 ms en un condominio de 14 blocks).
  const clavesBlocks: Clave[] = [...parciales.keys()];
  const previos = await Promise.all(clavesBlocks.map((k) =>
    prisma.pago.aggregate({ _sum: { monto: true }, where: { estado_validacion: 'validado', fecha_pago: { lt: desde }, reciboConceptoUnidad: cargosDe(enBlock ? alcanceBloque : k) } })));
  clavesBlocks.forEach((k, i) => { de(k).prior_cobrado = new Prisma.Decimal(previos[i]._sum.monto ?? 0); });

  // ---------- Egresos de los cierres de los blocks ----------
  const lineas: LineaEgreso[] = [];
  const sinClasificar: Rendicion['egresos']['sin_clasificar'] = [];
  const calculo = await calcularBlocks(idsBlocks);
  for (const b of estructuras) {
    const meses = calculo.get(b.id)!;
    const cierre = mesDeBlock(meses, b.id, complejoId, anio, mes);
    const p = de(b.id);
    p.fondo = new Prisma.Decimal(fondoAl(meses, anio, mes));
    p.egresos_pagado = new Prisma.Decimal(cierre.pagado_total);
    for (const l of cierre.lineas) {
      const pagado = l.registro ? new Prisma.Decimal(l.registro.monto_pagado) : null;
      if (!l.obsoleta) p.egresos_facturado = p.egresos_facturado.plus(l.facturado);
      if (l.destino === 'central' && pagado) p.traspaso = p.traspaso.plus(pagado);
      lineas.push({
        estructura: { id: b.id, nombre: b.nombre }, linea: l.linea, nombre: l.nombre, destino: String(l.destino), destino_etiqueta: DESTINO_ETIQUETA[l.destino as keyof typeof DESTINO_ETIQUETA] ?? String(l.destino),
        facturado: l.facturado, pagado: l.registro?.monto_pagado ?? null, fecha_pago: l.registro?.fecha_pago ?? null, referencia: l.registro?.referencia ?? null,
        estado: l.registro ? 'pagada' : 'por_pagar',
        conformidad: !llevaConformidad(l.destino) ? 'no_aplica' : !l.registro ? 'por_pagar' : l.registro.conformidad ? 'conforme' : 'sin_conformidad',
      });
    }
    for (const s of cierre.sin_clasificar) sinClasificar.push({ estructura: { id: b.id, nombre: b.nombre }, nombre: s.nombre, facturado: s.facturado });
  }
  if (idsBlocks.length) {
    const previos = await prisma.egresoBlock.groupBy({
      by: ['estructura_id', 'destino'],
      where: { estructura_id: { in: idsBlocks }, OR: [{ anio: { lt: anio } }, { anio, mes: { lt: mes } }] },
      _sum: { monto_pagado: true },
    });
    for (const g of previos) {
      const p = de(g.estructura_id);
      const m = new Prisma.Decimal(g._sum.monto_pagado ?? 0);
      p.prior_egresos = p.prior_egresos.plus(m);
      if (g.destino === 'central') p.prior_traspaso = p.prior_traspaso.plus(m);
    }
  }

  // ---------- Junta central (sólo el condominio completo) ----------
  let central: Awaited<ReturnType<typeof calcularCentral>> | null = null;
  const centralPrevio = { ingresos: cero(), egresos: cero() };
  if (!enBlock) {
    central = await calcularCentral(complejoId, anio, mes);
    const previos = await prisma.movimientoCentral.groupBy({ by: ['tipo'], where: { complejo_id: complejoId, OR: [{ anio: { lt: anio } }, { anio, mes: { lt: mes } }] }, _sum: { monto: true } });
    for (const g of previos) {
      const m = new Prisma.Decimal(g._sum.monto ?? 0);
      if (g.tipo === 'ingreso') centralPrevio.ingresos = centralPrevio.ingresos.plus(m); else centralPrevio.egresos = centralPrevio.egresos.plus(m);
    }
  }

  // ---------- Morosidad (a hoy, recibos hasta este mes) ----------
  const reloj = await relojDeCondominios(ahora, { id: complejoId });
  const hoy = reloj.hoy(complejo.zona_horaria);
  const vencidos = await prisma.reciboConceptoUnidad.findMany({
    where: {
      AND: [
        cargosDe(alcanceBloque), filtroEstadoCargo('vencido', reloj), { unidad_id: { not: null } },
        { reciboConcepto: { recibo: { OR: [{ anio: { lt: anio } }, { anio, mes: { lte: mes } }] } } },
      ],
    },
    select: { monto: true, unidad: { select: { id: true, codigo: true, estructura_id: true } }, reciboConcepto: { select: { recibo: { select: { mes: true, anio: true, estructura_id: true, fecha_vencimiento: true } } } } },
  });
  const porUnidad = new Map<number, { codigo: string; estructura_id: number | null; deuda: D; del_mes: D; meses: Set<number>; dias: number }>();
  for (const c of vencidos) {
    const un = c.unidad!;
    const r = c.reciboConcepto?.recibo;
    const p = de(blockDe(r?.estructura_id, un.estructura_id));
    const delMes = !!r && clave(r.anio, r.mes) === kMes;
    p.moroso_deuda = p.moroso_deuda.plus(c.monto);
    if (delMes) p.moroso_del_mes = p.moroso_del_mes.plus(c.monto);
    p.morosas.add(un.id);
    const u0 = porUnidad.get(un.id) ?? { codigo: un.codigo, estructura_id: un.estructura_id, deuda: cero(), del_mes: cero(), meses: new Set<number>(), dias: 0 };
    u0.deuda = u0.deuda.plus(c.monto);
    if (delMes) u0.del_mes = u0.del_mes.plus(c.monto);
    if (r) { u0.meses.add(clave(r.anio, r.mes)); if (r.fecha_vencimiento) u0.dias = Math.max(u0.dias, diasEntre(r.fecha_vencimiento, hoy)); }
    porUnidad.set(un.id, u0);
  }

  // Nombres de los blocks que aparecieron sólo por sus cargos o pagos.
  const faltan = [...new Set([...parciales.keys(), ...[...porUnidad.values()].map((x) => x.estructura_id)].filter((k): k is number => k != null && !nombres.has(k)))];
  if (faltan.length) for (const b of await prisma.estructura.findMany({ where: { id: { in: faltan }, complejo_id: complejoId }, select: { id: true, nombre: true } })) nombres.set(b.id, b.nombre);

  // ---------- Extracto del banco ----------
  const todos = [...parciales.values()];
  const suma = (f: (p: Parcial) => D): D => sumar(todos.map(f));
  const emitido = suma((p) => p.emitido);
  const cobrado = { del_mes: suma((p) => p.cobrado_mes), anteriores: suma((p) => p.cobrado_anteriores), adelantado: suma((p) => p.cobrado_adelantado) };
  const cobradoTotal = cobrado.del_mes.plus(cobrado.anteriores).plus(cobrado.adelantado);
  const traspaso = suma((p) => p.traspaso);
  const pagadoBlocks = suma((p) => p.egresos_pagado);

  const otrosCentral = central ? new Prisma.Decimal(central.ingresos.otros.total) : cero();
  const egresosCentral = central ? new Prisma.Decimal(central.egresos.total) : cero();
  // Condominio completo: el aporte a la Junta central es un traspaso interno (no sale del condominio); block: es un egreso más.
  const ingresosTotal = cobradoTotal.plus(otrosCentral);
  const egresosTotal = enBlock ? pagadoBlocks : pagadoBlocks.minus(traspaso).plus(egresosCentral);
  const saldoInicial = enBlock
    ? de(estructura.id).prior_cobrado.minus(de(estructura.id).prior_egresos)
    : suma((p) => p.prior_cobrado.minus(p.prior_egresos).plus(p.prior_traspaso)).plus(centralPrevio.ingresos).minus(centralPrevio.egresos);
  const saldoFinal = saldoInicial.plus(ingresosTotal).minus(egresosTotal);

  const extracto = administracion && conciliacionActiva ? await compararConExtracto({ complejoId, estructuraId: estructura?.id ?? null, desde, hasta, saldoFinal }) : null;
  const primerMes = await primerMesConDatos({ complejoId, estructuraId: estructura?.id ?? null, cargos: cargosDe(alcanceBloque), zona: complejo.zona_horaria, conCentral: !enBlock });

  // ---------- Egresos por destino ----------
  const destinos = new Map<string, { destino: string; etiqueta: string; f: D; p: D; lineas: number; sin_registrar: number; sin_conformidad: number }>();
  for (const l of lineas) {
    const x = destinos.get(l.destino) ?? { destino: l.destino, etiqueta: l.destino_etiqueta, f: cero(), p: cero(), lineas: 0, sin_registrar: 0, sin_conformidad: 0 };
    x.f = x.f.plus(l.facturado);
    if (l.pagado) x.p = x.p.plus(l.pagado);
    x.lineas += 1;
    if (l.estado === 'por_pagar') x.sin_registrar += 1;
    if (l.conformidad === 'sin_conformidad') x.sin_conformidad += 1;
    destinos.set(l.destino, x);
  }
  const ORDEN: Record<string, number> = { administradora: 0, central: 1, servicio: 2, proveedor: 3 };
  const porDestinoFilas = [...destinos.values()].sort((a, b) => (ORDEN[a.destino] ?? 9) - (ORDEN[b.destino] ?? 9)).map((x) => ({ destino: x.destino, etiqueta: x.etiqueta, facturado: dinero(x.f), pagado: dinero(x.p), lineas: x.lineas, sin_registrar: x.sin_registrar, sin_conformidad: x.sin_conformidad }));
  const porPagar = lineas.filter((l) => l.estado === 'por_pagar');
  const sinConformidad = lineas.filter((l) => l.conformidad === 'sin_conformidad');

  // ---------- Morosidad: totales y lista ----------
  const morosas = new Set<number>();
  for (const p of todos) for (const id of p.morosas) morosas.add(id);
  const filasMorosas = [...porUnidad.entries()]
    .map(([id, x]) => ({ unidad: { id, codigo: x.codigo }, estructura: x.estructura_id != null ? { id: x.estructura_id, nombre: nombres.get(x.estructura_id) ?? null } : null, deuda: x.deuda, meses: x.meses.size, deuda_del_mes: x.del_mes, dias_max_atraso: x.dias }))
    .sort((a, b) => b.deuda.comparedTo(a.deuda) || a.unidad.codigo.localeCompare(b.unidad.codigo, 'es', { numeric: true }) || a.unidad.id - b.unidad.id);

  const sumaConc = (f: (p: Parcial) => D) => dinero(suma(f));
  const rendicion: Rendicion = {
    complejo: { id: complejo.id, nombre: complejo.nombre, moneda: complejo.moneda },
    periodo: { mes, anio, desde: inicioDeMes(anio, mes), hasta: finDeMes(anio, mes) },
    alcance: enBlock ? 'block' : 'condominio',
    estructura: estructura ? { id: estructura.id, nombre: estructura.nombre } : null,
    ingresos: {
      emitido: dinero(emitido),
      cobrado: { total: dinero(cobradoTotal), del_mes: dinero(cobrado.del_mes), de_meses_anteriores: dinero(cobrado.anteriores), adelantado: dinero(cobrado.adelantado), pagos: todos.reduce((s, p) => s + p.pagos, 0) },
      por_validar: { total: dinero(suma((p) => p.por_validar)), pagos: todos.reduce((s, p) => s + p.pagos_por_validar, 0) },
      conciliacion: !administracion ? null : conciliacionActiva ? { activa: true, conciliado: sumaConc((p) => p.conciliado), efectivo: sumaConc((p) => p.efectivo), sin_conciliar: sumaConc((p) => p.sin_conciliar) } : { activa: false },
      otros_central: central ? { total: dinero(otrosCentral), movimientos: central.ingresos.otros.movimientos.map((m) => ({ fecha: m.fecha, concepto: m.categoria_etiqueta, detalle: textoMovimiento(m), monto: m.monto })) } : null,
      total: dinero(ingresosTotal),
    },
    egresos: {
      facturado: dinero(suma((p) => p.egresos_facturado)),
      pagado: dinero(pagadoBlocks),
      traspaso_central: dinero(traspaso),
      por_pagar: { lineas: porPagar.length, facturado: dinero(sumar(porPagar.map((l) => new Prisma.Decimal(l.facturado)))) },
      sin_conformidad: { lineas: sinConformidad.length, monto: dinero(sumar(sinConformidad.map((l) => new Prisma.Decimal(l.pagado ?? 0)))) },
      por_destino: porDestinoFilas,
      lineas,
      sin_clasificar: sinClasificar,
      central: central ? { total: dinero(egresosCentral), movimientos: central.egresos.movimientos.map((m) => ({ fecha: m.fecha, concepto: m.categoria_etiqueta, detalle: textoMovimiento(m), monto: m.monto })) } : null,
      total: dinero(egresosTotal),
    },
    cuadre: {
      saldo_inicial: dinero(saldoInicial),
      ingresos: dinero(ingresosTotal),
      egresos: dinero(egresosTotal),
      saldo_final: dinero(saldoFinal),
      saldo_inicial_cargado: false,
      primer_mes: primerMes,
      nota: primerMes
        ? `Sin saldo inicial cargado: el saldo parte de ${dinero(0)} en ${MESES[primerMes.mes - 1]} de ${primerMes.anio} (el primer mes con movimientos) y se encadena mes a mes: el saldo inicial de este mes es el saldo final del anterior.`
        : 'Sin saldo inicial cargado: aún no hay movimientos, el saldo parte de 0.',
      extracto,
    },
    fondos: {
      blocks: estructuras.map((b) => ({ estructura: { id: b.id, nombre: b.nombre }, fondo_ahorros: dinero(de(b.id).fondo) })),
      fondo_ahorros_blocks: dinero(suma((p) => p.fondo)),
      central: central ? { fondo_ahorros: central.fondo_ahorros, fondo_contingencia: central.fondo_contingencia } : null,
    },
    morosidad: {
      al: hoy.toISOString().slice(0, 10),
      emitido: dinero(emitido),
      pagado_del_recibo: dinero(suma((p) => p.emitido_pagado)),
      pct_cobrado: pct(suma((p) => p.emitido_pagado), emitido),
      unidades_morosas: morosas.size,
      deuda_total: dinero(suma((p) => p.moroso_deuda)),
      deuda_del_mes: dinero(suma((p) => p.moroso_del_mes)),
      unidades: filasMorosas.slice(0, LIMITE_MOROSOS).map((f) => ({ ...f, deuda: dinero(f.deuda), deuda_del_mes: dinero(f.deuda_del_mes) })),
      lista_completa: filasMorosas.length <= LIMITE_MOROSOS,
    },
    blocks: enBlock ? null : [...parciales.entries()]
      .filter(([k, p]) => k !== null || tieneMovimiento(p))
      .map(([k, p]) => ({
        estructura: { id: k, nombre: k === null ? 'Sin block' : nombres.get(k) ?? 'Block' },
        emitido: dinero(p.emitido), cobrado: dinero(cobradoDe(p)), por_validar: dinero(p.por_validar),
        egresos_pagado: dinero(p.egresos_pagado), egresos_facturado: dinero(p.egresos_facturado), traspaso_central: dinero(p.traspaso),
        saldo_inicial: dinero(p.prior_cobrado.minus(p.prior_egresos)), saldo_final: dinero(p.prior_cobrado.minus(p.prior_egresos).plus(cobradoDe(p)).minus(p.egresos_pagado)),
        fondo_ahorros: dinero(p.fondo), unidades_morosas: p.morosas.size, deuda_morosa: dinero(p.moroso_deuda), pct_cobrado: pct(p.emitido_pagado, p.emitido),
      }))
      .sort((a, b) => (a.estructura.id === null ? 1 : 0) - (b.estructura.id === null ? 1 : 0) || String(a.estructura.nombre).localeCompare(String(b.estructura.nombre), 'es', { numeric: true })),
    generado_at: ahora.toISOString(),
  };
  return rendicion;
}

const tieneMovimiento = (p: Parcial): boolean =>
  [p.emitido, p.cobrado_mes, p.cobrado_anteriores, p.cobrado_adelantado, p.por_validar, p.prior_cobrado, p.moroso_deuda].some((x) => !x.isZero());

// ---------- Extracto del banco ----------
const enmascarar = (banco: string | null, numero: string | null): string => [banco ?? 'Cuenta', numero ? `···${numero.replace(/\D/g, '').slice(-4)}` : null].filter(Boolean).join(' ');

/**
 * El último extracto de cada cuenta que cierra en el mes y trae saldo; en un block, sólo las cuentas de ese block. El saldo del banco es la suma de esos saldos
 * finales; la diferencia es rendición − banco. Sin ningún extracto con saldo en el mes → null (no hay con qué comparar).
 */
async function compararConExtracto(p: { complejoId: number; estructuraId: number | null; desde: Date; hasta: Date; saldoFinal: D }): Promise<NonNullable<Rendicion['cuadre']['extracto']> | null> {
  const extractos = await prisma.extractoBancario.findMany({
    where: { complejo_id: p.complejoId, saldo_final: { not: null }, fecha_hasta: { gte: p.desde, lt: p.hasta }, ...(p.estructuraId !== null ? { medioPago: { estructura_id: p.estructuraId } } : {}) },
    select: { id: true, medio_pago_id: true, fecha_hasta: true, saldo_final: true, saldo_cuadra: true, medioPago: { select: { banco: true, numero_cuenta: true } } },
    orderBy: [{ fecha_hasta: 'desc' }, { id: 'desc' }],
  });
  const porCuenta = new Map<number, (typeof extractos)[number]>();
  for (const e of extractos) if (!porCuenta.has(e.medio_pago_id)) porCuenta.set(e.medio_pago_id, e);
  if (!porCuenta.size) return null;
  const cuentas = [...porCuenta.values()].map((e) => ({ medio_pago_id: e.medio_pago_id, cuenta: enmascarar(e.medioPago.banco, e.medioPago.numero_cuenta), extracto_id: e.id, hasta: e.fecha_hasta ? e.fecha_hasta.toISOString().slice(0, 10) : null, saldo_final: dinero(e.saldo_final!), saldo_cuadra: e.saldo_cuadra }));
  const banco = sumar(cuentas.map((c) => new Prisma.Decimal(c.saldo_final)));
  const dif = p.saldoFinal.minus(banco);
  return { saldo_banco: dinero(banco), saldo_rendicion: dinero(p.saldoFinal), diferencia: dinero(dif), cuadra: dif.abs().lt(0.005), cuentas };
}

/** El primer mes (zona del condominio) con un pago validado, un pago de cierre o un movimiento de la Junta central: de ahí parte el saldo en 0. */
async function primerMesConDatos(p: { complejoId: number; estructuraId: number | null; cargos: Prisma.ReciboConceptoUnidadWhereInput; zona: string; conCentral: boolean }): Promise<{ mes: number; anio: number } | null> {
  const [pago, egreso, mov] = await Promise.all([
    prisma.pago.findFirst({ where: { estado_validacion: 'validado', reciboConceptoUnidad: p.cargos }, orderBy: { fecha_pago: 'asc' }, select: { fecha_pago: true } }),
    prisma.egresoBlock.findFirst({ where: { complejo_id: p.complejoId, ...(p.estructuraId !== null ? { estructura_id: p.estructuraId } : {}) }, orderBy: [{ anio: 'asc' }, { mes: 'asc' }], select: { anio: true, mes: true } }),
    p.conCentral ? prisma.movimientoCentral.findFirst({ where: { complejo_id: p.complejoId }, orderBy: [{ anio: 'asc' }, { mes: 'asc' }], select: { anio: true, mes: true } }) : null,
  ]);
  const candidatos: { mes: number; anio: number }[] = [];
  if (pago) { const d = diaEn(pago.fecha_pago, p.zona); candidatos.push({ anio: Number(d.slice(0, 4)), mes: Number(d.slice(5, 7)) }); }
  if (egreso) candidatos.push(egreso);
  if (mov) candidatos.push(mov);
  return candidatos.sort((a, b) => clave(a.anio, a.mes) - clave(b.anio, b.mes))[0] ?? null;
}

// ---------- Excel ----------
export function nombreArchivoRendicion(r: Pick<Rendicion, 'estructura' | 'periodo' | 'complejo'>): string {
  const limpio = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${['rendicion', limpio(r.estructura?.nombre ?? r.complejo.nombre), limpio(MESES[r.periodo.mes - 1] ?? String(r.periodo.mes)), String(r.periodo.anio)].filter(Boolean).join('-')}.xlsx`;
}

type Celda = string | number | null | { t: 'n'; v: number; z: string };
const num = (s: string | number): Celda => ({ t: 'n', v: Number(s), z: '#,##0.00' });
const SI_NO = (b: boolean) => (b ? 'Sí' : 'No');

/** El libro de la rendición: una hoja por sección (Ingresos, Egresos, Cuadre, Fondos, Morosidad) y, en el condominio completo, «Por block». Los montos van como números. */
export function libroRendicion(r: Rendicion): Buffer {
  const mes = MESES[r.periodo.mes - 1] ?? String(r.periodo.mes);
  const cabecera = (seccion: string): Celda[][] => [
    [`Rendición de cuentas · ${seccion}`],
    [r.complejo.nombre, r.estructura?.nombre ?? 'Condominio completo'],
    [`${mes.charAt(0).toUpperCase()}${mes.slice(1)} de ${r.periodo.anio}`, `Montos en ${r.complejo.moneda}`],
    [],
  ];
  const hoja = (nombre: string, filas: Celda[][], anchos: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(filas as XLSX.CellObject[][] as never);
    ws['!cols'] = anchos.map((wch) => ({ wch }));
    return [nombre, ws] as const;
  };
  const i = r.ingresos;
  const e = r.egresos;
  const c = r.cuadre;

  const ingresos: Celda[][] = [
    ...cabecera('Ingresos'),
    ['Concepto', 'Monto'],
    ['Emitido del mes (recibos)', num(i.emitido)],
    ['Cobrado del mes (pagos validados con fecha de voucher en el mes)', num(i.cobrado.total)],
    ['   · de recibos del mes', num(i.cobrado.del_mes)],
    ['   · de meses anteriores', num(i.cobrado.de_meses_anteriores)],
    ['   · adelantado (recibos de meses posteriores)', num(i.cobrado.adelantado)],
    ['Pagos por validar (no suman)', num(i.por_validar.total)],
    ...(i.otros_central ? [['Otros ingresos de la Junta central', num(i.otros_central.total)] as Celda[]] : []),
    ['Total de ingresos', num(i.total)],
    [],
    ...(i.conciliacion && i.conciliacion.activa
      ? [['Conciliado con el banco', num(i.conciliacion.conciliado)], ['En efectivo (no se concilia)', num(i.conciliacion.efectivo)], ['Cobrado sin conciliar', num(i.conciliacion.sin_conciliar)]] as Celda[][]
      : []),
    ...(i.otros_central?.movimientos.length ? [[], ['Ingresos de la Junta central', 'Detalle', 'Monto'], ...i.otros_central.movimientos.map((m) => [m.fecha, `${m.concepto} · ${m.detalle}`, num(m.monto)] as Celda[])] : []),
  ];

  const egresos: Celda[][] = [
    ...cabecera('Egresos'),
    ['Block', 'Línea', 'Destino', 'Facturado', 'Pagado', 'Fecha de pago', 'Referencia', 'Estado', 'Conformidad'],
    ...e.lineas.map((l): Celda[] => [
      l.estructura.nombre ?? '', l.nombre, l.destino_etiqueta, num(l.facturado), l.pagado === null ? null : num(l.pagado), l.fecha_pago, l.referencia,
      l.estado === 'pagada' ? 'Pagada' : 'Por pagar',
      ({ conforme: 'Con conformidad', sin_conformidad: 'Sin conformidad', por_pagar: 'Por pagar', no_aplica: 'No aplica' } as const)[l.conformidad],
    ]),
    [],
    ['Total facturado', null, null, num(e.facturado)],
    ['Total pagado', null, null, null, num(e.pagado)],
    ...(e.central ? [['Aporte a la Junta central (traspaso interno, no se resta)', null, null, null, num(e.traspaso_central)] as Celda[], ['Egresos de la Junta central', null, null, null, num(e.central.total)] as Celda[]] : []),
    ['Total de egresos', null, null, null, num(e.total)],
    ...(e.central?.movimientos.length ? [[], ['Fecha', 'Concepto', 'Detalle', null, 'Monto'], ...e.central.movimientos.map((m) => [m.fecha, m.concepto, m.detalle, null, num(m.monto)] as Celda[])] : []),
    ...(e.sin_clasificar.length ? [[], ['Conceptos sin clasificar (no entran al cierre)'], ...e.sin_clasificar.map((s) => [s.estructura.nombre ?? '', s.nombre, null, num(s.facturado)] as Celda[])] : []),
  ];

  const cuadre: Celda[][] = [
    ...cabecera('Cuadre'),
    ['Concepto', 'Monto'],
    ['Saldo inicial', num(c.saldo_inicial)],
    ['+ Ingresos', num(c.ingresos)],
    ['− Egresos', num(c.egresos)],
    ['Saldo final', num(c.saldo_final)],
    [],
    [c.nota],
    ...(c.extracto
      ? [[], ['Comparación con el extracto del banco'], ['Saldo según la rendición', num(c.extracto.saldo_rendicion)], ['Saldo del banco (último extracto del mes)', num(c.extracto.saldo_banco)], ['Diferencia', num(c.extracto.diferencia)], ['¿Cuadra?', SI_NO(c.extracto.cuadra)],
        ...c.extracto.cuentas.map((x): Celda[] => [`${x.cuenta} · al ${x.hasta ?? '—'}`, num(x.saldo_final)])] as Celda[][]
      : []),
  ];

  const fondos: Celda[][] = [
    ...cabecera('Fondos'),
    ['Fondo de ahorros de cada block', 'Monto'],
    ...r.fondos.blocks.map((b): Celda[] => [b.estructura.nombre ?? 'Block', num(b.fondo_ahorros)]),
    ['Total fondos de los blocks', num(r.fondos.fondo_ahorros_blocks)],
    ...(r.fondos.central ? [[], ['Fondo de ahorros de la Junta central', num(r.fondos.central.fondo_ahorros)], ['Fondo de contingencia del condominio', num(r.fondos.central.fondo_contingencia)]] as Celda[][] : []),
  ];

  const m = r.morosidad;
  const morosidad: Celda[][] = [
    ...cabecera('Morosidad'),
    [`Al ${m.al} · recibos hasta este mes`],
    ['Emitido del mes', num(m.emitido)],
    ['Pagado de los recibos del mes', num(m.pagado_del_recibo)],
    ['% cobrado', m.pct_cobrado === null ? '—' : `${m.pct_cobrado}%`],
    ['Departamentos morosos', m.unidades_morosas],
    ['Deuda vencida total', num(m.deuda_total)],
    ['   · del mes', num(m.deuda_del_mes)],
    [],
    ['Departamento', 'Block', 'Meses vencidos', 'Días de atraso', 'Deuda del mes', 'Deuda total'],
    ...m.unidades.map((x): Celda[] => [x.unidad.codigo, x.estructura?.nombre ?? '', x.meses, x.dias_max_atraso, num(x.deuda_del_mes), num(x.deuda)]),
    ...(m.lista_completa ? [] : [[`La lista muestra los ${LIMITE_MOROSOS} de mayor deuda; las cifras de arriba son de todos.`] as Celda[]]),
  ];

  const hojas = [
    hoja('Ingresos', ingresos, [58, 16, 16]),
    hoja('Egresos', egresos, [16, 34, 28, 14, 14, 14, 16, 12, 18]),
    hoja('Cuadre', cuadre, [58, 18]),
    hoja('Fondos', fondos, [42, 18]),
    hoja('Morosidad', morosidad, [34, 18, 14, 14, 16, 16]),
  ];
  if (r.blocks) {
    const filas: Celda[][] = [
      ...cabecera('Por block'),
      ['Block', 'Emitido', 'Cobrado', 'Por validar', 'Egresos pagados', 'Aporte a la Junta central', 'Saldo inicial', 'Saldo final', 'Fondo de ahorros', 'Morosos', 'Deuda morosa', '% cobrado'],
      ...r.blocks.map((b): Celda[] => [b.estructura.nombre, num(b.emitido), num(b.cobrado), num(b.por_validar), num(b.egresos_pagado), num(b.traspaso_central), num(b.saldo_inicial), num(b.saldo_final), num(b.fondo_ahorros), b.unidades_morosas, num(b.deuda_morosa), b.pct_cobrado === null ? '—' : `${b.pct_cobrado}%`]),
    ];
    hojas.push(hoja('Por block', filas, [18, 14, 14, 14, 16, 18, 14, 14, 16, 10, 14, 10]));
  }
  const wb = XLSX.utils.book_new();
  for (const [nombre, ws] of hojas) XLSX.utils.book_append_sheet(wb, ws, nombre);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
