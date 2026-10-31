// Conciliación bancaria (plan Torre Pro): la administración sube el extracto de la cuenta del condominio y Torre cruza cada abono con los pagos registrados.
// Sólo `admin` (de su empresa) y superadmin. Otro tenant → 404; sin la capacidad `conciliacion` → 403 MODULO_NO_ACTIVO; solo lectura → 409 SOLO_LECTURA.
// Toda mutación queda en la auditoría SIN la descripción de los movimientos (sólo ids, montos y conteos).
import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { invalid, notFound } from '../errors';
import { scopeCuentasConciliacion, scopeMovimientosBancarios } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { exigirOperativo } from '../services/comercial/operativo';
import { complejosConModulo, complejosDe, exigirModulo, moduloNoActivo } from '../services/comercial/modulos';
import { cruzar, VENTANA_MAXIMA } from '../services/conciliacion/cruce';
import { buscarPagos, desvincular, ESTADOS_MOVIMIENTO, ignorar, listarMovimientos, resumenDeCuenta, vincular, vouchersSinAbono, type CuentaCompleta } from '../services/conciliacion/gestion';
import { formatearExtracto, importarExtracto } from '../services/conciliacion/importar';
import { MAX_BYTES_EXTRACTO, type Mapeo } from '../services/conciliacion/lectura';
import { nombreEntidad, ultimos4 } from '../services/mediosPago';
import { idSchema, listQuerySchema, parse, parseBody, parseQuery, texto, z } from '../validation';

export const conciliacionRouter = Router();
// Sólo la administración (y el superadmin): la junta no concilia. El rol se revisa ANTES de multer: un residente no hace que el servidor reciba 5 MB.
conciliacionRouter.use(requireRole('admin'));
conciliacionRouter.use((_req, res, next) => { res.locals.entidad = 'conciliacion'; next(); });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES_EXTRACTO, files: 1 } });
const subirArchivo: RequestHandler = (req, res, next) => {
  upload.single('archivo')(req, res, (err?: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(invalid(err.code === 'LIMIT_FILE_SIZE' ? `El extracto pesa más de ${MAX_BYTES_EXTRACTO / 1024 / 1024} MB` : 'Archivo inválido', { archivo: err.code === 'LIMIT_FILE_SIZE' ? 'Demasiado grande' : 'Archivo inválido' }));
    }
    next(err);
  });
};

/** La cuenta (medio de pago de tipo banco) dentro del alcance de quien llama; si no es suya, 404. Luego la puerta del plan y, si la acción cambia algo, la de solo lectura. */
async function cuentaDe(u: AuthUser, id: number, mutar: boolean): Promise<CuentaCompleta> {
  const m = await prisma.medioPago.findFirst({
    where: { AND: [{ id }, scopeCuentasConciliacion(u)] },
    select: { id: true, complejo_id: true, estructura_id: true, moneda: true, complejo: { select: { zona_horaria: true } } },
  });
  if (!m) throw notFound('Cuenta');
  await exigirModulo(m.complejo_id, 'conciliacion');
  if (mutar) await exigirOperativo(m.complejo_id, u);
  return { id: m.id, complejo_id: m.complejo_id, estructura_id: m.estructura_id, moneda: m.moneda, zona: m.complejo.zona_horaria };
}

const idCuenta = (req: Request) => parse(z.object({ cuenta: idSchema }), req.params).cuenta;
const idMovimiento = (req: Request) => parse(z.object({ mid: idSchema }), req.params).mid;
/** Las rutas anidadas llaman a la cuenta `:cuenta` (y al abono `:mid`), no `:id`. */
const registrar = (res: { locals: Record<string, unknown> }, accion: string, entidadId: number | null, detalle: Prisma.InputJsonValue) => {
  res.locals.accion = accion;
  res.locals.entidadId = entidadId;
  res.locals.auditDetalle = detalle;
};

// ---------- Cuentas ----------
const cuentasQuery = z.object({ complejo_id: idSchema.optional() });

