/**
 * Deshacer lo que la pantalla no dejaba deshacer: anular un recibo emitido (el periodo queda libre para emitirlo de nuevo) y corregir o quitar el
 * cargo de UN departamento. Todo con motivo, todo en una transacción y todo con la foto de lo que se borró en la auditoría.
 *
 * DECISIÓN (a), borrar: el recibo se anula BORRÁNDOLO (con sus conceptos, cargos —y la mora que la emisión le agregó, que es un concepto más del recibo—
 * y las lecturas de agua que cuelgan de él) en vez de marcarlo `anulado`. Marcarlo habría obligado a excluirlo de cada cálculo que mira recibos o
 * cargos (deuda, mora, morosos, dashboard, estado de cuenta, rendición, cierres, asistente, avisos, Excel…: medio centenar de archivos); un solo sitio
 * olvidado y el vecino debería plata que no debe. Borrado, ninguna consulta tiene que saber que existió. Lo que se pierde se deja en la auditoría.
 *
 * Un cargo con dinero vigente (pagos `validado` o `por_validar`, o un estado `pagado`/`en_revision`) NO se toca: primero hay que anular o rechazar el pago.
 * La lista es POSITIVA a propósito: un estado nuevo (p. ej. `anulado`) nunca cuenta como pago vigente.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, invalid, notFound } from '../errors';
import { sincronizarCargo } from '../routes/pagos';
import { periodoTexto } from '../lib/periodo';
import { formatoDinero } from '../../lib/paises';
import { bloquearPeriodo } from './reciboUnico';

type Tx = Prisma.TransactionClient;

/** Pagos que cuentan como dinero: un pago `validado` ya cobró y uno `por_validar` ya reclama su monto. Cualquier otro estado no cuenta. */
export const ESTADOS_PAGO_VIGENTE = ['validado', 'por_validar'] as const;
/** Estados de un cargo que ya tienen dinero detrás (aunque no haya fila de `Pago`: datos anteriores al flujo de pagos). */
const ESTADOS_CARGO_COBRADO = ['pagado', 'en_revision'] as const;

export const MENSAJE_RECIBO_CON_PAGOS = 'Este recibo tiene pagos: anúlalos o recházalos antes';
export const MENSAJE_CARGO_CON_PAGOS = 'Este cargo tiene pagos: anúlalos o recházalos antes';

const dec = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);

/** Lo que un pago no vigente deja en la auditoría antes de borrarse (el comprobante sólo con sus metadatos: los bytes no van a la auditoría). */
const selectPagoParaFoto = {
  id: true, recibo_concepto_unidad_id: true, monto: true, fecha_pago: true, metodo_pago: true, referencia: true, observaciones: true, usuario_id: true,
  estado_validacion: true, motivo_rechazo: true, validado_por_id: true, validado_at: true, grupo: true, created_at: true,
  comprobante: { select: { nombre: true, tipo_mime: true, tamano: true, sha256: true } },
} satisfies Prisma.PagoSelect;
type PagoParaFoto = Prisma.PagoGetPayload<{ select: typeof selectPagoParaFoto }>;

/** Bloquea las filas de los cargos: un pago que se esté registrando ahora (toma un candado sobre el cargo) termina antes o falla después. */
async function bloquearCargos(tx: Tx, where: Prisma.Sql): Promise<void> {
  await tx.$queryRaw`SELECT rcu.id FROM "ReciboConceptoUnidad" rcu JOIN "ReciboConcepto" rc ON rc.id = rcu.recibo_concepto_id WHERE ${where} FOR UPDATE OF rcu`;
}

/** ¿Hay dinero vigente detrás de estos cargos? Devuelve cuántos cargos lo tienen. */
async function cargosConDinero(tx: Tx, cargoIds: number[]): Promise<number> {
  if (!cargoIds.length) return 0;
  return tx.reciboConceptoUnidad.count({
    where: { id: { in: cargoIds }, OR: [{ pagos: { some: { estado_validacion: { in: [...ESTADOS_PAGO_VIGENTE] } } } }, { estado_pago: { in: [...ESTADOS_CARGO_COBRADO] } }] },
  });
}

