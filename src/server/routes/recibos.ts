import { Prisma } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { conflict, forbidden, notFound, invalid } from '../errors';
import { estadoCargo, includeCargo, formatearCargo } from '../lib/cargos';
import { MONEDA_POR_DEFECTO, ZONA_POR_DEFECTO, formatoDinero } from '../../lib/paises';
import { hoyEn } from '../lib/fechas';
import { zonaDeRecibo } from '../lib/zonas';
import { monedaDeRecibo } from '../lib/paisMoneda';
import { ambitoJunta, filtroAmbito, filtroReciboAmbito } from '../lib/junta';
import { descripcionRecibo, periodoTexto } from '../lib/periodo';
import { ORDEN_MANTENIMIENTOS, estadosQuery, agruparPorBlock, listarMantenimientos, resumenPorBlock, type OrdenMantenimientos } from '../lib/mantenimientos';
import { scopeComplejos, scopeConceptos, scopeRecibos, scopeRecibosEscritura, scopeUnidades, scopeUsuarios } from '../lib/scope';
import { bloquearPeriodo, recibosDelPeriodo } from '../services/reciboUnico';
import { ipDe, registrarAuditoria } from '../middleware/audit';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { encolarReciboEmitido, procesarPronto } from '../services/avisos';
import { detalleMantenimiento, pagarMantenimiento } from '../services/mantenimiento';
import { iniciarEvaluacion } from '../services/evaluacion';
import { agregarMora, esConceptoMora, informeDeMora, montoDeMoraAplicable, type InformeMora, type UnidadConMora } from '../services/mora';
import { fechaSchema, idSchema, listQuerySchema, montoSchema, parse, parseBody, parseId, parseOrden, texto, textoOpcional, z } from '../validation';
import { METODOS_PAGO } from './pagos';
import { buscarEstructura, codigoEncajaConDpto, indiceFilaBlock, leerCabecera, leerConceptos, limpiarMonto, normalizarTexto, numeroDeTorre, redondearMonto, TOLERANCIA_TOTAL } from '../lib/excelRecibos';
import multer from 'multer';
import { camposDeFormulario, recibirVoucher, ubicado, voucherVerificado } from '../lib/voucherSubida';
import XLSX from 'xlsx';

const conceptoItem = z.object({ concepto_id: idSchema, monto: montoSchema, es_recargo: z.boolean().optional() });

