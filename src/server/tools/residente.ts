// Etapa 2 · herramientas del residente (propietario e inquilino): SOLO lo suyo. El filtro es siempre «las unidades donde esta persona es
// propietaria (o inquilina)»; no existe ningún argumento que permita mirar otra unidad ni a otra persona.
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { estadoCargo, filtroEstadoCargo, noPagado } from '../lib/cargos';
import type { AuthUser } from '../middleware/auth';
import { medioDeUnidades } from '../services/asistente/contexto';
import { z } from '../validation';
import { MAX_FILAS, cortar, dato, defineHerramienta, fechaDia, instante, monto, paginacion, pagina, periodoDe, respuesta, sinAcceso } from './base';

const RESIDENTE = ['propietario', 'inquilino'] as const;
const ESTADOS_CARGO = ['pagado', 'pendiente', 'vencido', 'en_revision'] as const;

export function unidadesPropias(u: AuthUser): Prisma.UnidadWhereInput {
  if (u.rol === 'propietario') return { propietario_id: u.id };
  if (u.rol === 'inquilino') return { inquilino_id: u.id };
  throw sinAcceso();
}
const misCargos = (u: AuthUser): Prisma.ReciboConceptoUnidadWhereInput => ({ unidad: unidadesPropias(u) });

export const misUnidades = defineHerramienta({
  nombre: 'mis_unidades',
  descripcion: 'Las unidades (departamentos, casas) de la persona que escribe: código, tipo, condominio, block y si es propietaria o inquilina. Úsala para «¿qué unidades tengo?». Ejemplo: {}.',
  entrada: z.strictObject({}),
  roles: RESIDENTE,
  solo_lectura: true,
  async ejecutar(u) {
    const filas = await prisma.unidad.findMany({
      where: unidadesPropias(u),
      orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
      take: 50,
      select: { codigo: true, tipo: true, estado: true, inquilino_id: true, complejo: { select: { nombre: true } }, estructura: { select: { nombre: true } } },
    });
    return respuesta({
      filas: filas.map((x) => ({
        unidad: dato(x.codigo, 30), tipo: dato(x.tipo, 30), estado: dato(x.estado, 20), condominio: dato(x.complejo?.nombre), block: dato(x.estructura?.nombre),
        mi_rol: u.rol, tiene_inquilino: u.rol === 'propietario' ? x.inquilino_id != null : null,
      })),
    });
  },
});

export const miDeuda = defineHerramienta({
  nombre: 'mi_deuda',
  descripcion: 'La deuda de la persona que escribe: total (incluye lo que está en revisión), cargos vencidos, en revisión, próximo vencimiento y deuda por unidad. Úsala para «¿cuánto debo?» o «¿cuándo vence mi próximo recibo?». Ejemplo: {}.',
  entrada: z.strictObject({}),
  roles: RESIDENTE,
  solo_lectura: true,
  async ejecutar(u) {
    const mios = misCargos(u);
    const [deuda, vencidos, enRevision, proximo, porUnidad] = await Promise.all([
      prisma.reciboConceptoUnidad.aggregate({ where: { AND: [mios, noPagado] }, _sum: { monto: true } }),
      prisma.reciboConceptoUnidad.count({ where: { AND: [mios, filtroEstadoCargo('vencido')] } }),
      prisma.reciboConceptoUnidad.count({ where: { AND: [mios, filtroEstadoCargo('en_revision')] } }),
      prisma.reciboConceptoUnidad.findFirst({
        where: { AND: [mios, filtroEstadoCargo('pendiente')] },
        orderBy: [{ reciboConcepto: { recibo: { fecha_vencimiento: 'asc' } } }, { id: 'asc' }],
        select: { monto: true, unidad: { select: { codigo: true } }, reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { fecha_vencimiento: true } } } } },
      }),
      prisma.reciboConceptoUnidad.groupBy({ by: ['unidad_id'], where: { AND: [mios, noPagado] }, _sum: { monto: true } }),
    ]);
    // Las 50 con más deuda (quien tiene muchas unidades no revienta la respuesta); `unidades_con_deuda` dice cuántas hay en total.
    const mayores = [...porUnidad].sort((a, b) => Number(b._sum.monto ?? 0) - Number(a._sum.monto ?? 0)).slice(0, MAX_FILAS);
    const unidades = await prisma.unidad.findMany({ where: { AND: [unidadesPropias(u), { id: { in: mayores.map((g) => g.unidad_id).filter((x): x is number => x != null) } }] }, select: { id: true, codigo: true } });
    const codigo = new Map(unidades.map((x) => [x.id, x.codigo]));
    return respuesta({
      deuda_total: monto(deuda._sum.monto),
      cargos_vencidos: vencidos,
      cargos_en_revision: enRevision,
      proximo_vencimiento: proximo ? { fecha: fechaDia(proximo.reciboConcepto?.recibo?.fecha_vencimiento), monto: monto(proximo.monto), concepto: dato(proximo.reciboConcepto?.concepto?.nombre), unidad: dato(proximo.unidad?.codigo, 30) } : null,
      unidades_con_deuda: porUnidad.length,
      por_unidad: mayores.map((g) => ({ unidad: dato(g.unidad_id == null ? null : codigo.get(g.unidad_id), 30), deuda: monto(g._sum.monto) })),
    });
  },
});

