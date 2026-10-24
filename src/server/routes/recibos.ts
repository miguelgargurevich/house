import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { notFound, invalid } from '../errors';
import { estadoCargo, includeCargo, formatearCargo } from '../lib/cargos';
import { hoyLima } from '../lib/fechas';
import { scopeComplejos, scopeConceptos, scopeRecibos } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { encolarReciboEmitido, procesarPronto } from '../services/avisos';
import { fechaSchema, idSchema, montoSchema, parseId, texto, textoOpcional, z } from '../validation';

const conceptoItem = z.object({ concepto_id: idSchema, monto: montoSchema, es_recargo: z.boolean().optional() });

const createSchema = z
  .object({
    complejo_id: idSchema,
    mes: z.number().int().min(1).max(12),
    anio: z.number().int().min(2000).max(2100),
    fecha_emision: fechaSchema,
    fecha_vencimiento: fechaSchema,
    descripcion: textoOpcional(300),
    conceptos: z.array(conceptoItem).max(50).default([]),
  })
  .refine((d) => d.fecha_vencimiento >= d.fecha_emision, { message: 'fecha_vencimiento no puede ser anterior a fecha_emision', path: ['fecha_vencimiento'] });

const updateSchema = z.object({
  mes: z.number().int().min(1).max(12).optional(),
  anio: z.number().int().min(2000).max(2100).optional(),
  fecha_emision: fechaSchema.optional(),
  fecha_vencimiento: fechaSchema.optional(),
  descripcion: textoOpcional(300),
  estado: texto(30).optional(),
});

type Totales = { monto: string; cobrado: string; pendiente: string; en_revision: string };

async function totalesPorRecibo(ids: number[]): Promise<Map<number, Totales>> {
  const mapa = new Map<number, Totales>();
  if (!ids.length) return mapa;
  const filas = await prisma.$queryRaw<{ recibo_id: number; monto: Prisma.Decimal; cobrado: Prisma.Decimal; en_revision: Prisma.Decimal }[]>`
    SELECT rc.recibo_id,
           COALESCE(SUM(rcu.monto), 0) AS monto,
           COALESCE(SUM(CASE WHEN rcu.estado_pago = 'pagado' THEN rcu.monto ELSE 0 END), 0) AS cobrado,
           COALESCE(SUM(CASE WHEN rcu.estado_pago = 'en_revision' THEN rcu.monto ELSE 0 END), 0) AS en_revision
    FROM "ReciboConceptoUnidad" rcu
    JOIN "ReciboConcepto" rc ON rc.id = rcu.recibo_concepto_id
    WHERE rc.recibo_id IN (${Prisma.join(ids)})
    GROUP BY rc.recibo_id`;
  for (const f of filas) {
    const monto = new Prisma.Decimal(f.monto);
    const cobrado = new Prisma.Decimal(f.cobrado);
    mapa.set(f.recibo_id, { monto: monto.toFixed(2), cobrado: cobrado.toFixed(2), pendiente: monto.minus(cobrado).toFixed(2), en_revision: new Prisma.Decimal(f.en_revision).toFixed(2) });
  }
  return mapa;
}

function conTotales(r: { id: number; fecha_vencimiento: Date }, t: Totales | undefined) {
  const totales = t ?? { monto: '0.00', cobrado: '0.00', pendiente: '0.00', en_revision: '0.00' };
  const pendiente = new Prisma.Decimal(totales.pendiente);
  // Lo que está en revisión sigue «por cobrar» (pendiente) pero no puede dejar el recibo como vencido.
  const moroso = pendiente.minus(totales.en_revision);
  const monto = new Prisma.Decimal(totales.monto);
  const estado_cobranza = monto.gt(0) && pendiente.lte(0) ? 'pagado' : r.fecha_vencimiento < hoyLima() && moroso.gt(0) ? 'vencido' : 'pendiente';
  return { totales, estado_cobranza };
}

