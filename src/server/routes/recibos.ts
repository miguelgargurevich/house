import { Prisma } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { forbidden, notFound, invalid } from '../errors';
import { estadoCargo, includeCargo, formatearCargo } from '../lib/cargos';
import { hoyLima } from '../lib/fechas';
import { ambitoJunta, filtroAmbito } from '../lib/junta';
import { ORDEN_MANTENIMIENTOS, estadosQuery, agruparPorBlock, listarMantenimientos, resumenPorBlock, type OrdenMantenimientos } from '../lib/mantenimientos';
import { scopeComplejos, scopeConceptos, scopeRecibos, scopeRecibosEscritura, scopeUnidades, scopeUsuarios } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { encolarReciboEmitido, procesarPronto } from '../services/avisos';
import { detalleMantenimiento, pagarMantenimiento } from '../services/mantenimiento';
import { fechaSchema, idSchema, listQuerySchema, montoSchema, parse, parseBody, parseId, parseOrden, texto, textoOpcional, z } from '../validation';
import { METODOS_PAGO } from './pagos';

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
  writeScope: scopeRecibosEscritura,
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

// ---------- Administración o junta (24-oct, Miguel: «la junta también puede registrar pagos») ----------
// La junta gestora (presidente o tesorero) ve los periodos de su condominio y registra pagos de los mantenimientos de su ámbito
// (su block, o todo el condominio si no tiene block). Todo lo demás de recibos sigue siendo de la administración.
const esAdmin = (u: AuthUser) => u.rol === 'admin' || u.rol === 'superadmin';
const adminOJunta: RequestHandler = (req, _res, next) => {
  const u = currentUser(req);
  if (esAdmin(u) || ambitoJunta(u)) return next();
  throw forbidden();
};
/** Recibos que alcanza: la administración por empresa; la junta, los de su condominio. */
function recibosDe(u: AuthUser): Prisma.ReciboWhereInput {
  if (esAdmin(u)) return scopeRecibos(u);
  const a = ambitoJunta(u);
  return a ? { complejo_id: a.complejo_id } : { id: -1 };
}
/** Unidades que alcanza: la administración por empresa; la junta, las de su block (o de su condominio). */
function unidadesDe(u: AuthUser): Prisma.UnidadWhereInput {
  if (esAdmin(u)) return scopeUnidades(u);
  const a = ambitoJunta(u);
  return a ? filtroAmbito(a) : { id: -1 };
}