const createSchema = z
  .object({
    complejo_id: idSchema,
    /** Torre del recibo. Sin torre (o null): en un condominio sin torres, el recibo único; en uno con torres, «todas las torres» (un recibo por torre). */
    estructura_id: idSchema.nullish(),
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

/** `estado_cobranza` cuenta el día de hoy en la zona del condominio del recibo (Lima si no tiene). */
function conTotales(r: { id: number; fecha_vencimiento: Date; complejo?: { zona_horaria?: string } | null }, t: Totales | undefined, ahora: Date = new Date()) {
  const totales = t ?? { monto: '0.00', cobrado: '0.00', pendiente: '0.00', en_revision: '0.00' };
  const pendiente = new Prisma.Decimal(totales.pendiente);
  // Lo que está en revisión sigue «por cobrar» (pendiente) pero no puede dejar el recibo como vencido.
  const moroso = pendiente.minus(totales.en_revision);
  const monto = new Prisma.Decimal(totales.monto);
  const estado_cobranza = monto.gt(0) && pendiente.lte(0) ? 'pagado' : r.fecha_vencimiento < hoyEn(r.complejo?.zona_horaria ?? ZONA_POR_DEFECTO, ahora) && moroso.gt(0) ? 'vencido' : 'pendiente';
  return { totales, estado_cobranza };
}

const includeRecibo = { complejo: { select: { id: true, nombre: true, moneda: true, zona_horaria: true } }, estructura: { select: { id: true, nombre: true } } } satisfies Prisma.ReciboInclude;

/** Cada recibo lleva `moneda` (la de su condominio): todos sus montos y totales van en ella. */
async function formatearRecibos<T extends { id: number; fecha_vencimiento: Date; complejo?: { moneda: string; zona_horaria?: string } | null }>(items: T[]) {
  const t = await totalesPorRecibo(items.map((r) => r.id));
  return items.map((r) => ({ ...r, moneda: r.complejo?.moneda ?? MONEDA_POR_DEFECTO, ...conTotales(r, t.get(r.id)) }));
}

/** Un recibo por cada torre con unidades activas (y uno sin torre si quedan unidades sin torre); sin torres, uno solo. */
interface RecibosAEmitir { estructuraId: number | null; torre: string | null; unidades: number[] }

async function planDeEmision(tx: Prisma.TransactionClient, complejoId: number, estructuraId: number | null | undefined): Promise<RecibosAEmitir[]> {
  const estructuras = await tx.estructura.findMany({ where: { complejo_id: complejoId }, select: { id: true, nombre: true }, orderBy: { id: 'asc' } });
  const unidades = await tx.unidad.findMany({ where: { complejo_id: complejoId, estado: 'activa' }, select: { id: true, estructura_id: true }, orderBy: { id: 'asc' } });
  if (estructuraId != null) {
    const torre = estructuras.find((e) => e.id === estructuraId);
    if (!torre) throw invalid('Datos inválidos: estructura_id: la torre no existe en ese condominio', { estructura_id: 'No es una torre de este condominio' });
    return [{ estructuraId, torre: torre.nombre, unidades: unidades.filter((u) => u.estructura_id === estructuraId).map((u) => u.id) }];
  }
  const plan: RecibosAEmitir[] = estructuras
    .map((e) => ({ estructuraId: e.id as number | null, torre: e.nombre, unidades: unidades.filter((u) => u.estructura_id === e.id).map((u) => u.id) }))
    .filter((g) => g.unidades.length > 0);
  const sinTorre = unidades.filter((u) => u.estructura_id == null || !estructuras.some((e) => e.id === u.estructura_id)).map((u) => u.id);
  // Sin torres (o unidades que quedaron sin torre) hay UN recibo sin torre; un condominio sin unidades también lo emite, vacío, como siempre.
  if (sinTorre.length > 0 || plan.length === 0) plan.push({ estructuraId: null, torre: null, unidades: sinTorre });
  return plan;
}

/**
 * Emite el recibo del periodo: uno por torre (o el de la torre pedida), cada uno con sus conceptos y un cargo por cada unidad activa DE ESA
 * torre, todo en una sola transacción. Si alguno de esos recibos ya existe, no se crea ninguno (409 con la torre en el mensaje).
 */
async function emitirRecibos(d: z.infer<typeof createSchema>, user: AuthUser): Promise<{ ids: number[]; mora: InformeMora; avisosMora: string[] }> {
  const complejo = await assertRef(prisma.complejoHabitacional, d.complejo_id, scopeComplejos(user), 'complejo_id');
  const empresa_id = complejo!.empresa_id as number | null;
  const montoMora = await montoDeMoraAplicable(d.complejo_id, complejo!.mora_monto as Prisma.Decimal | undefined);
  const ids = [...new Set(d.conceptos.map((c) => c.concepto_id))];
  let multaPropia = false;
  if (ids.length) {
    const validos = await prisma.concepto.findMany({
      where: { AND: [{ id: { in: ids } }, scopeConceptos(user), { activo: true }, { empresa_id }] },
      select: { id: true, nombre: true },
    });
    if (validos.length !== ids.length) throw invalid('Datos inválidos: conceptos: algún concepto no existe, está inactivo o es de otra empresa', { conceptos: 'Concepto inválido' });
    // Si quien emite ya incluye una multa con monto (> 0) para todas las unidades, se respeta y no se agrega mora encima.
    const multas = new Set(validos.filter((c) => esConceptoMora(c.nombre)).map((c) => c.id));
    multaPropia = d.conceptos.some((c) => multas.has(c.concepto_id) && new Prisma.Decimal(c.monto).gt(0));
  }
  const moraPorRecibo: { reciboId: number; torre: string | null; unidades: UnidadConMora[] }[] = [];
  const avisosMora: string[] = [];
  const emitidos = await prisma.$transaction(async (tx) => {
    await bloquearPeriodo(tx, d.complejo_id, d.mes, d.anio);
    const plan = await planDeEmision(tx, d.complejo_id, d.estructura_id);
    const creados: number[] = [];
    for (const g of plan) {
      const { mismo, general } = await recibosDelPeriodo(tx, { complejoId: d.complejo_id, estructuraId: g.estructuraId, mes: d.mes, anio: d.anio });
      const donde = `${periodoTexto(d.mes, d.anio)}${g.torre ? ` · ${g.torre}` : ''}`;
      if (mismo) throw conflict(`Ya existe el recibo de ${donde}`);
      if (general) throw conflict(`Ya existe un recibo de ${periodoTexto(d.mes, d.anio)} sin torre que cobra a unidades de ${g.torre ?? 'esta torre'}`);
    }
    for (const g of plan) {
      const descripcion = d.descripcion ? (plan.length > 1 && g.torre ? `${d.descripcion} · ${g.torre}` : d.descripcion).slice(0, 300) : descripcionRecibo(d.mes, d.anio, g.torre);
      const recibo = await tx.recibo.create({
        data: {
          complejo_id: d.complejo_id,
          estructura_id: g.estructuraId,
          empresa_id,
          mes: d.mes,
          anio: d.anio,
          fecha_emision: d.fecha_emision,
          fecha_vencimiento: d.fecha_vencimiento,
          descripcion,
          estado: 'emitido',
          creado_por_id: user.id,
        },
      });
      for (const [i, c] of d.conceptos.entries()) {
        const rc = await tx.reciboConcepto.create({
          data: { recibo_id: recibo.id, concepto_id: c.concepto_id, monto: c.monto, es_recargo: c.es_recargo ?? false, orden: i + 1 },
        });
        if (g.unidades.length) {
          await tx.reciboConceptoUnidad.createMany({
            data: g.unidades.map((u) => ({ recibo_concepto_id: rc.id, unidad_id: u, monto: c.monto, estado_pago: 'pendiente' })),
          });
        }
      }
      creados.push(recibo.id);
      // Mora de S/ 20 (configurable) para quien pagó fuera de fecha el recibo del mes anterior de ESTA torre.
      const mora = await agregarMora(tx, { reciboId: recibo.id, complejoId: d.complejo_id, estructuraId: g.estructuraId, empresaId: empresa_id, mes: d.mes, anio: d.anio, unidadIds: g.unidades, monto: montoMora, respetar: multaPropia ? new Set(g.unidades) : undefined });
      moraPorRecibo.push({ reciboId: recibo.id, torre: g.torre, unidades: mora.unidades });
      if (mora.aviso) avisosMora.push(g.torre ? `${g.torre}: ${mora.aviso}` : mora.aviso);
    }
    return creados;
  });
  // Avisos al propietario e inquilino de cada unidad con cargo. Un fallo aquí nunca debe deshacer la emisión.
  for (const id of emitidos) {
    try {
      await encolarReciboEmitido(id);
      procesarPronto();
    } catch (err) {
      console.error('[avisos] no se pudieron encolar los avisos del recibo', id, err instanceof Error ? err.message : 'error');
    }
  }
  return { ids: emitidos, mora: informeDeMora(montoMora, moraPorRecibo, complejo!.moneda as string), avisosMora };
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
  include: includeRecibo,
  filtros: {
    schema: z.object({
      complejo_id: idSchema.optional(),
      estructura_id: idSchema.optional(),
      estado: z.string().max(30).optional(),
      mes: z.coerce.number().int().min(1).max(12).optional(),
      anio: z.coerce.number().int().min(2000).max(2100).optional(),
    }),
    where: (f) => ({
      ...(f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}),
      ...(f.estructura_id !== undefined ? { estructura_id: f.estructura_id } : {}),
      ...(f.estado ? { estado: f.estado } : {}),
      ...(f.mes !== undefined ? { mes: f.mes } : {}),
      ...(f.anio !== undefined ? { anio: f.anio } : {}),
    }),
  },
  createSchema,
  updateSchema,
  format: formatearRecibos,
  // El POST real es `router.post('/')` (declarado antes que el CRUD: puede emitir varios recibos a la vez); esto es sólo el respaldo si se llegara aquí.
  async create(data, user) {
    const { ids: [id] } = await emitirRecibos(data as z.infer<typeof createSchema>, user);
    return { id: id! };
  },
  // Cambiar mes o año no puede dejar dos recibos de la misma torre en el mismo periodo.
  async prepareUpdate(data, _user, existing) {
    if (data.mes === undefined && data.anio === undefined) return data;
    const mes = (data.mes as number | undefined) ?? (existing.mes as number);
    const anio = (data.anio as number | undefined) ?? (existing.anio as number);
    const complejoId = existing.complejo_id as number | null;
    if (complejoId == null) return data;
    await prisma.$transaction(async (tx) => {
      await bloquearPeriodo(tx, complejoId, mes, anio);
      const { mismo, general } = await recibosDelPeriodo(tx, { complejoId, estructuraId: existing.estructura_id as number | null, mes, anio, excluirId: existing.id as number });
      if (mismo || general) throw conflict(`Ya existe un recibo de ${periodoTexto(mes, anio)} para esa torre`);
    });
    return data;
  },
});

