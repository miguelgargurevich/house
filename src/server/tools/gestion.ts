// Etapa 1 · herramientas de gestión: administrador, junta (sólo su ámbito) y superadmin. El alcance sale de `lib/scope.ts` y `lib/junta.ts`,
// los mismos que usan las APIs: otra empresa o fuera del ámbito de la junta simplemente no existe.
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { estadoCargo, filtroEstadoCargo, noPagado } from '../lib/cargos';
import { hoyEn, medianocheEn, mesesHasta } from '../lib/fechas';
import { pagoEnMes, relojDeCondominios, relojDeRecibos, zonaDeUsuario, type Reloj } from '../lib/zonas';
import { ambitoJunta, filtroAmbito, filtroReciboAmbito } from '../lib/junta';
import {
  empresaDe, scopeCargos, scopeComplejos, scopeMediosPago, scopeNotificaciones, scopePagos, scopePagosJunta, scopeRecibos, scopeTareas, scopeUnidades,
} from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { camposDePago } from '../services/mediosPago';
import { z } from '../validation';
import {
  cortar, dato, defineHerramienta, fechaDia, fechaIsoSchema, idPositivo, instante, monto, nombreCorto, paginacion, pagina, paginarLista, periodoDe, periodoSchema,
  respuesta, sinAcceso, textoCorto,
} from './base';

// ---------- Alcance ----------
export interface Alcance {
  tipo: 'plataforma' | 'empresa' | 'junta';
  cargos: Prisma.ReciboConceptoUnidadWhereInput;
  pagos: Prisma.PagoWhereInput;
  unidades: Prisma.UnidadWhereInput;
  recibos: Prisma.ReciboWhereInput;
  complejos: Prisma.ComplejoHabitacionalWhereInput;
  medios: Prisma.MedioPagoWhereInput;
}

/** Alcance de gestión del usuario; lanza 403 si no es admin/superadmin ni junta con ámbito (o un admin sin empresa). */
export function alcanceGestion(u: AuthUser): Alcance {
  if (u.rol === 'superadmin') return { tipo: 'plataforma', cargos: {}, pagos: {}, unidades: {}, recibos: {}, complejos: {}, medios: {} };
  if (u.rol === 'admin') {
    empresaDe(u); // 403 si no tiene empresa
    return { tipo: 'empresa', cargos: scopeCargos(u), pagos: scopePagos(u), unidades: scopeUnidades(u), recibos: scopeRecibos(u), complejos: scopeComplejos(u), medios: scopeMediosPago(u) };
  }
  const a = ambitoJunta(u);
  if (!a) throw sinAcceso();
  return {
    tipo: 'junta',
    cargos: { unidad: filtroAmbito(a) },
    pagos: scopePagosJunta(u),
    unidades: filtroAmbito(a),
    recibos: filtroReciboAmbito(a),
    complejos: { id: a.complejo_id },
    medios: scopeMediosPago(u),
  };
}

const ALCANCE_TEXTO = { plataforma: 'toda la plataforma', empresa: 'tu empresa', junta: 'tu ámbito de junta' } as const;
const GESTION = ['admin', 'superadmin'] as const;

const dia = (s: string) => new Date(`${s}T00:00:00-05:00`);
/** Rango de días de Lima: desde 00:00 del primero hasta (sin incluir) 00:00 del día siguiente al último. */
function rangoFechas(desde?: string, hasta?: string): Prisma.DateTimeFilter | undefined {
  if (!desde && !hasta) return undefined;
  return { ...(desde ? { gte: dia(desde) } : {}), ...(hasta ? { lt: new Date(dia(hasta).getTime() + 86_400_000) } : {}) };
}
const rangoVence = (desde?: string, hasta?: string): Prisma.DateTimeFilter | undefined =>
  desde || hasta ? { ...(desde ? { gte: new Date(`${desde}T00:00:00Z`) } : {}), ...(hasta ? { lte: new Date(`${hasta}T00:00:00Z`) } : {}) } : undefined;
const porPeriodo = (periodo?: string): Prisma.ReciboConceptoUnidadWhereInput =>
  periodo ? { reciboConcepto: { recibo: { anio: Number(periodo.slice(0, 4)), mes: Number(periodo.slice(5, 7)) } } } : {};
const porUnidad = (codigo?: string): Prisma.ReciboConceptoUnidadWhereInput => (codigo ? { unidad: { codigo: { equals: codigo, mode: 'insensitive' } } } : {});

/** Filtros de ubicación de las herramientas de cobranza: condominio y block (ids de `condominios_y_blocks`). Se suman al alcance, nunca lo amplían. */
const ubicacion = {
  condominio_id: idPositivo.optional().describe('Filtra por condominio (id de `condominios_y_blocks`).'),
  estructura_id: idPositivo.optional().describe('Filtra por block (id de `condominios_y_blocks`).'),
};
type Ubicacion = { condominio_id?: number; estructura_id?: number };
const unidadEn = (e: Ubicacion): Prisma.UnidadWhereInput => ({ ...(e.condominio_id ? { complejo_id: e.condominio_id } : {}), ...(e.estructura_id ? { estructura_id: e.estructura_id } : {}) });
const cargosEn = (e: Ubicacion): Prisma.ReciboConceptoUnidadWhereInput => (e.condominio_id || e.estructura_id ? { unidad: unidadEn(e) } : {});
const pagosEn = (e: Ubicacion): Prisma.PagoWhereInput => (e.condominio_id || e.estructura_id ? { reciboConceptoUnidad: { unidad: unidadEn(e) } } : {});