conciliacionRouter.get('/cuentas', async (req, res) => {
  const u = currentUser(req);
  const q = parseQuery(cuentasQuery, req);
  // Como los reportes: si ninguno de tus condominios tiene la conciliación (o el que pides es tuyo y no la tiene), 403 «Disponible en el plan Pro».
  const [alcance, conModulo] = await Promise.all([complejosDe(u), complejosConModulo(u, 'conciliacion')]);
  if (alcance !== null && conModulo !== null && alcance.length > 0) {
    const pedidoEsMio = q.complejo_id !== undefined && alcance.includes(q.complejo_id);
    if (conModulo.length === 0 || (pedidoEsMio && !conModulo.includes(q.complejo_id!))) throw moduloNoActivo('conciliacion');
  }
  const cuentas = await prisma.medioPago.findMany({
    where: { AND: [scopeCuentasConciliacion(u), ...(q.complejo_id !== undefined ? [{ complejo_id: q.complejo_id }] : []), ...(conModulo !== null ? [{ complejo_id: { in: conModulo } }] : [])] },
    omit: { qr_datos: true },
    include: { complejo: { select: { id: true, nombre: true, moneda: true } }, estructura: { select: { id: true, nombre: true } }, conciliacion: { select: { columnas: true, ventana_dias: true } } },
    orderBy: [{ complejo_id: 'asc' }, { activo: 'desc' }, { orden: 'asc' }, { id: 'asc' }],
  });
  const ultimos = await prisma.extractoBancario.findMany({ where: { medio_pago_id: { in: cuentas.map((c) => c.id) } }, orderBy: { created_at: 'desc' }, select: { id: true, medio_pago_id: true, archivo_nombre: true, created_at: true, fecha_hasta: true } });
  res.json({
    items: cuentas.map((c) => {
      const ultimo = ultimos.find((e) => e.medio_pago_id === c.id);
      return {
        id: c.id,
        complejo: c.complejo,
        estructura: c.estructura,
        entidad: nombreEntidad(c),
        ultimos4: ultimos4(c),
        moneda: c.moneda,
        titular: c.titular,
        activo: c.activo,
        ventana_dias: c.conciliacion?.ventana_dias ?? 3,
        tiene_mapeo: c.conciliacion?.columnas != null,
        ultimo_extracto: ultimo ? { id: ultimo.id, archivo_nombre: ultimo.archivo_nombre, created_at: ultimo.created_at, fecha_hasta: ultimo.fecha_hasta?.toISOString().slice(0, 10) ?? null } : null,
      };
    }),
  });
});

const configSchema = z.object({
  ventana_dias: z.coerce.number({ error: 'Debe ser un número' }).int('Debe ser un entero').min(0, 'Mínimo 0').max(VENTANA_MAXIMA, `Máximo ${VENTANA_MAXIMA}`).optional(),
  /** `null` = olvidar el mapeo de columnas guardado. */
  columnas: z.null().optional(),
});
conciliacionRouter.put('/cuentas/:cuenta/configuracion', async (req, res) => {
  const u = currentUser(req);
  const cuenta = await cuentaDe(u, idCuenta(req), true);
  const d = parseBody(configSchema, req);
  const cambios = { ...(d.ventana_dias !== undefined ? { ventana_dias: d.ventana_dias } : {}), ...(d.columnas === null ? { columnas: Prisma.DbNull } : {}) };
  const fila = await prisma.configuracionConciliacion.upsert({
    where: { medio_pago_id: cuenta.id },
    create: { medio_pago_id: cuenta.id, ventana_dias: d.ventana_dias ?? 3 },
    update: cambios,
  });
  registrar(res, 'configurar', cuenta.id, { medio_pago_id: cuenta.id, ventana_dias: fila.ventana_dias, mapeo_olvidado: d.columnas === null });
  res.json({ ventana_dias: fila.ventana_dias });
});

conciliacionRouter.get('/cuentas/:cuenta/resumen', async (req, res) => {
  const cuenta = await cuentaDe(currentUser(req), idCuenta(req), false);
  res.json(await resumenDeCuenta(cuenta));
});

const movimientosQuery = listQuerySchema.extend({ estado: z.enum(ESTADOS_MOVIMIENTO, { error: `Estado inválido (${ESTADOS_MOVIMIENTO.join(', ')})` }).optional() });
conciliacionRouter.get('/cuentas/:cuenta/movimientos', async (req, res) => {
  const cuenta = await cuentaDe(currentUser(req), idCuenta(req), false);
  const q = parseQuery(movimientosQuery, req);
  res.json(await listarMovimientos(cuenta, { estado: q.estado, q: q.q, page: q.page, pageSize: q.pageSize }));
});

conciliacionRouter.get('/cuentas/:cuenta/sin-abono', async (req, res) => {
  const cuenta = await cuentaDe(currentUser(req), idCuenta(req), false);
  res.json(await vouchersSinAbono(cuenta));
});

conciliacionRouter.get('/cuentas/:cuenta/extractos', async (req, res) => {
  const cuenta = await cuentaDe(currentUser(req), idCuenta(req), false);
  const filas = await prisma.extractoBancario.findMany({ where: { medio_pago_id: cuenta.id }, orderBy: { created_at: 'desc' }, take: 50, include: { subido_por: { select: { nombre: true } } } });
  res.json({ items: filas.map((e) => ({ ...formatearExtracto(e), subido_por: e.subido_por?.nombre ?? null })) });
});

// ---------- Subir el extracto ----------
const columna = z.number({ error: 'Debe ser un número' }).int().min(0).max(200);
const mapeoSchema = z.object({
  fecha: columna,
  abono: columna,
  descripcion: columna.nullable(),
  cargo: columna.nullable(),
  operacion: columna.nullable(),
  fila_inicio: z.number({ error: 'Debe ser un número' }).int().min(0).max(500),
});