/** Periodos emitidos que alcanza (para elegir dónde registrar un pago). Se declara antes de GET /:id. */
router.get('/periodos', adminOJunta, async (req, res) => {
  const items = await prisma.recibo.findMany({
    where: esAdmin(currentUser(req)) ? scopeRecibosEscritura(currentUser(req)) : recibosDe(currentUser(req)), // los periodos donde SE PUEDE cobrar
    orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { id: 'desc' }],
    take: 24,
    select: { id: true, mes: true, anio: true, descripcion: true, fecha_emision: true, fecha_vencimiento: true, estado: true, complejo: { select: { id: true, nombre: true } } },
  });
  res.json({ items, total: items.length, page: 1, pageSize: 24 });
});

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
  // `?sin_cargos=1`: sólo la cabecera, los conceptos y los totales (la pantalla del periodo pagina los departamentos aparte).
  const sinCargos = req.query.sin_cargos === '1';
  const cargosDb = sinCargos ? [] : await prisma.reciboConceptoUnidad.findMany({
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
// ---------- Mantenimientos del periodo (un recibo por departamento) ----------
/** El recibo del periodo, sólo si es de la empresa del usuario (si no, 404). */
async function reciboAccesible(req: Parameters<typeof currentUser>[0], id: number, escritura = false) {
  const u = currentUser(req);
  const r = await prisma.recibo.findFirst({ where: { AND: [{ id }, escritura && esAdmin(u) ? scopeRecibosEscritura(u) : recibosDe(u)] }, select: { id: true } });
  if (!r) throw notFound();
}

/** Totales del periodo por block; `agrupado` = hay más de un block (si no, la pantalla va directo a los departamentos). */
router.get('/:id/blocks', requireRole('admin'), async (req, res) => {
  const id = parseId(req);
  await reciboAccesible(req, id);
  const blocks = await resumenPorBlock(id);
  res.json({ agrupado: agruparPorBlock(blocks), blocks });
});

const mantQuery = listQuerySchema.extend({
  estado: estadosQuery,
  estructura_id: idSchema.optional(),
  sin_block: z.enum(['true', 'false']).optional(),
});

router.get('/:id/mantenimientos', adminOJunta, async (req, res) => {
  const id = parseId(req);
  await reciboAccesible(req, id);
  const q = parse(mantQuery, req.query);
  // La junta de un block sólo ve los departamentos de su block, pida lo que pida.
  const a = esAdmin(currentUser(req)) ? null : ambitoJunta(currentUser(req));
  const orden = parseOrden(q.orden, [...ORDEN_MANTENIMIENTOS], {});
  const campo = Object.keys(orden)[0] as OrdenMantenimientos | undefined;
  const r = await listarMantenimientos(
    { reciboId: id, estado: q.estado, q: q.q, estructuraId: a?.estructura_id != null ? a.estructura_id : q.sin_block === 'true' ? null : q.estructura_id },
    { page: q.page, pageSize: q.pageSize, orden: campo ? { campo, dir: (orden as Record<string, 'asc' | 'desc'>)[campo] } : { campo: 'codigo', dir: 'asc' } },
  );
  res.json({ items: r.items, total: r.total, page: q.page, pageSize: q.pageSize });
});

const idsMant = z.object({ id: idSchema, unidadId: idSchema });

router.get('/:id/mantenimientos/:unidadId', adminOJunta, async (req, res) => {
  const u = currentUser(req);
  const { id, unidadId } = parse(idsMant, req.params);
  res.json(await detalleMantenimiento(id, unidadId, { reciboWhere: recibosDe(u), unidadWhere: unidadesDe(u), vista: 'completa' }));
});

const pagoMantenimiento = z.strictObject({
  metodo_pago: z.enum(METODOS_PAGO, { error: `metodo_pago debe ser: ${METODOS_PAGO.join(', ')}` }),
  referencia: textoOpcional(120),
  observaciones: textoOpcional(500),
  fecha_pago: fechaSchema.optional(),
  usuario_id: idSchema.nullish(),
});

/** La administración o la junta registran el pago del mantenimiento completo: queda validado de inmediato (el comprobante es opcional y se sube después). */
router.post('/:id/mantenimientos/:unidadId/pagos', adminOJunta, async (req, res) => {
  const u = currentUser(req);
  const { id, unidadId } = parse(idsMant, req.params);
  const body = parseBody(pagoMantenimiento, req);
  await reciboAccesible(req, id, true); // cobrar es de quien administra el condominio hoy; la administradora anterior sólo consulta
  const unidad = await prisma.unidad.findFirst({ where: { AND: [{ id: unidadId }, unidadesDe(u)] }, select: { id: true, propietario_id: true, inquilino_id: true } });
  if (!unidad) throw notFound('Mantenimiento');
  const { usuario_id, ...datos } = body;
  if (usuario_id != null) {
    if (esAdmin(u)) await assertRef(prisma.usuario, usuario_id, scopeUsuarios(u), 'usuario_id');
    // La junta sólo puede atribuir el pago al propietario o al inquilino de ese departamento.
    else if (usuario_id !== unidad.propietario_id && usuario_id !== unidad.inquilino_id) throw invalid('Datos inválidos: usuario_id: debe ser el propietario o el inquilino del departamento', { usuario_id: 'Debe ser el propietario o el inquilino' });
  }
  const r = await pagarMantenimiento({ reciboId: id, unidadId, usuarioId: usuario_id ?? null, modo: 'administracion', validadorId: u.id, ...datos });
  res.locals.entidad = 'pago';
  res.locals.entidadId = r.pago_id;
  res.locals.auditDetalle = { grupo: r.grupo, total: r.total, cargos: r.cargos, recibo_id: id, unidad_id: unidadId };
  // El recibo ya se validó arriba: al cobrar la última unidad deja de tener deuda y `recibosDe` dejaría de alcanzarlo (404 tras haber cobrado).
  res.status(201).json({ ...r, mantenimiento: await detalleMantenimiento(id, unidadId, { unidadWhere: unidadesDe(u), vista: 'completa' }) });
});

router.use(crud);

export { router as recibosRouter };