const router = Router();

// ---------- Administración o junta (24-oct, Miguel: «la junta también puede registrar pagos») ----------
// La junta gestora (presidente o tesorero) ve los periodos de su condominio y registra pagos de los mantenimientos de su ámbito
// (su block, o todo el condominio si no tiene block). Todo lo demás de recibos sigue siendo de la administración.
export const esAdmin = (u: AuthUser) => u.rol === 'admin' || u.rol === 'superadmin';
export const adminOJunta: RequestHandler = (req, _res, next) => {
  const u = currentUser(req);
  if (esAdmin(u) || ambitoJunta(u)) return next();
  throw forbidden();
};
/** Recibos que alcanza: la administración por empresa; la junta, los de su torre (o los del condominio si no tiene torre). */
export function recibosDe(u: AuthUser): Prisma.ReciboWhereInput {
  if (esAdmin(u)) return scopeRecibos(u);
  const a = ambitoJunta(u);
  return a ? filtroReciboAmbito(a) : { id: -1 };
}
/** Unidades que alcanza: la administración por empresa; la junta, las de su block (o de su condominio). */
export function unidadesDe(u: AuthUser): Prisma.UnidadWhereInput {
  if (esAdmin(u)) return scopeUnidades(u);
  const a = ambitoJunta(u);
  return a ? filtroAmbito(a) : { id: -1 };
}