/**
 * Los pagos que quedan colgando de esos cargos (rechazados, y lo que venga) y los de su mismo grupo de mantenimiento. Si alguno de ellos fuera
 * vigente, 409: borrar un cargo no puede llevarse dinero. Devuelve las filas para la foto; el borrado lo hace `borrarCargos`.
 */
async function pagosPorRetirar(tx: Tx, cargoIds: number[], mensaje: string): Promise<PagoParaFoto[]> {
  if (!cargoIds.length) return [];
  const propios = await tx.pago.findMany({ where: { recibo_concepto_unidad_id: { in: cargoIds } }, select: selectPagoParaFoto });
  const grupos = [...new Set(propios.flatMap((p) => (p.grupo ? [p.grupo] : [])))];
  const hermanos = grupos.length ? await tx.pago.findMany({ where: { grupo: { in: grupos }, id: { notIn: propios.map((p) => p.id) } }, select: selectPagoParaFoto }) : [];
  const todos = [...propios, ...hermanos];
  if (todos.some((p) => (ESTADOS_PAGO_VIGENTE as readonly string[]).includes(p.estado_validacion))) throw conflict(mensaje);
  return todos;
}

function fotoDePago(p: PagoParaFoto, cargo: Map<number, { unidad_id: number | null; codigo: string | null; concepto: string | null }>) {
  const c = p.recibo_concepto_unidad_id != null ? cargo.get(p.recibo_concepto_unidad_id) : undefined;
  return {
    id: p.id, unidad_id: c?.unidad_id ?? null, codigo: c?.codigo ?? null, concepto: c?.concepto ?? null, monto: dec(p.monto).toFixed(2), fecha_pago: p.fecha_pago,
    metodo_pago: p.metodo_pago, referencia: p.referencia, observaciones: p.observaciones, usuario_id: p.usuario_id, estado: p.estado_validacion, motivo_rechazo: p.motivo_rechazo,
    validado_por_id: p.validado_por_id, validado_at: p.validado_at, grupo: p.grupo, registrado_at: p.created_at, comprobante: p.comprobante ?? null,
  };
}

/** Borra los pagos (su comprobante y su evaluación caen con ellos; el abono bancario conciliado queda suelto) y luego los cargos. */
async function borrarCargos(tx: Tx, cargoIds: number[], pagos: PagoParaFoto[]): Promise<void> {
  if (pagos.length) await tx.pago.deleteMany({ where: { id: { in: pagos.map((p) => p.id) } } });
  if (cargoIds.length) await tx.reciboConceptoUnidad.deleteMany({ where: { id: { in: cargoIds } } });
}

const selectCargoFoto = {
  id: true, monto: true, estado_pago: true, observaciones: true, unidad_id: true,
  unidad: { select: { id: true, codigo: true, propietario_id: true, inquilino_id: true } },
  reciboConcepto: { select: { id: true, concepto: { select: { nombre: true } } } },
} satisfies Prisma.ReciboConceptoUnidadSelect;

// ---------- 1. Anular recibo ----------

export interface ResumenAnulacion {
  recibo_id: number;
  mes: number;
  anio: number;
  periodo: string;
  torre: string | null;
  moneda: string;
  departamentos: number;
  cargos: number;
  total: string;
  /** Cargos con dinero vigente (pago validado o por validar, o estado pagado / en revisión): si hay alguno, no se puede anular. */
  cargos_con_pagos: number;
  /** Pagos rechazados que se llevarían con los cargos (quedan en la auditoría). */
  pagos_rechazados: number;
  lecturas_agua: number;
  puede: boolean;
  /** Por qué no se puede (mensaje listo para mostrar); null si se puede. */
  bloqueo: string | null;
}