const ESTADOS_CARGO = ['pagado', 'pendiente', 'vencido', 'en_revision'] as const;
const ESTADOS_PAGO = ['por_validar', 'validado', 'rechazado'] as const;

const selectCargo = {
  id: true,
  monto: true,
  estado_pago: true,
  unidad: { select: { codigo: true, complejo: { select: { nombre: true } }, estructura: { select: { nombre: true } } } },
  reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { mes: true, anio: true, fecha_vencimiento: true, complejo: { select: { zona_horaria: true } } } } } },
} satisfies Prisma.ReciboConceptoUnidadSelect;
type CargoFila = Prisma.ReciboConceptoUnidadGetPayload<{ select: typeof selectCargo }>;
/** `reloj`: el «hoy» de cada cargo es el de la zona del condominio de su recibo. */
const filaCargo = (reloj: Reloj) => (c: CargoFila) => ({
  id: c.id,
  unidad: dato(c.unidad?.codigo, 30),
  condominio: dato(c.unidad?.complejo?.nombre),
  block: dato(c.unidad?.estructura?.nombre),
  concepto: dato(c.reciboConcepto?.concepto?.nombre),
  periodo: periodoDe(c.reciboConcepto?.recibo?.anio, c.reciboConcepto?.recibo?.mes),
  monto: monto(c.monto),
  estado: estadoCargo(c.estado_pago, c.reciboConcepto?.recibo?.fecha_vencimiento, reloj.hoy(c.reciboConcepto?.recibo?.complejo?.zona_horaria)),
  vencimiento: fechaDia(c.reciboConcepto?.recibo?.fecha_vencimiento),
});

const selectPago = {
  id: true,
  monto: true,
  fecha_pago: true,
  metodo_pago: true,
  referencia: true,
  estado_validacion: true,
  validado_por_ia: true,
  usuario: { select: { nombre: true } },
  evaluacion: { select: { estado: true, veredicto: true } },
  reciboConceptoUnidad: { select: { unidad: { select: { codigo: true, complejo: { select: { nombre: true } }, estructura: { select: { nombre: true } } } }, reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { mes: true, anio: true } } } } } },
} satisfies Prisma.PagoSelect;
type PagoFila = Prisma.PagoGetPayload<{ select: typeof selectPago }>;
const filaPago = (p: PagoFila) => ({
  id: p.id,
  unidad: dato(p.reciboConceptoUnidad?.unidad?.codigo, 30),
  condominio: dato(p.reciboConceptoUnidad?.unidad?.complejo?.nombre),
  block: dato(p.reciboConceptoUnidad?.unidad?.estructura?.nombre),
  concepto: dato(p.reciboConceptoUnidad?.reciboConcepto?.concepto?.nombre),
  periodo: periodoDe(p.reciboConceptoUnidad?.reciboConcepto?.recibo?.anio, p.reciboConceptoUnidad?.reciboConcepto?.recibo?.mes),
  monto: monto(p.monto),
  fecha_pago: instante(p.fecha_pago),
  metodo: dato(p.metodo_pago, 30),
  referencia: dato(p.referencia, 40),
  estado: p.estado_validacion,
  registrado_por: nombreCorto(p.usuario?.nombre),
  validado_por_ia: p.validado_por_ia,
  lectura_ia: p.evaluacion ? { estado: p.evaluacion.estado, veredicto: dato(p.evaluacion.veredicto, 30) } : null,
});

/** Suma de montos por concepto-de-recibo y estado (un solo groupBy; luego se junta en memoria). */
async function sumasPorRC(where: Prisma.ReciboConceptoUnidadWhereInput) {
  const g = await prisma.reciboConceptoUnidad.groupBy({ by: ['recibo_concepto_id', 'estado_pago'], where, _sum: { monto: true }, _count: { _all: true } });
  const m = new Map<number, { emitido: Prisma.Decimal; cobrado: Prisma.Decimal; cargos: number; pagados: number }>();
  for (const f of g) {
    if (f.recibo_concepto_id == null) continue;
    const x = m.get(f.recibo_concepto_id) ?? { emitido: new Prisma.Decimal(0), cobrado: new Prisma.Decimal(0), cargos: 0, pagados: 0 };
    const s = f._sum.monto ?? new Prisma.Decimal(0);
    x.emitido = x.emitido.plus(s);
    x.cargos += f._count._all;
    if (f.estado_pago === 'pagado') { x.cobrado = x.cobrado.plus(s); x.pagados += f._count._all; }
    m.set(f.recibo_concepto_id, x);
  }
  return m;
}
const sumaDe = (v: { _sum: { monto: Prisma.Decimal | null } }) => v._sum.monto;
const pct = (parte: Prisma.Decimal, todo: Prisma.Decimal) => (todo.isZero() ? null : parte.div(todo).mul(100).toFixed(1));