/** Emitir el recibo del periodo: uno por torre (o el de la torre elegida). Responde el primero y la lista completa en `recibos`. */
router.post('/', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  const d = parseBody(createSchema, req);
  const { ids, mora, avisosMora } = await emitirRecibos(d, user);
  const filas = await prisma.recibo.findMany({ where: { id: { in: ids } }, include: includeRecibo, orderBy: { id: 'asc' } });
  const recibos = await formatearRecibos(filas);
  res.locals.entidad = 'recibo';
  res.locals.entidadId = ids[0];
  res.locals.auditDetalle = { recibo_ids: ids, mes: d.mes, anio: d.anio, torres: filas.map((r) => r.estructura?.nombre ?? null), mora: mora.cantidad };
  // `mora`: a quiénes se les agregó la mora por pago fuera de fecha del mes anterior (mensaje listo para mostrar); `advertencias`: lo que no se pudo evaluar.
  res.status(201).json({ ...recibos[0], recibos, mora, advertencias: avisosMora });
});

/**
 * Periodos emitidos que alcanza (para elegir dónde registrar un pago). Se declara antes de GET /:id. Cada torre tiene su recibo: se traen
 * los últimos 24 MESES (no 24 recibos) y de cada mes todos sus recibos, para que N torres no se coman los meses.
 */
router.get('/periodos', adminOJunta, async (req, res) => {
  const where = esAdmin(currentUser(req)) ? scopeRecibosEscritura(currentUser(req)) : recibosDe(currentUser(req)); // los periodos donde SE PUEDE cobrar
  const meses = await prisma.recibo.findMany({ where, distinct: ['anio', 'mes'], orderBy: [{ anio: 'desc' }, { mes: 'desc' }], take: 24, select: { anio: true, mes: true } });
  const items = meses.length
    ? await prisma.recibo.findMany({
        where: { AND: [where, { OR: meses.map((m) => ({ anio: m.anio, mes: m.mes })) }] },
        orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { estructura: { nombre: 'asc' } }, { id: 'desc' }],
        select: { id: true, mes: true, anio: true, descripcion: true, fecha_emision: true, fecha_vencimiento: true, estado: true, complejo: { select: { id: true, nombre: true, moneda: true } }, estructura: { select: { id: true, nombre: true } } },
      })
    : [];
  res.json({ items: items.map((r) => ({ ...r, moneda: r.complejo?.moneda ?? MONEDA_POR_DEFECTO })), total: items.length, page: 1, pageSize: items.length });
});

// Detalle ampliado: conceptos y cargos por unidad (se declara antes del CRUD para tomar GET /:id).
router.get('/:id', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const recibo = await prisma.recibo.findFirst({
    where: { AND: [{ id }, scopeRecibos(user)] },
    include: {
      complejo: { select: { id: true, nombre: true, moneda: true, zona_horaria: true } },
      estructura: { select: { id: true, nombre: true } },
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
    moneda: recibo.complejo?.moneda ?? MONEDA_POR_DEFECTO,
    ...conTotales(recibo, t),
    conceptos: reciboConceptos.map((rc) => ({ id: rc.id, concepto_id: rc.concepto_id, concepto: rc.concepto, monto: rc.monto, es_recargo: rc.es_recargo, orden: rc.orden })),
    cargos: cargosDb.map((c) => {
      const f = formatearCargo(c);
      return { id: c.id, unidad: c.unidad, concepto: f.concepto, monto: c.monto, estado: estadoCargo(c.estado_pago, recibo.fecha_vencimiento, hoyEn(recibo.complejo?.zona_horaria ?? ZONA_POR_DEFECTO)) };
    }),
  });
});
// ---------- Mantenimientos del periodo (un recibo por departamento) ----------
/** El recibo del periodo, sólo si es de la empresa del usuario (si no, 404). */
export async function reciboAccesible(req: Parameters<typeof currentUser>[0], id: number, escritura = false) {
  const u = currentUser(req);
  const r = await prisma.recibo.findFirst({ where: { AND: [{ id }, escritura && esAdmin(u) ? scopeRecibosEscritura(u) : recibosDe(u)] }, select: { id: true } });
  if (!r) throw notFound();
}