/** Lo que haría «Anular recibo» sin tocar nada: la pantalla lo muestra en el modal y explica por qué no se puede. `null` si el recibo no existe. */
export async function resumenDeAnulacion(reciboId: number): Promise<ResumenAnulacion | null> {
  const r = await prisma.recibo.findUnique({ where: { id: reciboId }, select: { id: true, mes: true, anio: true, estructura: { select: { nombre: true } }, complejo: { select: { moneda: true } } } });
  if (!r) return null;
  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: { reciboConcepto: { recibo_id: reciboId } },
    select: { id: true, monto: true, unidad_id: true, estado_pago: true, pagos: { select: { estado_validacion: true } } },
  });
  const vigente = (e: string) => (ESTADOS_PAGO_VIGENTE as readonly string[]).includes(e);
  const conDinero = cargos.filter((c) => c.pagos.some((p) => vigente(p.estado_validacion)) || (ESTADOS_CARGO_COBRADO as readonly string[]).includes(c.estado_pago ?? '')).length;
  const rechazados = cargos.reduce((s, c) => s + c.pagos.filter((p) => !vigente(p.estado_validacion)).length, 0);
  const lecturas = await prisma.lecturaAgua.count({ where: { recibo_id: reciboId } });
  return {
    recibo_id: r.id, mes: r.mes, anio: r.anio, periodo: periodoTexto(r.mes, r.anio), torre: r.estructura?.nombre ?? null, moneda: r.complejo?.moneda ?? 'PEN',
    departamentos: new Set(cargos.flatMap((c) => (c.unidad_id != null ? [c.unidad_id] : []))).size, cargos: cargos.length,
    total: cargos.reduce((s, c) => s.plus(c.monto), new Prisma.Decimal(0)).toFixed(2),
    cargos_con_pagos: conDinero, pagos_rechazados: rechazados, lecturas_agua: lecturas,
    puede: conDinero === 0, bloqueo: conDinero === 0 ? null : MENSAJE_RECIBO_CON_PAGOS,
  };
}

export interface ReciboAnulado {
  recibo_id: number;
  mes: number;
  anio: number;
  torre: string | null;
  complejo_id: number | null;
  empresa_id: number | null;
  /** Las unidades que tenían cargo: a ellas va el aviso (con el propietario e inquilino de cada una al momento de anular). */
  unidades: { id: number; codigo: string; propietario_id: number | null; inquilino_id: number | null }[];
  cargos: number;
  total: string;
  moneda: string;
  /** La foto completa de lo que se borró, para el `detalle` de la auditoría. */
  foto: Prisma.InputJsonValue;
}

/**
 * Anula el recibo: borra recibo, conceptos, cargos, pagos NO vigentes y lecturas de agua, y deja libre el periodo. Todo o nada. 409 si algún cargo tiene dinero
 * vigente. Nunca llama a la red ni encola avisos: eso lo hace quien la llama, ya con la transacción cerrada.
 */