conciliacionRouter.post('/cuentas/:cuenta/extractos', subirArchivo, async (req, res) => {
  const u = currentUser(req);
  const cuenta = await cuentaDe(u, idCuenta(req), true);
  if (!req.file) throw invalid('Datos inválidos: archivo es obligatorio', { archivo: 'Obligatorio' });
  let mapeo: Mapeo | null = null;
  const crudo = (req.body as { columnas?: unknown } | undefined)?.columnas;
  if (typeof crudo === 'string' && crudo.trim()) {
    let json: unknown;
    try { json = JSON.parse(crudo); } catch { throw invalid('Datos inválidos: columnas: no es un JSON válido', { columnas: 'JSON inválido' }); }
    mapeo = parse(mapeoSchema, json);
  }
  const r = await importarExtracto({ cuenta, buffer: req.file.buffer, nombre: req.file.originalname, usuarioId: u.id, mapeo });
  if (r.requiere_mapeo) {
    registrar(res, 'leer', cuenta.id, { medio_pago_id: cuenta.id, requiere_mapeo: true });
    res.status(200).json(r);
    return;
  }
  registrar(res, 'importar', r.extracto.id, { medio_pago_id: cuenta.id, extracto_id: r.extracto.id, abonos: r.extracto.filas_leidas, nuevos: r.extracto.filas_nuevas, repetidos: r.extracto.filas_repetidas, total: r.extracto.total_abonos, ...r.cruce });
  res.status(201).json(r);
});

conciliacionRouter.post('/cuentas/:cuenta/cruzar', async (req, res) => {
  const cuenta = await cuentaDe(currentUser(req), idCuenta(req), true);
  const r = await cruzar(cuenta);
  registrar(res, 'cruzar', cuenta.id, { medio_pago_id: cuenta.id, ...r });
  res.json(r);
});

// ---------- Vincular, desvincular, ignorar ----------
conciliacionRouter.get('/cuentas/:cuenta/movimientos/:mid/pagos', async (req, res) => {
  const cuenta = await cuentaDe(currentUser(req), idCuenta(req), false);
  const q = parseQuery(z.object({ q: z.string().trim().max(60).optional() }), req);
  const m = await prisma.movimientoBancario.findFirst({ where: { id: idMovimiento(req), medio_pago_id: cuenta.id }, select: { fecha: true, monto: true } });
  if (!m) throw notFound('Movimiento');
  res.json({ items: await buscarPagos(cuenta, m, q.q || undefined) });
});

conciliacionRouter.post('/cuentas/:cuenta/movimientos/:mid/vincular', async (req, res) => {
  const u = currentUser(req);
  const cuenta = await cuentaDe(u, idCuenta(req), true);
  const { pago_id } = parseBody(z.object({ pago_id: idSchema }), req);
  const r = await vincular(cuenta, idMovimiento(req), pago_id, u.id);
  registrar(res, 'vincular', r.movimiento_id, { medio_pago_id: cuenta.id, movimiento_id: r.movimiento_id, pago_id: r.pago_id, monto: r.monto });
  res.json(r);
});

conciliacionRouter.post('/cuentas/:cuenta/movimientos/:mid/desvincular', async (req, res) => {
  const cuenta = await cuentaDe(currentUser(req), idCuenta(req), true);
  const r = await desvincular(cuenta, idMovimiento(req));
  registrar(res, 'desvincular', r.movimiento_id, { medio_pago_id: cuenta.id, movimiento_id: r.movimiento_id, pago_id: r.pago_id, estado_anterior: r.estado_anterior });
  res.json(r);
});

conciliacionRouter.post('/cuentas/:cuenta/movimientos/:mid/ignorar', async (req, res) => {
  const u = currentUser(req);
  const cuenta = await cuentaDe(u, idCuenta(req), true);
  const { motivo } = parseBody(z.object({ motivo: texto(200) }), req);
  const r = await ignorar(cuenta, idMovimiento(req), motivo, u.id);
  registrar(res, 'ignorar', r.movimiento_id, { medio_pago_id: cuenta.id, movimiento_id: r.movimiento_id, monto: r.monto });
  res.json(r);
});

// ---------- Marca «Conciliado con el banco» en la lista de pagos ----------
/**
 * Para la lista de pagos y el modal de validar: de estos pagos (los principales de cada grupo), cuáles están conciliados y con qué fecha de abono. Es sólo
 * información: de los condominios sin la capacidad no devuelve nada (no es un error), y no cambia cómo se valida un pago.
 */
conciliacionRouter.get('/pagos', async (req, res) => {
  const u = currentUser(req);
  const { ids } = parseQuery(z.object({ ids: z.string().regex(/^\d+(,\d+){0,99}$/, 'Usa hasta 100 ids separados por comas') }), req);
  const conModulo = await complejosConModulo(u, 'conciliacion');
  const filas = await prisma.movimientoBancario.findMany({
    where: { AND: [scopeMovimientosBancarios(u), { pago_id: { in: ids.split(',').map(Number) } }, ...(conModulo !== null ? [{ complejo_id: { in: conModulo } }] : [])] },
    select: { id: true, pago_id: true, fecha: true, vinculo: true },
  });
  res.json({ marcas: Object.fromEntries(filas.map((f) => [f.pago_id!, { movimiento_id: f.id, fecha: f.fecha.toISOString().slice(0, 10), vinculo: f.vinculo }])) });
});