/** Totales del periodo por block; `agrupado` = hay más de un block (si no, la pantalla va directo a los departamentos). */
router.get('/:id/blocks', requireRole('admin'), async (req, res) => {
  const id = parseId(req);
  await reciboAccesible(req, id);
  const blocks = await resumenPorBlock(id, hoyEn(await zonaDeRecibo(id)));
  res.json({ agrupado: agruparPorBlock(blocks), moneda: await monedaDeRecibo(id), blocks });
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

/** El departamento del pago, sólo si lo alcanza quien cobra (404 si no). Cobrar es de quien administra el condominio hoy; la administradora anterior sólo consulta. */
async function ubicarParaCobrar(req: Parameters<typeof currentUser>[0], reciboId: number, unidadId: number) {
  const u = currentUser(req);
  await reciboAccesible(req, reciboId, true);
  const unidad = await prisma.unidad.findFirst({ where: { AND: [{ id: unidadId }, unidadesDe(u)] }, select: { id: true, propietario_id: true, inquilino_id: true } });
  if (!unidad) throw notFound('Mantenimiento');
  return unidad;
}

/** Con `multipart/form-data` el pago puede traer el voucher (campo `voucher`): el departamento se ubica ANTES de recibir el archivo (404 sin leer el cuerpo). Con JSON no hace nada. */
const voucherOpcional = recibirVoucher('unidadPago', (req) => {
  const { id, unidadId } = parse(idsMant, req.params);
  return ubicarParaCobrar(req, id, unidadId);
});

/**
 * La administración o la junta registran el pago del mantenimiento completo.
 *  - JSON (o formulario sin archivo): queda validado de inmediato; el comprobante es opcional y se sube después.
 *  - `multipart/form-data` con el campo `voucher`: el pago nace `por_validar` con el voucher guardado en la MISMA transacción, y se dispara la
 *    misma evaluación de IA del residente (valida sola con sus condiciones de siempre; si no, queda en revisión). Si el archivo no sirve no se crea nada.
 */
router.post('/:id/mantenimientos/:unidadId/pagos', adminOJunta, voucherOpcional, async (req, res) => {
  const u = currentUser(req);
  const { id, unidadId } = parse(idsMant, req.params);
  const multipart = Boolean(req.is('multipart/form-data'));
  const body = multipart ? parse(pagoMantenimiento, camposDeFormulario(req.body)) : parseBody(pagoMantenimiento, req);
  const unidad = ubicado<Awaited<ReturnType<typeof ubicarParaCobrar>>>(res, 'unidadPago') ?? (await ubicarParaCobrar(req, id, unidadId));
  const voucher = req.file ? voucherVerificado(req.file, u.id) : undefined;
  const { usuario_id, ...datos } = body;
  if (usuario_id != null) {
    if (esAdmin(u)) await assertRef(prisma.usuario, usuario_id, scopeUsuarios(u), 'usuario_id');
    // La junta sólo puede atribuir el pago al propietario o al inquilino de ese departamento.
    else if (usuario_id !== unidad.propietario_id && usuario_id !== unidad.inquilino_id) throw invalid('Datos inválidos: usuario_id: debe ser el propietario o el inquilino del departamento', { usuario_id: 'Debe ser el propietario o el inquilino' });
  }
  const r = await pagarMantenimiento({ reciboId: id, unidadId, usuarioId: usuario_id ?? null, modo: 'administracion', validadorId: u.id, comprobante: voucher, ...datos });
  res.locals.entidad = 'pago';
  res.locals.entidadId = r.pago_id;
  res.locals.auditDetalle = { grupo: r.grupo, total: r.total, cargos: r.cargos, recibo_id: id, unidad_id: unidadId, ...(voucher ? { con_voucher: true } : {}) };
  if (voucher) {
    // Mismo registro que al subir un comprobante (sólo metadatos, nunca el contenido), y la IA lo lee en segundo plano: no frena la respuesta ni, si falla, el pago.
    await registrarAuditoria({ usuario_id: u.id, accion: 'subir_comprobante', entidad: 'pago', entidad_id: r.pago_id, detalle: { nombre: voucher.nombre, tipo_mime: voucher.tipo_mime, tamano: voucher.tamano, sha256: voucher.sha256 }, ip: ipDe(req) });
    await iniciarEvaluacion(r.pago_id, 'subida').catch((err) => console.error('[evaluacion] no se pudo iniciar', err instanceof Error ? err.name : 'error'));
  }
  // El recibo ya se validó arriba: al cobrar la última unidad deja de tener deuda y `recibosDe` dejaría de alcanzarlo (404 tras haber cobrado).
  res.status(201).json({ ...r, estado: voucher ? 'por_validar' : 'validado', con_voucher: voucher != null, mantenimiento: await detalleMantenimiento(id, unidadId, { unidadWhere: unidadesDe(u), vista: 'completa' }) });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_ADVERTENCIAS = 100;

/** Multer lanza `MulterError` (→ 500) si el archivo pasa del límite: lo convertimos en un 422 en español. */
const subirArchivo: RequestHandler = (req, res, next) => {
  upload.single('archivo')(req, res, (err?: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(invalid(err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 10 MB' : 'Archivo inválido', { archivo: err.code === 'LIMIT_FILE_SIZE' ? 'Demasiado grande' : 'Archivo inválido' }));
    }
    next(err);
  });
};

// El rol se revisa ANTES de multer: un residente no debe hacer que el servidor reciba 10 MB.
router.post('/excel', requireRole('admin'), subirArchivo, async (req, res) => {
  const u = currentUser(req);
  const complejoId = Number(req.body.complejo_id);
  if (!complejoId) throw invalid('Datos inválidos: complejo_id es obligatorio', { complejo_id: 'Obligatorio' });
  const complejo = await assertRef(prisma.complejoHabitacional, complejoId, scopeComplejos(u), 'complejo_id');
  const empresa_id = complejo!.empresa_id as number | null;
  if (!req.file) throw invalid('Datos inválidos: archivo es obligatorio', { archivo: 'Obligatorio' });

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw invalid('El archivo no es un Excel válido (.xlsx o .xls)', { archivo: 'Archivo inválido' });
  }
  const primeraHoja = workbook.Sheets[workbook.SheetNames[0]];
  if (!primeraHoja) throw invalid('El archivo no tiene hojas', { archivo: 'Sin hojas' });
  const datos = XLSX.utils.sheet_to_json(primeraHoja, { header: 1, blankrows: false, defval: '' }) as unknown[][];

  const filaBlock = indiceFilaBlock(datos);
  if (filaBlock < 0) {
    // Sin fila BLOCK no hay datos; si además falta el mes se avisa primero de éste (como siempre).
    if (!leerCabecera(datos).mes) throw invalid('No se encontró el mes y año en el Excel', { archivo: 'Formato inválido' });
    throw invalid('No se encontró la fila de encabezado (BLOCK)', { archivo: 'Formato inválido' });
  }
  const { mes, anio, vencimiento } = leerCabecera(datos.slice(0, filaBlock));
  if (!mes || !anio) throw invalid('No se encontró el mes y año en el Excel', { archivo: 'Formato inválido' });
  const fechaVencimiento = vencimiento ?? new Date(Date.UTC(anio, mes, 1));

  const { conceptos: columnasConcepto, primeraFilaDatos, columnaTotalMant, duplicados } = leerConceptos(datos, filaBlock);
  if (!columnasConcepto.length) throw invalid('No se encontraron conceptos en el encabezado', { archivo: 'Formato inválido' });
  const advertencias: string[] = duplicados.map((n) => `El concepto «${n}» está repetido en el encabezado: se usó sólo la primera columna`);

  // La multa que ya trae el Excel de la administradora («MULTA PAGO FUERA DE FECHA…»): si una unidad la trae con monto > 0 se respeta y no se le suma mora encima.
  const columnasMora = new Set(columnasConcepto.filter((c) => esConceptoMora(c.nombre)).map((c) => c.indice));
  const montoMora = await montoDeMoraAplicable(complejoId, complejo!.mora_monto as Prisma.Decimal | undefined);
  const hoyDelCondominio = hoyEn((complejo!.zona_horaria as string | undefined) ?? ZONA_POR_DEFECTO); // la emisión es el día de hoy EN el condominio
  const moraPorRecibo: { reciboId: number; torre: string | null; unidades: UnidadConMora[] }[] = [];

  const conceptosMap = new Map<string, number>();
  for (const { nombre } of columnasConcepto) {
    let c = await prisma.concepto.findFirst({ where: { nombre, empresa_id, activo: true } });
    if (!c) {
      c = await prisma.concepto.create({ data: { nombre, empresa_id, tipo_monto: 'fijo', activo: true } });
    }
    conceptosMap.set(nombre, c.id);
  }

  const resultado = await prisma.$transaction(async (tx) => {
    // Cada torre tiene SU recibo: el Excel de un block sólo crea o reemplaza el de ese block y no toca los de las demás torres.
    await bloquearPeriodo(tx, complejoId, mes, anio);
    let filasSaltadas = 0;
    const estructuras = await tx.estructura.findMany({ where: { complejo_id: complejoId }, select: { id: true, nombre: true } });
    const unidades = await tx.unidad.findMany({ where: { complejo_id: complejoId, estado: 'activa' }, select: { id: true, codigo: true, estructura_id: true } });
    // Filas del Excel agrupadas por torre (sin torres en el condominio: un solo grupo, sin torre).
    const grupos = new Map<number | null, { torre: string | null; cargos: { idx: number; unidadId: number; monto: Prisma.Decimal }[]; unidades: number; unidadIds: Set<number>; multa: Map<number, Prisma.Decimal> }>();
    const nuevoGrupo = (torre: string | null) => ({ torre, cargos: [], unidades: 0, unidadIds: new Set<number>(), multa: new Map<number, Prisma.Decimal>() });
    if (!estructuras.length) grupos.set(null, nuevoGrupo(null));
    for (let i = primeraFilaDatos; i < datos.length; i++) {
      const fila = datos[i];
      const block = normalizarTexto(fila[0]);
      const dpto = normalizarTexto(fila[1]);
      if (!block || !dpto || block.toUpperCase() === 'TOTALES') { filasSaltadas++; continue; }
      const etiqueta = `${block} Dpto. ${dpto}`;
      let candidatas = unidades;
      let estructuraId: number | null = null;
      if (estructuras.length) {
        const numero = numeroDeTorre(block);
        if (numero == null) { advertencias.push(`${etiqueta}: no se entiende el identificador de torre «${block}»; se saltó la fila`); filasSaltadas++; continue; }
        const { estructura, motivo } = buscarEstructura(estructuras, numero);
        if (!estructura) {
          advertencias.push(`${etiqueta}: ${motivo === 'varias' ? `hay varias torres del condominio que coinciden con «${block}»` : `el condominio no tiene la torre «${block}»`}; se saltó la fila`);
          filasSaltadas++;
          continue;
        }
        estructuraId = estructura.id;
        if (!grupos.has(estructuraId)) grupos.set(estructuraId, nuevoGrupo(estructura.nombre));
        candidatas = unidades.filter((un) => un.estructura_id === estructura.id);
      }
      const grupo = grupos.get(estructuraId)!;
      const coinciden = candidatas.filter((un) => codigoEncajaConDpto(un.codigo, dpto));
      if (coinciden.length !== 1) {
        advertencias.push(`${etiqueta}: ${coinciden.length ? 'hay varias unidades que coinciden' : 'no existe la unidad'}; se saltó la fila`);
        filasSaltadas++;
        continue;
      }
      const unidadId = coinciden[0].id;
      grupo.unidadIds.add(unidadId);
      let suma = new Prisma.Decimal(0);
      for (const { indice: idx } of columnasConcepto) {
        const monto = limpiarMonto(fila[idx]);
        if (monto == null) continue;
        const redondeado = redondearMonto(monto);
        suma = suma.plus(redondeado);
        if (columnasMora.has(idx)) grupo.multa.set(unidadId, (grupo.multa.get(unidadId) ?? new Prisma.Decimal(0)).plus(redondeado));
        // Un monto en S/ 0.00 no es una deuda: no se crea el cargo (nacería «pendiente» y nunca se pagaría). El concepto del recibo sí queda.
        if (new Prisma.Decimal(redondeado).isZero()) continue;
        grupo.cargos.push({ idx, unidadId, monto: new Prisma.Decimal(redondeado) });
      }
      const totalMant = columnaTotalMant == null ? null : limpiarMonto(fila[columnaTotalMant]);
      if (totalMant != null && suma.minus(redondearMonto(totalMant)).abs().gt(TOLERANCIA_TOTAL)) {
        advertencias.push(`${etiqueta}: la suma de los conceptos (${formatoDinero(suma.toFixed(2), complejo!.moneda as string)}) no coincide con TOTAL MANT (${formatoDinero(redondearMonto(totalMant), complejo!.moneda as string)})`);
      }
      grupo.unidades++;
    }
    if (!grupos.size) throw invalid('El Excel no trae filas de ninguna torre del condominio', { archivo: 'Sin filas válidas' });

    const porTorre: { recibo_id: number; estructura_id: number | null; torre: string | null; accion: 'creado' | 'reemplazado'; unidades_procesadas: number }[] = [];
    const avisosMora: string[] = [];
    const ordenados = [...grupos.entries()].sort(([a], [b]) => (a ?? 0) - (b ?? 0));
    for (const [estructuraId, g] of ordenados) {
      const donde = `${periodoTexto(mes, anio)}${g.torre ? ` · ${g.torre}` : ''}`;
      const { mismo, general } = await recibosDelPeriodo(tx, { complejoId, estructuraId, mes, anio });
      if (general) throw conflict(`Ya existe un recibo de ${periodoTexto(mes, anio)} sin torre que cobra a unidades de ${g.torre ?? 'esta torre'}; asígnale su torre antes de subir el Excel de ese block`);
      const descripcion = descripcionRecibo(mes, anio, g.torre);
      let reciboId: number;
      if (mismo) {
        reciboId = mismo.id;
        // Reemplazar borra los cargos: si alguno ya tiene pagos (en cualquier estado) o no está pendiente, los pagos quedarían huérfanos y la deuda reaparecería.
        const conPagos = await tx.reciboConceptoUnidad.findFirst({
          where: { reciboConcepto: { recibo_id: reciboId }, OR: [{ pagos: { some: {} } }, { estado_pago: { notIn: ['pendiente'] } }] },
          select: { id: true },
        });
        if (conPagos) throw conflict(`El recibo de ${donde} ya tiene pagos registrados; no se puede reemplazar desde Excel`);
        await tx.reciboConceptoUnidad.deleteMany({ where: { reciboConcepto: { recibo_id: reciboId } } });
        await tx.reciboConcepto.deleteMany({ where: { recibo_id: reciboId } });
        await tx.recibo.update({ where: { id: reciboId }, data: { fecha_emision: hoyDelCondominio, fecha_vencimiento: fechaVencimiento, descripcion, estado: 'emitido', creado_por_id: u.id } });
      } else {
        const recibo = await tx.recibo.create({
          data: { complejo_id: complejoId, estructura_id: estructuraId, empresa_id, mes, anio, fecha_emision: hoyDelCondominio, fecha_vencimiento: fechaVencimiento, descripcion, estado: 'emitido', creado_por_id: u.id },
        });
        reciboId = recibo.id;
      }
      const ordenMap = new Map<number, number>();
      let orden = 0;
      for (const { nombre, indice: idx } of columnasConcepto) {
        orden++;
        const rc = await tx.reciboConcepto.create({ data: { recibo_id: reciboId, concepto_id: conceptosMap.get(nombre)!, monto: 0, es_recargo: false, orden } });
        ordenMap.set(idx, rc.id);
      }
      if (g.cargos.length) {
        await tx.reciboConceptoUnidad.createMany({ data: g.cargos.map((c) => ({ recibo_concepto_id: ordenMap.get(c.idx)!, unidad_id: c.unidadId, monto: c.monto })) as never });
      }
      // Mora de S/ 20 (configurable) para quien pagó fuera de fecha el recibo del mes anterior de ESTA torre. Se calcula al crear el recibo: reemplazarlo desde Excel
      // borra sus cargos y vuelve a calcular, así que reimportar el mismo archivo nunca suma dos moras.
      const columnaMora = columnasConcepto.find((c) => columnasMora.has(c.indice));
      const mora = await agregarMora(tx, {
        reciboId, complejoId, estructuraId, empresaId: empresa_id, mes, anio, unidadIds: [...g.unidadIds], monto: montoMora,
        respetar: new Set([...g.multa].filter(([, m]) => m.gt(0)).map(([id]) => id)),
        reciboConceptoId: columnaMora ? ordenMap.get(columnaMora.indice) : undefined,
      });
      moraPorRecibo.push({ reciboId, torre: g.torre, unidades: mora.unidades });
      if (mora.aviso) avisosMora.push(g.torre ? `${g.torre}: ${mora.aviso}` : mora.aviso);
      porTorre.push({ recibo_id: reciboId, estructura_id: estructuraId, torre: g.torre, accion: mismo ? 'reemplazado' : 'creado', unidades_procesadas: g.unidades });
    }
    return { porTorre, avisosMora, unidadesProcesadas: porTorre.reduce((s, r) => s + r.unidades_procesadas, 0), filasSaltadas, conceptosCreados: columnasConcepto.length };
  });

  for (const r of resultado.porTorre) {
    try {
      await encolarReciboEmitido(r.recibo_id);
      procesarPronto();
    } catch (err) {
      console.error('[avisos] no se pudieron encolar los avisos del recibo', r.recibo_id, err instanceof Error ? err.message : 'error');
    }
  }

  const primero = resultado.porTorre[0]!;
  res.locals.entidad = 'recibo';
  res.locals.entidadId = primero.recibo_id;
  res.locals.accion = 'crear_desde_excel';
  const mora = informeDeMora(montoMora, moraPorRecibo, complejo!.moneda as string);
  advertencias.push(...resultado.avisosMora);
  res.locals.auditDetalle = { recibo_ids: resultado.porTorre.map((r) => r.recibo_id), torres: resultado.porTorre.map((r) => r.torre), mes, anio, mora: mora.cantidad };
  res.status(201).json({
    recibo_id: primero.recibo_id,
    // Un recibo por torre: `recibo_id` es el de la primera; `recibos` trae todos con su torre y lo que se hizo con cada uno.
    recibos: resultado.porTorre,
    mes, anio,
    unidades_procesadas: resultado.unidadesProcesadas,
    filas_saltadas: resultado.filasSaltadas,
    conceptos: resultado.conceptosCreados,
    // `mora`: a quiénes se les agregó la mora por pago fuera de fecha del mes anterior, con el mensaje listo para mostrar.
    mora,
    advertencias: advertencias.length > MAX_ADVERTENCIAS ? [...advertencias.slice(0, MAX_ADVERTENCIAS), `… y ${advertencias.length - MAX_ADVERTENCIAS} advertencias más`] : advertencias,
  });
});

router.use(crud);

export { router as recibosRouter };