export async function anularRecibo(o: { reciboId: number; motivo: string }): Promise<ReciboAnulado> {
  return prisma.$transaction(async (tx) => {
    const recibo = await tx.recibo.findUnique({
      where: { id: o.reciboId },
      select: {
        id: true, mes: true, anio: true, descripcion: true, estado: true, fecha_emision: true, fecha_vencimiento: true, complejo_id: true, empresa_id: true, estructura_id: true, creado_por_id: true,
        estructura: { select: { nombre: true } }, complejo: { select: { moneda: true } },
        reciboConceptos: { select: { id: true, monto: true, es_recargo: true, orden: true, concepto: { select: { nombre: true } } }, orderBy: { orden: 'asc' } },
      },
    });
    if (!recibo) throw notFound('Recibo');
    // El mismo candado que la emisión: una emisión del mismo periodo que esté corriendo termina antes de que este recibo desaparezca.
    if (recibo.complejo_id != null) await bloquearPeriodo(tx, recibo.complejo_id, recibo.mes, recibo.anio);
    await bloquearCargos(tx, Prisma.sql`rc.recibo_id = ${o.reciboId}`);
    // Con los cargos bloqueados se lee lo que vale: un pago que entró mientras tanto ya se ve.
    const cargos = await tx.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo_id: o.reciboId } }, select: selectCargoFoto, orderBy: [{ unidad: { codigo: 'asc' } }, { id: 'asc' }] });
    const ids = cargos.map((c) => c.id);
    if ((await cargosConDinero(tx, ids)) > 0) throw conflict(MENSAJE_RECIBO_CON_PAGOS);
    const pagos = await pagosPorRetirar(tx, ids, MENSAJE_RECIBO_CON_PAGOS);
    const lecturas = await tx.lecturaAgua.findMany({
      where: { recibo_id: o.reciboId },
      select: { unidad_id: true, fecha_anterior: true, lectura_anterior: true, fecha_actual: true, lectura_actual: true, factor: true, foto_nombre: true, unidad: { select: { codigo: true } } },
    });

    const porCargo = new Map(cargos.map((c) => [c.id, { unidad_id: c.unidad_id, codigo: c.unidad?.codigo ?? null, concepto: c.reciboConcepto?.concepto?.nombre ?? null }]));
    const porUnidad = new Map<number, { unidad_id: number; codigo: string; total: Prisma.Decimal; cargos: { concepto: string | null; monto: string; estado_pago: string | null; observaciones?: string }[] }>();
    for (const c of cargos) {
      if (c.unidad_id == null || !c.unidad) continue;
      const u = porUnidad.get(c.unidad_id) ?? { unidad_id: c.unidad_id, codigo: c.unidad.codigo, total: new Prisma.Decimal(0), cargos: [] };
      u.total = u.total.plus(c.monto);
      u.cargos.push({ concepto: c.reciboConcepto?.concepto?.nombre ?? null, monto: dec(c.monto).toFixed(2), estado_pago: c.estado_pago, ...(c.observaciones ? { observaciones: c.observaciones } : {}) });
      porUnidad.set(c.unidad_id, u);
    }
    const total = cargos.reduce((s, c) => s.plus(c.monto), new Prisma.Decimal(0));
    const foto = {
      motivo: o.motivo,
      recibo: {
        id: recibo.id, mes: recibo.mes, anio: recibo.anio, descripcion: recibo.descripcion, estado: recibo.estado, fecha_emision: recibo.fecha_emision, fecha_vencimiento: recibo.fecha_vencimiento,
        complejo_id: recibo.complejo_id, estructura_id: recibo.estructura_id, torre: recibo.estructura?.nombre ?? null, creado_por_id: recibo.creado_por_id,
      },
      conceptos: recibo.reciboConceptos.map((c) => ({ concepto: c.concepto?.nombre ?? null, monto: dec(c.monto).toFixed(2), es_recargo: c.es_recargo, orden: c.orden })),
      total: total.toFixed(2),
      departamentos: porUnidad.size,
      unidades: [...porUnidad.values()].map((u) => ({ unidad_id: u.unidad_id, codigo: u.codigo, total: u.total.toFixed(2), cargos: u.cargos })),
      pagos_retirados: pagos.map((p) => fotoDePago(p, porCargo)),
      lecturas_agua: lecturas.map((l) => ({ unidad_id: l.unidad_id, codigo: l.unidad?.codigo ?? null, fecha_anterior: l.fecha_anterior, lectura_anterior: l.lectura_anterior.toFixed(3), fecha_actual: l.fecha_actual, lectura_actual: l.lectura_actual.toFixed(3), factor: l.factor.toFixed(4), con_foto: l.foto_nombre != null })),
    } as unknown as Prisma.InputJsonValue;

    // Un aviso que aún no salió de este recibo (o de sus cargos y pagos) ya no tiene de qué hablar: no se manda.
    const pagoIds = pagos.map((p) => p.id);
    await tx.notificacion.updateMany({
      where: {
        estado: 'pendiente',
        OR: [
          { ref_entidad: 'recibo', ref_id: o.reciboId },
          ...(ids.length ? [{ ref_entidad: 'cargo', ref_id: { in: ids } }] : []),
          ...(pagoIds.length ? [{ ref_entidad: 'pago', ref_id: { in: pagoIds } }] : []),
        ],
      },
      data: { estado: 'omitida', error: 'Recibo anulado' },
    });

    await borrarCargos(tx, ids, pagos);
    await tx.reciboConcepto.deleteMany({ where: { recibo_id: o.reciboId } });
    // Las lecturas de agua caen con el recibo (`onDelete: Cascade`): el nuevo recibo del mes empieza sin lecturas, así que nada queda huérfano ni se duplica.
    await tx.recibo.delete({ where: { id: o.reciboId } });

    return {
      recibo_id: recibo.id, mes: recibo.mes, anio: recibo.anio, torre: recibo.estructura?.nombre ?? null, complejo_id: recibo.complejo_id, empresa_id: recibo.empresa_id,
      unidades: [...porUnidad.values()].map((u) => {
        const un = cargos.find((c) => c.unidad_id === u.unidad_id)!.unidad!;
        return { id: u.unidad_id, codigo: u.codigo, propietario_id: un.propietario_id, inquilino_id: un.inquilino_id };
      }),
      cargos: cargos.length, total: total.toFixed(2), moneda: recibo.complejo?.moneda ?? 'PEN', foto,
    };
  }, { maxWait: 10_000, timeout: 60_000 });
}