// ---------- Herramientas ----------
export const resumenCobranza = defineHerramienta({
  nombre: 'resumen_cobranza',
  descripcion:
    'Resumen de la cobranza: emitido, cobrado, por cobrar, vencido, cargos por estado, unidades morosas y pagos por validar. Úsala para «¿cómo vamos con la cobranza?», «¿cuánto nos deben?» o «¿cuánto se cobró en septiembre?». ' +
    'Sin `periodo` es el acumulado de todos los recibos; con `periodo` (AAAA-MM) solo los recibos de ese mes. Cada block tiene su propio recibo: con `estructura_id` (o `condominio_id`) los números son solo de ese block. Ejemplo: {"periodo":"2026-09","estructura_id":3}.',
  entrada: z.strictObject({ periodo: periodoSchema.optional().describe('Mes de los recibos, AAAA-MM. Omítelo para el acumulado.'), ...ubicacion }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const F: Prisma.ReciboConceptoUnidadWhereInput = { AND: [al.cargos, porPeriodo(e.periodo), cargosEn(e)] };
    const con = (x: Prisma.ReciboConceptoUnidadWhereInput) => ({ AND: [F, x] });
    const reloj = await relojDeCondominios();
    const [emitido, cobrado, porCobrar, vencido, conteos, morosos, porValidar] = await Promise.all([
      prisma.reciboConceptoUnidad.aggregate({ where: F, _sum: { monto: true } }),
      prisma.reciboConceptoUnidad.aggregate({ where: con(filtroEstadoCargo('pagado', reloj)), _sum: { monto: true } }),
      prisma.reciboConceptoUnidad.aggregate({ where: con(noPagado), _sum: { monto: true } }),
      prisma.reciboConceptoUnidad.aggregate({ where: con(filtroEstadoCargo('vencido', reloj)), _sum: { monto: true }, _count: { _all: true } }),
      Promise.all(ESTADOS_CARGO.map((s) => prisma.reciboConceptoUnidad.count({ where: con(filtroEstadoCargo(s, reloj)) }))),
      prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: con(filtroEstadoCargo('vencido', reloj)) }),
      prisma.pago.count({ where: { AND: [al.pagos, pagosEn(e), { estado_validacion: 'por_validar' }] } }),
    ]);
    const em = new Prisma.Decimal(sumaDe(emitido) ?? 0);
    const co = new Prisma.Decimal(sumaDe(cobrado) ?? 0);
    return respuesta({
      alcance: ALCANCE_TEXTO[al.tipo],
      periodo: e.periodo ? periodoDe(Number(e.periodo.slice(0, 4)), Number(e.periodo.slice(5, 7))) : 'acumulado',
      emitido: monto(em),
      cobrado: monto(co),
      por_cobrar: monto(sumaDe(porCobrar)),
      porcentaje_cobrado: pct(co, em),
      vencido: { monto: monto(sumaDe(vencido)), cargos: vencido._count._all },
      cargos_por_estado: Object.fromEntries(ESTADOS_CARGO.map((s, i) => [s, conteos[i]])),
      unidades_morosas: morosos.length,
      pagos_por_validar: porValidar,
    });
  },
});

export const morosos = defineHerramienta({
  nombre: 'morosos',
  descripcion:
    'Lista de unidades morosas (con cargos vencidos): deuda vencida, cantidad de cargos y vencimiento más antiguo. Úsala para «¿quiénes deben?», «los 10 que más deben» o «morosos del Block B». ' +
    'Ordena por deuda (mayor primero por omisión). Ejemplo: {"deuda_minima":"500","orden":"deuda_desc","limite":10}.',
  entrada: z.strictObject({
    condominio_id: idPositivo.optional().describe('Filtra por condominio (id de `condominios_y_blocks`).'),
    estructura_id: idPositivo.optional().describe('Filtra por block (id de `condominios_y_blocks`).'),
    deuda_minima: z.union([z.number(), z.string().regex(/^\d{1,10}(\.\d{1,2})?$/)]).optional().describe('Deuda vencida mínima en soles.'),
    orden: z.enum(['deuda_desc', 'deuda_asc']).default('deuda_desc'),
    ...paginacion,
  }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const reloj = await relojDeCondominios();
    const where: Prisma.ReciboConceptoUnidadWhereInput = {
      AND: [al.cargos, filtroEstadoCargo('vencido', reloj), { unidad: { ...(e.condominio_id ? { complejo_id: e.condominio_id } : {}), ...(e.estructura_id ? { estructura_id: e.estructura_id } : {}) } }],
    };
    const grupos = await prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where, _sum: { monto: true }, _count: { _all: true } });
    const minimo = e.deuda_minima === undefined ? null : new Prisma.Decimal(e.deuda_minima);
    const lista = grupos
      .filter((g) => g.unidad_id != null && (minimo === null || new Prisma.Decimal(g._sum.monto ?? 0).gte(minimo)))
      .map((g) => ({ unidad_id: g.unidad_id as number, deuda: new Prisma.Decimal(g._sum.monto ?? 0), cargos: g._count._all }))
      .sort((a, b) => (e.orden === 'deuda_asc' ? a.deuda.comparedTo(b.deuda) : b.deuda.comparedTo(a.deuda)) || a.unidad_id - b.unidad_id);
    const total = lista.reduce((s, x) => s.plus(x.deuda), new Prisma.Decimal(0));
    const pag = paginarLista(lista, e);
    const ids = pag.filas.map((x) => x.unidad_id);
    const [unidades, antiguos] = await Promise.all([
      prisma.unidad.findMany({
        where: { AND: [al.unidades, { id: { in: ids } }] },
        select: { id: true, codigo: true, complejo: { select: { nombre: true, zona_horaria: true } }, estructura: { select: { nombre: true } }, propietario: { select: { nombre: true } }, inquilino: { select: { nombre: true } } },
      }),
      prisma.reciboConceptoUnidad.findMany({ where: { AND: [where, { unidad_id: { in: ids } }] }, select: { unidad_id: true, reciboConcepto: { select: { recibo: { select: { fecha_vencimiento: true } } } } } }),
    ]);
    const meta = new Map(unidades.map((x) => [x.id, x]));
    const masAntiguo = new Map<number, Date>();
    for (const c of antiguos) {
      const f = c.reciboConcepto?.recibo?.fecha_vencimiento;
      if (c.unidad_id != null && f && (!masAntiguo.has(c.unidad_id) || f < masAntiguo.get(c.unidad_id)!)) masAntiguo.set(c.unidad_id, f);
    }
    return respuesta({
      alcance: ALCANCE_TEXTO[al.tipo],
      total_morosos: pag.total,
      deuda_vencida_total: monto(total),
      filas: pag.filas.map((x) => {
        const m = meta.get(x.unidad_id);
        const desde = masAntiguo.get(x.unidad_id);
        return {
          unidad: dato(m?.codigo, 30),
          condominio: dato(m?.complejo?.nombre),
          block: dato(m?.estructura?.nombre),
          propietario: nombreCorto(m?.propietario?.nombre),
          inquilino: nombreCorto(m?.inquilino?.nombre),
          deuda_vencida: monto(x.deuda),
          cargos_vencidos: x.cargos,
          vencido_desde: fechaDia(desde),
          dias_de_atraso: desde ? Math.max(0, Math.floor((reloj.hoy(m?.complejo?.zona_horaria).getTime() - desde.getTime()) / 86_400_000)) : null, // los días del condominio, con su «hoy»
        };
      }),
      hay_mas: pag.hay_mas,
      siguiente_cursor: pag.siguiente_cursor,
    });
  },
});