export const misRecibos = defineHerramienta({
  nombre: 'mis_recibos',
  descripcion: 'Los cargos/recibos de la persona que escribe, con concepto, periodo, monto, estado (pendiente, vencido, en_revision, pagado) y vencimiento. Úsala para «¿qué recibos tengo vencidos?». Ejemplo: {"estado":"vencido"}.',
  entrada: z.strictObject({ estado: z.enum(ESTADOS_CARGO).optional(), ...paginacion }),
  roles: RESIDENTE,
  solo_lectura: true,
  async ejecutar(u, e) {
    const p = pagina(e);
    const filas = await prisma.reciboConceptoUnidad.findMany({
      where: { AND: [misCargos(u), e.estado ? filtroEstadoCargo(e.estado) : {}] },
      orderBy: [{ reciboConcepto: { recibo: { fecha_vencimiento: 'desc' } } }, { id: 'desc' }],
      skip: p.skip,
      take: p.take,
      select: { id: true, monto: true, estado_pago: true, unidad: { select: { codigo: true } }, reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { mes: true, anio: true, fecha_vencimiento: true } } } } },
    });
    const c = cortar(filas, p);
    return respuesta({
      filas: c.filas.map((x) => ({
        unidad: dato(x.unidad?.codigo, 30), concepto: dato(x.reciboConcepto?.concepto?.nombre), periodo: periodoDe(x.reciboConcepto?.recibo?.anio, x.reciboConcepto?.recibo?.mes),
        monto: monto(x.monto), estado: estadoCargo(x.estado_pago, x.reciboConcepto?.recibo?.fecha_vencimiento), vencimiento: fechaDia(x.reciboConcepto?.recibo?.fecha_vencimiento),
      })),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const misPagos = defineHerramienta({
  nombre: 'mis_pagos',
  descripcion: 'Los pagos registrados para las unidades de la persona que escribe: monto, fecha, método y estado (por_validar = en revisión, validado, rechazado; con el motivo si lo rechazaron). Úsala para «¿ya me validaron el pago?». Ejemplo: {"estado":"por_validar"}.',
  entrada: z.strictObject({ estado: z.enum(['por_validar', 'validado', 'rechazado']).optional(), ...paginacion }),
  roles: RESIDENTE,
  solo_lectura: true,
  async ejecutar(u, e) {
    const p = pagina(e);
    const filas = await prisma.pago.findMany({
      where: { AND: [{ reciboConceptoUnidad: misCargos(u) }, e.estado ? { estado_validacion: e.estado } : {}] },
      orderBy: [{ fecha_pago: 'desc' }, { id: 'desc' }],
      skip: p.skip,
      take: p.take,
      select: {
        id: true, monto: true, fecha_pago: true, metodo_pago: true, estado_validacion: true, motivo_rechazo: true,
        reciboConceptoUnidad: { select: { unidad: { select: { codigo: true } }, reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { mes: true, anio: true } } } } } },
      },
    });
    const c = cortar(filas, p);
    return respuesta({
      filas: c.filas.map((x) => ({
        id: x.id, unidad: dato(x.reciboConceptoUnidad?.unidad?.codigo, 30), concepto: dato(x.reciboConceptoUnidad?.reciboConcepto?.concepto?.nombre),
        periodo: periodoDe(x.reciboConceptoUnidad?.reciboConcepto?.recibo?.anio, x.reciboConceptoUnidad?.reciboConcepto?.recibo?.mes),
        monto: monto(x.monto), fecha_pago: instante(x.fecha_pago), metodo: dato(x.metodo_pago, 30), estado: x.estado_validacion,
        motivo_rechazo: x.estado_validacion === 'rechazado' ? dato(x.motivo_rechazo, 200) : null,
      })),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const mediosParaPagar = defineHerramienta({
  nombre: 'medios_para_pagar',
  descripcion: 'A dónde pagar: los medios de pago ACTIVOS del block y del condominio de la persona que escribe (cuenta bancaria, Yape o Plin). Úsala para «¿cómo/dónde pago?». House no cobra: el pago se hace por fuera y luego se registra el comprobante. Ejemplo: {}.',
  entrada: z.strictObject({}),
  roles: RESIDENTE,
  solo_lectura: true,
  async ejecutar(u) {
    const unidades = await prisma.unidad.findMany({ where: unidadesPropias(u), take: 50, select: { complejo_id: true, estructura_id: true } });
    const medios = await prisma.medioPago.findMany({
      where: { activo: true, ...medioDeUnidades(unidades) },
      orderBy: [{ orden: 'asc' }, { id: 'asc' }],
      take: 20,
      select: { tipo: true, banco: true, tipo_cuenta: true, numero_cuenta: true, cci: true, titular: true, celular: true, estructura_id: true, qr_nombre: true },
    });
    const filas = [...medios.filter((m) => m.estructura_id != null), ...medios.filter((m) => m.estructura_id == null)].map((m) => ({
      tipo: dato(m.tipo, 20), banco: dato(m.banco, 40), tipo_cuenta: dato(m.tipo_cuenta, 20), numero_cuenta: dato(m.numero_cuenta, 30), cci: dato(m.cci, 30),
      titular: dato(m.titular), celular: dato(m.celular, 20), tiene_qr: m.qr_nombre != null, ambito: m.estructura_id != null ? 'block' : 'condominio',
    }));
    return respuesta({ filas, nota: filas.length ? null : 'Todavía no hay medios de pago publicados para tu block; consulta con la administración.' });
  },
});

export const HERRAMIENTAS_RESIDENTE = [misUnidades, miDeuda, misRecibos, misPagos, mediosParaPagar];