const crud = crudRouter({
  entidad: 'recibo',
  delegate: prisma.recibo,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeRecibos,
  search: ['descripcion'],
  orderable: ['id', 'mes', 'anio', 'fecha_emision', 'fecha_vencimiento', 'estado', 'created_at'],
  defaultOrder: { fecha_emision: 'desc' },
  include: { complejo: { select: { id: true, nombre: true } } },
  filtros: {
    schema: z.object({
      complejo_id: idSchema.optional(),
      estado: z.string().max(30).optional(),
      mes: z.coerce.number().int().min(1).max(12).optional(),
      anio: z.coerce.number().int().min(2000).max(2100).optional(),
    }),
    where: (f) => ({
      ...(f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}),
      ...(f.estado ? { estado: f.estado } : {}),
      ...(f.mes !== undefined ? { mes: f.mes } : {}),
      ...(f.anio !== undefined ? { anio: f.anio } : {}),
    }),
  },
  createSchema,
  updateSchema,
  async format(items) {
    const t = await totalesPorRecibo(items.map((r) => r.id));
    return items.map((r) => ({ ...r, ...conTotales(r, t.get(r.id)) }));
  },
  // Crea el recibo, sus conceptos y un cargo por cada unidad activa del complejo, en una sola transacción.
  async create(data, user) {
    const d = data as z.infer<typeof createSchema>;
    const complejo = await assertRef(prisma.complejoHabitacional, d.complejo_id, scopeComplejos(user), 'complejo_id');
    const empresa_id = complejo!.empresa_id as number | null;
    const ids = [...new Set(d.conceptos.map((c) => c.concepto_id))];
    if (ids.length) {
      const validos = await prisma.concepto.count({
        where: { AND: [{ id: { in: ids } }, scopeConceptos(user), { activo: true }, { empresa_id }] },
      });
      if (validos !== ids.length) throw invalid('Datos inválidos: conceptos: algún concepto no existe, está inactivo o es de otra empresa', { conceptos: 'Concepto inválido' });
    }
    const emitido = await prisma.$transaction(async (tx) => {
      const recibo = await tx.recibo.create({
        data: {
          complejo_id: d.complejo_id,
          empresa_id,
          mes: d.mes,
          anio: d.anio,
          fecha_emision: d.fecha_emision,
          fecha_vencimiento: d.fecha_vencimiento,
          descripcion: d.descripcion,
          estado: 'emitido',
          creado_por_id: user.id,
        },
      });
      const unidades = await tx.unidad.findMany({ where: { complejo_id: d.complejo_id, estado: 'activa' }, select: { id: true } });
      for (const [i, c] of d.conceptos.entries()) {
        const rc = await tx.reciboConcepto.create({
          data: { recibo_id: recibo.id, concepto_id: c.concepto_id, monto: c.monto, es_recargo: c.es_recargo ?? false, orden: i + 1 },
        });
        if (unidades.length) {
          await tx.reciboConceptoUnidad.createMany({
            data: unidades.map((u) => ({ recibo_concepto_id: rc.id, unidad_id: u.id, monto: c.monto, estado_pago: 'pendiente' })),
          });
        }
      }
      return recibo;
    });
    // Avisos al propietario e inquilino de cada unidad con cargo. Un fallo aquí nunca debe deshacer la emisión.
    try {
      await encolarReciboEmitido(emitido.id);
      procesarPronto();
    } catch (err) {
      console.error('[avisos] no se pudieron encolar los avisos del recibo', emitido.id, err instanceof Error ? err.message : 'error');
    }
    return emitido;
  },
});

const router = Router();

// Detalle ampliado: conceptos y cargos por unidad (se declara antes del CRUD para tomar GET /:id).
router.get('/:id', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const recibo = await prisma.recibo.findFirst({
    where: { AND: [{ id }, scopeRecibos(user)] },
    include: {
      complejo: { select: { id: true, nombre: true } },
      reciboConceptos: { orderBy: { orden: 'asc' }, include: { concepto: { select: { id: true, nombre: true } } } },
    },
  });
  if (!recibo) throw notFound();
  const { reciboConceptos, ...resto } = recibo;
  const cargosDb = await prisma.reciboConceptoUnidad.findMany({
    where: { reciboConcepto: { recibo_id: id } },
    include: includeCargo,
    orderBy: [{ unidad: { codigo: 'asc' } }, { id: 'asc' }],
    take: 2000,
  });
  const t = (await totalesPorRecibo([id])).get(id);
  res.json({
    ...resto,
    ...conTotales(recibo, t),
    conceptos: reciboConceptos.map((rc) => ({ id: rc.id, concepto_id: rc.concepto_id, concepto: rc.concepto, monto: rc.monto, es_recargo: rc.es_recargo, orden: rc.orden })),
    cargos: cargosDb.map((c) => {
      const f = formatearCargo(c);
      return { id: c.id, unidad: c.unidad, concepto: f.concepto, monto: c.monto, estado: estadoCargo(c.estado_pago, recibo.fecha_vencimiento) };
    }),
  });
});
router.use(crud);

export { router as recibosRouter };