export const buscarUnidad = defineHerramienta({
  nombre: 'buscar_unidad',
  descripcion:
    'Busca unidades (departamentos, casas) por código, condominio, block o nombre del propietario/inquilino. Úsala cuando la persona nombra una unidad o a un vecino y necesitas el código exacto para `detalle_unidad`. Ejemplo: {"texto":"A-101"}.',
  entrada: z.strictObject({ texto: z.string().trim().min(2).max(60).describe('Parte del código, del condominio, del block o del nombre.'), ...paginacion }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const p = pagina(e);
    const t = e.texto;
    const ci = (campo: string) => ({ [campo]: { contains: t, mode: 'insensitive' as const } });
    const filas = await prisma.unidad.findMany({
      where: { AND: [al.unidades, { OR: [ci('codigo'), { complejo: ci('nombre') }, { estructura: ci('nombre') }, { propietario: ci('nombre') }, { inquilino: ci('nombre') }] }] },
      orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
      skip: p.skip,
      take: p.take,
      select: { id: true, codigo: true, tipo: true, estado: true, complejo: { select: { id: true, nombre: true } }, estructura: { select: { id: true, nombre: true } }, propietario: { select: { nombre: true } }, inquilino: { select: { nombre: true } } },
    });
    const c = cortar(filas, p);
    return respuesta({
      alcance: ALCANCE_TEXTO[al.tipo],
      filas: c.filas.map((x) => ({
        unidad: dato(x.codigo, 30), tipo: dato(x.tipo, 30), estado: dato(x.estado, 20),
        condominio_id: x.complejo?.id ?? null, condominio: dato(x.complejo?.nombre),
        estructura_id: x.estructura?.id ?? null, block: dato(x.estructura?.nombre),
        propietario: nombreCorto(x.propietario?.nombre), inquilino: nombreCorto(x.inquilino?.nombre),
      })),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const detalleUnidad = defineHerramienta({
  nombre: 'detalle_unidad',
  descripcion:
    'Ficha de UNA unidad: propietario e inquilino (solo nombre), deuda total y vencida, cargos abiertos y últimos pagos. Úsala para «¿cómo está la A-101?». Pasa el código exacto (usa `buscar_unidad` si no lo tienes). ' +
    'Si hay varios condominios con el mismo código, devuelve las coincidencias y debes repetir con `condominio_id`. Ejemplo: {"codigo":"A-101"}.',
  entrada: z.strictObject({ codigo: textoCorto(30).describe('Código exacto de la unidad.'), condominio_id: idPositivo.optional() }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const unidades = await prisma.unidad.findMany({
      where: { AND: [al.unidades, { codigo: { equals: e.codigo, mode: 'insensitive' } }, e.condominio_id ? { complejo_id: e.condominio_id } : {}] },
      take: 6,
      orderBy: { id: 'asc' },
      select: { id: true, codigo: true, tipo: true, estado: true, complejo: { select: { id: true, nombre: true } }, estructura: { select: { nombre: true } }, propietario: { select: { nombre: true } }, inquilino: { select: { nombre: true } } },
    });
    if (unidades.length === 0) return respuesta({ encontrada: false, nota: 'No existe una unidad con ese código en tu alcance.' });
    if (unidades.length > 1) {
      return respuesta({ encontrada: true, ambigua: true, nota: 'Hay varias unidades con ese código; repite la consulta con `condominio_id`.', coincidencias: unidades.map((x) => ({ unidad: dato(x.codigo, 30), condominio_id: x.complejo?.id ?? null, condominio: dato(x.complejo?.nombre) })) });
    }
    const x = unidades[0]!;
    const mios: Prisma.ReciboConceptoUnidadWhereInput = { AND: [al.cargos, { unidad_id: x.id }] };
    const reloj = await relojDeCondominios();
    const [deuda, vencida, abiertos, pagos] = await Promise.all([
      prisma.reciboConceptoUnidad.aggregate({ where: { AND: [mios, noPagado] }, _sum: { monto: true } }),
      prisma.reciboConceptoUnidad.aggregate({ where: { AND: [mios, filtroEstadoCargo('vencido', reloj)] }, _sum: { monto: true } }),
      prisma.reciboConceptoUnidad.findMany({ where: { AND: [mios, noPagado] }, orderBy: [{ reciboConcepto: { recibo: { fecha_vencimiento: 'asc' } } }, { id: 'asc' }], take: 10, select: selectCargo }),
      prisma.pago.findMany({ where: { AND: [al.pagos, { reciboConceptoUnidad: { unidad_id: x.id } }] }, orderBy: [{ fecha_pago: 'desc' }, { id: 'desc' }], take: 5, select: selectPago }),
    ]);
    return respuesta({
      encontrada: true,
      unidad: dato(x.codigo, 30), tipo: dato(x.tipo, 30), estado: dato(x.estado, 20),
      condominio: dato(x.complejo?.nombre), block: dato(x.estructura?.nombre),
      propietario: nombreCorto(x.propietario?.nombre), inquilino: nombreCorto(x.inquilino?.nombre),
      deuda_total: monto(sumaDe(deuda)),
      deuda_vencida: monto(sumaDe(vencida)),
      cargos_abiertos: abiertos.map(filaCargo(reloj)),
      ultimos_pagos: pagos.map(filaPago),
    });
  },
});

export const recibos = defineHerramienta({
  nombre: 'recibos',
  descripcion:
    'Recibos emitidos (uno por periodo, condominio y block: cada block tiene su propio recibo cada mes) con su total emitido, cobrado y por cobrar, y cuántos departamentos recibieron su mantenimiento (cada departamento recibe UN mantenimiento al mes con todos los conceptos; los pagos son del mantenimiento completo). Úsala para «¿qué recibos hay de septiembre?» o «recibos con cargos vencidos». ' +
    'Con `unidad` los totales son solo de esa unidad; con `estado` solo salen recibos que tengan cargos en ese estado. Ejemplo: {"periodo":"2026-09","estado":"vencido"}.',
  entrada: z.strictObject({
    periodo: periodoSchema.optional(),
    estado: z.enum(ESTADOS_CARGO).optional().describe('Estado de los cargos del recibo.'),
    unidad: textoCorto(30).optional().describe('Código de unidad.'),
    ...ubicacion,
    ...paginacion,
  }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const p = pagina(e);
    const reloj = await relojDeCondominios();
    const cargosDelFiltro: Prisma.ReciboConceptoUnidadWhereInput = { AND: [al.cargos, porUnidad(e.unidad), e.estado ? filtroEstadoCargo(e.estado, reloj) : {}] };
    const periodo = e.periodo ? { anio: Number(e.periodo.slice(0, 4)), mes: Number(e.periodo.slice(5, 7)) } : {};
    const necesitaCargos = al.tipo === 'junta' || e.unidad !== undefined || e.estado !== undefined;
    const filas = await prisma.recibo.findMany({
      where: { AND: [al.recibos, periodo, e.condominio_id ? { complejo_id: e.condominio_id } : {}, e.estructura_id ? { estructura_id: e.estructura_id } : {}, necesitaCargos ? { reciboConceptos: { some: { reciboConceptoUnidades: { some: cargosDelFiltro } } } } : {}] },
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { id: 'desc' }],
      skip: p.skip,
      take: p.take,
      select: { id: true, mes: true, anio: true, descripcion: true, estado: true, fecha_emision: true, fecha_vencimiento: true, complejo: { select: { nombre: true } }, estructura: { select: { nombre: true } } },
    });
    const c = cortar(filas, p);
    const rcs = await prisma.reciboConcepto.findMany({ where: { recibo_id: { in: c.filas.map((r) => r.id) } }, select: { id: true, recibo_id: true } });
    const sumas = await sumasPorRC({ AND: [al.cargos, porUnidad(e.unidad), { recibo_concepto_id: { in: rcs.map((r) => r.id) } }] });
    // Departamentos con mantenimiento en cada recibo (una unidad = un mantenimiento, sin importar cuántos conceptos tenga).
    const departamentos = new Map<number, number>();
    for (const r of c.filas) {
      const g = await prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [al.cargos, porUnidad(e.unidad), { reciboConcepto: { recibo_id: r.id } }] } });
      departamentos.set(r.id, g.length);
    }
    const porRecibo = new Map<number, { emitido: Prisma.Decimal; cobrado: Prisma.Decimal; cargos: number }>();
    for (const rc of rcs) {
      const s = sumas.get(rc.id);
      if (!s || rc.recibo_id == null) continue;
      const x = porRecibo.get(rc.recibo_id) ?? { emitido: new Prisma.Decimal(0), cobrado: new Prisma.Decimal(0), cargos: 0 };
      porRecibo.set(rc.recibo_id, { emitido: x.emitido.plus(s.emitido), cobrado: x.cobrado.plus(s.cobrado), cargos: x.cargos + s.cargos });
    }
    return respuesta({
      alcance: ALCANCE_TEXTO[al.tipo],
      filas: c.filas.map((r) => {
        const s = porRecibo.get(r.id) ?? { emitido: new Prisma.Decimal(0), cobrado: new Prisma.Decimal(0), cargos: 0 };
        return {
          id: r.id, periodo: periodoDe(r.anio, r.mes), descripcion: dato(r.descripcion, 120), estado: dato(r.estado, 20), condominio: dato(r.complejo?.nombre), block: dato(r.estructura?.nombre),
          emision: fechaDia(r.fecha_emision), vencimiento: fechaDia(r.fecha_vencimiento),
          departamentos: departamentos.get(r.id) ?? 0, cargos: s.cargos, emitido: monto(s.emitido), cobrado: monto(s.cobrado), por_cobrar: monto(s.emitido.minus(s.cobrado)),
        };
      }),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const cargos = defineHerramienta({
  nombre: 'cargos',
  descripcion:
    'Cargos por unidad (cada concepto de un recibo para una unidad): monto, estado y vencimiento. Úsala para «¿qué cargos vencidos hay?», «cargos de Agua de septiembre» o «lo que vence esta semana». ' +
    'Ejemplo: {"estado":"vencido","concepto":"agua","limite":20}.',
  entrada: z.strictObject({
    estado: z.enum(ESTADOS_CARGO).optional(),
    concepto: textoCorto(60).optional().describe('Parte del nombre del concepto (agua, mantenimiento…).'),
    periodo: periodoSchema.optional(),
    unidad: textoCorto(30).optional().describe('Código de unidad.'),
    vence_desde: fechaIsoSchema.optional(),
    vence_hasta: fechaIsoSchema.optional(),
    ...ubicacion,
    ...paginacion,
  }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const p = pagina(e);
    const v = rangoVence(e.vence_desde, e.vence_hasta);
    const reloj = await relojDeCondominios();
    const filas = await prisma.reciboConceptoUnidad.findMany({
      where: {
        AND: [
          al.cargos, porPeriodo(e.periodo), porUnidad(e.unidad), cargosEn(e),
          e.estado ? filtroEstadoCargo(e.estado, reloj) : {},
          e.concepto ? { reciboConcepto: { concepto: { nombre: { contains: e.concepto, mode: 'insensitive' } } } } : {},
          v ? { reciboConcepto: { recibo: { fecha_vencimiento: v } } } : {},
        ],
      },
      orderBy: [{ reciboConcepto: { recibo: { fecha_vencimiento: 'desc' } } }, { id: 'desc' }],
      skip: p.skip,
      take: p.take,
      select: selectCargo,
    });
    const c = cortar(filas, p);
    return respuesta({ alcance: ALCANCE_TEXTO[al.tipo], filas: c.filas.map(filaCargo(reloj)), hay_mas: c.hay_mas, siguiente_cursor: c.siguiente_cursor });
  },
});

async function listarPagos(u: AuthUser, e: { estado?: (typeof ESTADOS_PAGO)[number]; metodo?: string; desde?: string; hasta?: string; unidad?: string; condominio_id?: number; estructura_id?: number; limite: number; cursor?: string }, antiguosPrimero = false) {
  const al = alcanceGestion(u);
  const p = pagina(e);
  const rango = rangoFechas(e.desde, e.hasta);
  const filas = await prisma.pago.findMany({
    where: {
      AND: [
        al.pagos,
        pagosEn(e),
        e.estado ? { estado_validacion: e.estado } : {},
        e.metodo ? { metodo_pago: { equals: e.metodo, mode: 'insensitive' } } : {},
        rango ? { fecha_pago: rango } : {},
        e.unidad ? { reciboConceptoUnidad: { unidad: { codigo: { equals: e.unidad, mode: 'insensitive' } } } } : {},
      ],
    },
    orderBy: antiguosPrimero ? [{ fecha_pago: 'asc' }, { id: 'asc' }] : [{ fecha_pago: 'desc' }, { id: 'desc' }],
    skip: p.skip,
    take: p.take,
    select: selectPago,
  });
  const c = cortar(filas, p);
  return respuesta({ alcance: ALCANCE_TEXTO[al.tipo], filas: c.filas.map(filaPago), hay_mas: c.hay_mas, siguiente_cursor: c.siguiente_cursor });
}

export const pagos = defineHerramienta({
  nombre: 'pagos',
  descripcion:
    'Pagos registrados (con o sin comprobante): monto, fecha, método, estado de validación, unidad y block. Úsala para «¿qué pagos llegaron esta semana?», «pagos rechazados» o «pagos de la A-101». ' +
    'Estados: por_validar, validado, rechazado. Fechas AAAA-MM-DD (hora de Lima). Ejemplo: {"estado":"validado","desde":"2026-10-01","hasta":"2026-10-15"}.',
  entrada: z.strictObject({
    estado: z.enum(ESTADOS_PAGO).optional(),
    metodo: textoCorto(30).optional().describe('transferencia, yape, plin, efectivo…'),
    desde: fechaIsoSchema.optional(),
    hasta: fechaIsoSchema.optional(),
    unidad: textoCorto(30).optional().describe('Código de unidad.'),
    ...ubicacion,
    ...paginacion,
  }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  ejecutar: (u, e) => listarPagos(u, e),
});

export const pagosPorValidar = defineHerramienta({
  nombre: 'pagos_por_validar',
  descripcion: 'Pagos con comprobante que esperan validación (los más antiguos primero), con la lectura de la IA del comprobante. Úsala para «¿qué tengo pendiente de validar?». Solo lista: validar o rechazar se hace en la pantalla de Pagos. Ejemplo: {"limite":10}.',
  entrada: z.strictObject({ ...ubicacion, ...paginacion }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  ejecutar: (u, e) => listarPagos(u, { ...e, estado: 'por_validar' }, true),
});

export const cobranzaPorConcepto = defineHerramienta({
  nombre: 'cobranza_por_concepto',
  descripcion:
    'Emitido, cobrado y por cobrar por concepto (mantenimiento, agua, cuota extraordinaria…) de un año o de un mes. Úsala para «¿qué concepto se paga menos?». Sin `anio` usa el año actual. Ejemplo: {"anio":2026,"mes":9}.',
  entrada: z.strictObject({ anio: z.number().int().min(2000).max(2100).optional(), mes: z.number().int().min(1).max(12).optional(), ...ubicacion }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const anio = e.anio ?? hoyEn(await zonaDeUsuario(u)).getUTCFullYear(); // el año en curso en el condominio de quien pregunta
    const sumas = await sumasPorRC({ AND: [al.cargos, cargosEn(e), { reciboConcepto: { recibo: { anio, ...(e.mes ? { mes: e.mes } : {}) } } }] });
    const rcs = await prisma.reciboConcepto.findMany({ where: { id: { in: [...sumas.keys()] } }, select: { id: true, concepto_id: true, concepto: { select: { nombre: true } } } });
    const porConcepto = new Map<number | null, { nombre: string | null; emitido: Prisma.Decimal; cobrado: Prisma.Decimal; cargos: number }>();
    for (const rc of rcs) {
      const s = sumas.get(rc.id)!;
      const x = porConcepto.get(rc.concepto_id) ?? { nombre: dato(rc.concepto?.nombre), emitido: new Prisma.Decimal(0), cobrado: new Prisma.Decimal(0), cargos: 0 };
      porConcepto.set(rc.concepto_id, { ...x, emitido: x.emitido.plus(s.emitido), cobrado: x.cobrado.plus(s.cobrado), cargos: x.cargos + s.cargos });
    }
    const todas = [...porConcepto.values()].sort((a, b) => b.emitido.comparedTo(a.emitido));
    return respuesta({
      alcance: ALCANCE_TEXTO[al.tipo],
      periodo: e.mes ? periodoDe(anio, e.mes) : String(anio),
      filas: todas.slice(0, 50).map((x) => ({ concepto: x.nombre, cargos: x.cargos, emitido: monto(x.emitido), cobrado: monto(x.cobrado), por_cobrar: monto(x.emitido.minus(x.cobrado)), porcentaje_cobrado: pct(x.cobrado, x.emitido) })),
      hay_mas: todas.length > 50,
    });
  },
});

export const cobranzaPorMes = defineHerramienta({
  nombre: 'cobranza_por_mes',
  descripcion:
    'Evolución mensual de los últimos N meses: emitido (cargos de los recibos del mes) frente a cobrado (pagos validados con fecha en el mes). Úsala para tendencias: «¿cómo nos fue estos 6 meses?». N entre 1 y 24 (6 por omisión). Ejemplo: {"meses":12}.',
  entrada: z.strictObject({ meses: z.number().int().min(1).max(24).default(6), ...ubicacion }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const reloj = await relojDeRecibos(al.recibos); // los meses terminan en el de hoy del alcance; cada pago cuenta en el mes de la zona de SU condominio
    const fin = reloj.hoyMasReciente();
    const serie = await Promise.all(
      mesesHasta(e.meses, fin.getUTCFullYear(), fin.getUTCMonth() + 1).map(async (m) => {
        const [emitido, cobrado] = await Promise.all([
          prisma.reciboConceptoUnidad.aggregate({ where: { AND: [al.cargos, cargosEn(e), { reciboConcepto: { recibo: { anio: m.anio, mes: m.mes } } }] }, _sum: { monto: true } }),
          prisma.pago.aggregate({ where: { AND: [al.pagos, pagosEn(e), { estado_validacion: 'validado' }, pagoEnMes(reloj, m.anio, m.mes)] }, _sum: { monto: true } }),
        ]);
        return { periodo: periodoDe(m.anio, m.mes), emitido: monto(sumaDe(emitido)), cobrado: monto(sumaDe(cobrado)) };
      }),
    );
    return respuesta({ alcance: ALCANCE_TEXTO[al.tipo], filas: serie });
  },
});

export const mediosDePago = defineHerramienta({
  nombre: 'medios_de_pago',
  descripcion: 'Medios de pago ACTIVOS (cuentas bancarias, Yape, Plin, cuentas recaudadoras) de los condominios y blocks de tu alcance, tal como los ve el vecino. Úsala para «¿a dónde pagan los del Block B?». Ejemplo: {"condominio_id":1}.',
  entrada: z.strictObject({ condominio_id: idPositivo.optional(), estructura_id: idPositivo.optional(), ...paginacion }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const p = pagina(e);
    const filas = await prisma.medioPago.findMany({
      where: { AND: [al.medios, { activo: true }, e.condominio_id ? { complejo_id: e.condominio_id } : {}, e.estructura_id ? { estructura_id: e.estructura_id } : {}] },
      orderBy: [{ complejo_id: 'asc' }, { orden: 'asc' }, { id: 'asc' }],
      skip: p.skip,
      take: p.take,
      // Sin documento del titular, sin bytes del QR.
      select: { id: true, tipo: true, banco: true, banco_otro: true, tipo_cuenta: true, numero_cuenta: true, cci: true, moneda: true, servicio: true, codigo_pago: true, codigo_instruccion: true, titular: true, celular: true, qr_nombre: true, estructura_id: true, complejo: { select: { nombre: true } }, estructura: { select: { nombre: true } } },
    });
    const c = cortar(filas, p);
    return respuesta({
      alcance: ALCANCE_TEXTO[al.tipo],
      filas: c.filas.map((m) => {
        const v = camposDePago(m, null); // sin unidad: «departamento» se lee «el código de tu departamento»
        return {
          id: m.id, tipo: dato(m.tipo, 20), banco: dato(v.entidad, 60), tipo_cuenta: dato(m.tipo_cuenta, 20), numero_cuenta: dato(m.numero_cuenta, 30), cci: dato(m.cci, 30), moneda: v.moneda,
          servicio: dato(v.servicio, 80), instruccion: dato(v.instruccion, 300),
          titular: dato(m.titular), celular: dato(m.celular, 20), tiene_qr: m.qr_nombre != null,
          condominio: dato(m.complejo?.nombre), block: dato(m.estructura?.nombre), ambito: m.estructura_id != null ? 'block' : 'condominio',
        };
      }),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const condominiosYBlocks = defineHerramienta({
  nombre: 'condominios_y_blocks',
  descripcion: 'Estructura de tu alcance: condominios, sus blocks y cuántas unidades tiene cada uno. Úsala para saber qué ids usar en otros filtros o para «¿cuántas unidades tenemos?». Ejemplo: {}.',
  entrada: z.strictObject({ ...paginacion }),
  roles: GESTION,
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcanceGestion(u);
    const a = u.rol === 'propietario' ? ambitoJunta(u) : null;
    const p = pagina(e);
    const complejos = await prisma.complejoHabitacional.findMany({
      where: al.complejos,
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      skip: p.skip,
      take: p.take,
      select: { id: true, nombre: true, tipo: true, estructuras: { where: a?.estructura_id ? { id: a.estructura_id } : {}, orderBy: { id: 'asc' }, take: 50, select: { id: true, nombre: true, tipo: true } } },
    });
    const c = cortar(complejos, p);
    const conteo = await prisma.unidad.groupBy({ by: ['complejo_id', 'estructura_id'], where: { AND: [al.unidades, { complejo_id: { in: c.filas.map((x) => x.id) } }] }, _count: { _all: true } });
    const cuenta = (complejo: number, estructura?: number) => conteo.filter((g) => g.complejo_id === complejo && (estructura === undefined || g.estructura_id === estructura)).reduce((s, g) => s + g._count._all, 0);
    return respuesta({
      alcance: ALCANCE_TEXTO[al.tipo],
      filas: c.filas.map((x) => ({
        id: x.id, nombre: dato(x.nombre), tipo: dato(x.tipo, 30), unidades: cuenta(x.id),
        blocks: x.estructuras.map((b) => ({ id: b.id, nombre: dato(b.nombre), tipo: dato(b.tipo, 30), unidades: cuenta(x.id, b.id) })),
      })),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const tareasDeMantenimiento = defineHerramienta({
  nombre: 'tareas_de_mantenimiento',
  descripcion: 'Tareas de mantenimiento de tu empresa: título, estado (pendiente, en_progreso, completada), unidad y responsable. Úsala para «¿qué reparaciones están abiertas?». Ejemplo: {"estado":"pendiente"}.',
  entrada: z.strictObject({ estado: z.enum(['pendiente', 'en_progreso', 'completada']).optional(), ...paginacion }),
  roles: GESTION,
  solo_lectura: true,
  async ejecutar(u, e) {
    const p = pagina(e);
    const filas = await prisma.tareaMantenimiento.findMany({
      where: { AND: [scopeTareas(u), e.estado ? { estado: e.estado } : {}] },
      orderBy: [{ fecha_creacion: 'desc' }, { id: 'desc' }],
      skip: p.skip,
      take: p.take,
      select: { id: true, titulo: true, descripcion: true, estado: true, fecha_creacion: true, fecha_cierre: true, unidad: { select: { codigo: true } }, asignado: { select: { nombre: true } } },
    });
    const c = cortar(filas, p);
    return respuesta({
      filas: c.filas.map((t) => ({ id: t.id, titulo: dato(t.titulo, 120), descripcion: dato(t.descripcion, 200), estado: dato(t.estado, 20), unidad: dato(t.unidad?.codigo, 30), asignado: nombreCorto(t.asignado?.nombre), creada: instante(t.fecha_creacion), cerrada: instante(t.fecha_cierre) })),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const avisosRecientes = defineHerramienta({
  nombre: 'avisos_recientes',
  descripcion: 'Resumen de los avisos enviados por correo y WhatsApp en los últimos días: cuántos por tipo, canal y estado (enviado, pendiente, fallido). No incluye destinatarios ni el texto. Úsala para «¿se enviaron los avisos de vencimiento?». Ejemplo: {"dias":7}.',
  entrada: z.strictObject({ dias: z.number().int().min(1).max(90).default(30), tipo: textoCorto(40).optional(), estado: textoCorto(20).optional() }),
  roles: GESTION,
  solo_lectura: true,
  async ejecutar(u, e) {
    const zona = await zonaDeUsuario(u);
    const dia = new Date(hoyEn(zona).getTime() - e.dias * 86_400_000); // el día de calendario de hace `dias` días, en el condominio de quien pregunta
    const desde = medianocheEn(zona, dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate());
    const g = await prisma.notificacion.groupBy({
      by: ['tipo', 'canal', 'estado'],
      where: { AND: [scopeNotificaciones(u), { created_at: { gte: desde } }, e.tipo ? { tipo: e.tipo } : {}, e.estado ? { estado: e.estado } : {}] },
      _count: { _all: true },
    });
    const filas = g.map((x) => ({ tipo: dato(x.tipo, 40), canal: dato(x.canal, 20), estado: dato(x.estado, 20), cantidad: x._count._all })).sort((a, b) => b.cantidad - a.cantidad);
    return respuesta({ desde: fechaDia(dia), dias: e.dias, total: filas.reduce((s, f) => s + f.cantidad, 0), filas: filas.slice(0, 50) });
  },
});

export const HERRAMIENTAS_GESTION = [
  resumenCobranza, morosos, buscarUnidad, detalleUnidad, recibos, cargos, pagos, pagosPorValidar, cobranzaPorConcepto, cobranzaPorMes, mediosDePago, condominiosYBlocks, tareasDeMantenimiento, avisosRecientes,
];