// ---------- 2. Corregir o quitar el cargo de un departamento ----------

export interface CargoCorregido {
  id: number;
  codigo: string;
  concepto: string | null;
  recibo_id: number | null;
  mes: number | null;
  anio: number | null;
  monto_anterior: string;
  monto_nuevo: string | null;
  estado: string | null;
  /** Pagos no vigentes (rechazados) que se llevó un «quitar»; en la auditoría quedan con todo su detalle. */
  pagos_retirados?: ReturnType<typeof fotoDePago>[];
}

const selectCargoCorreccion = {
  id: true, monto: true, estado_pago: true, observaciones: true,
  unidad: { select: { codigo: true } },
  reciboConcepto: { select: { recibo_id: true, concepto: { select: { nombre: true } }, recibo: { select: { mes: true, anio: true, complejo: { select: { moneda: true } } } } } },
} satisfies Prisma.ReciboConceptoUnidadSelect;

async function cargoBloqueado(tx: Tx, cargoId: number) {
  await tx.$queryRaw`SELECT id FROM "ReciboConceptoUnidad" WHERE id = ${cargoId} FOR UPDATE`;
  const c = await tx.reciboConceptoUnidad.findUnique({ where: { id: cargoId }, select: selectCargoCorreccion });
  if (!c) throw notFound('Cargo');
  return c;
}

/** Lo ya pagado de un cargo que sigue vigente: validado + por validar. */
async function pagadoVigente(tx: Tx, cargoId: number): Promise<Prisma.Decimal> {
  const { _sum } = await tx.pago.aggregate({ where: { recibo_concepto_unidad_id: cargoId, estado_validacion: { in: [...ESTADOS_PAGO_VIGENTE] } }, _sum: { monto: true } });
  return dec(_sum.monto);
}

/**
 * Cambia el monto de UN cargo. No puede quedar por debajo de lo ya pagado vigente (409). Después el estado del cargo se recalcula con `sincronizarCargo`
 * (lo que ya cubría el pago lo deja pagado; si se sube sobre lo pagado, vuelve a pendiente). El total del recibo no se guarda en ningún lado: se suma de sus cargos.
 */
export async function corregirCargo(o: { cargoId: number; monto: string; motivo: string }): Promise<CargoCorregido> {
  return prisma.$transaction(async (tx) => {
    const c = await cargoBloqueado(tx, o.cargoId);
    const nuevo = new Prisma.Decimal(o.monto);
    const anterior = dec(c.monto);
    if (nuevo.eq(anterior)) throw invalid('Datos inválidos: monto: es el mismo monto que ya tiene el cargo', { monto: 'Es el mismo monto' });
    const pagado = await pagadoVigente(tx, o.cargoId);
    if (nuevo.lt(pagado)) {
      const moneda = c.reciboConcepto?.recibo?.complejo?.moneda;
      throw conflict(`El monto no puede ser menor a lo ya pagado (${formatoDinero(pagado, moneda)}): anula o rechaza ese pago primero`);
    }
    await tx.reciboConceptoUnidad.update({ where: { id: o.cargoId }, data: { monto: nuevo } });
    await sincronizarCargo(tx, o.cargoId);
    const despues = await tx.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: o.cargoId }, select: { estado_pago: true } });
    return { id: c.id, codigo: c.unidad?.codigo ?? '', concepto: c.reciboConcepto?.concepto?.nombre ?? null, recibo_id: c.reciboConcepto?.recibo_id ?? null, mes: c.reciboConcepto?.recibo?.mes ?? null, anio: c.reciboConcepto?.recibo?.anio ?? null, monto_anterior: anterior.toFixed(2), monto_nuevo: nuevo.toFixed(2), estado: despues.estado_pago };
  });
}

/**
 * Quita el cargo de un departamento: el vecino ya no lo debe. 409 si tiene pagos vigentes (o está pagado / en revisión). Un pago rechazado que colgara de él
 * se borra con el cargo (para no dejar pagos sin cargo ni un cargo en S/ 0 que seguiría contando como moroso); su detalle completo queda en la auditoría.
 */
export async function quitarCargo(o: { cargoId: number; motivo: string }): Promise<CargoCorregido> {
  return prisma.$transaction(async (tx) => {
    const c = await cargoBloqueado(tx, o.cargoId);
    if ((await cargosConDinero(tx, [o.cargoId])) > 0) throw conflict(MENSAJE_CARGO_CON_PAGOS);
    const pagos = await pagosPorRetirar(tx, [o.cargoId], MENSAJE_CARGO_CON_PAGOS);
    const unidadId = (await tx.reciboConceptoUnidad.findUnique({ where: { id: o.cargoId }, select: { unidad_id: true } }))?.unidad_id ?? null;
    const porCargo = new Map([[o.cargoId, { unidad_id: unidadId, codigo: c.unidad?.codigo ?? null, concepto: c.reciboConcepto?.concepto?.nombre ?? null }]]);
    // Un pago rechazado de un mantenimiento pagado en grupo arrastra a sus hermanos: sus cargos no se tocan, sólo el pago.
    await tx.notificacion.updateMany({ where: { estado: 'pendiente', OR: [{ ref_entidad: 'cargo', ref_id: o.cargoId }, ...(pagos.length ? [{ ref_entidad: 'pago', ref_id: { in: pagos.map((p) => p.id) } }] : [])] }, data: { estado: 'omitida', error: 'Cargo quitado' } });
    await borrarCargos(tx, [o.cargoId], pagos);
    return { id: c.id, codigo: c.unidad?.codigo ?? '', concepto: c.reciboConcepto?.concepto?.nombre ?? null, recibo_id: c.reciboConcepto?.recibo_id ?? null, mes: c.reciboConcepto?.recibo?.mes ?? null, anio: c.reciboConcepto?.recibo?.anio ?? null, monto_anterior: dec(c.monto).toFixed(2), monto_nuevo: null, estado: null, pagos_retirados: pagos.map((p) => fotoDePago(p, porCargo)) };
  });
}
