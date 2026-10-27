import express, { Router, type RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError, forbidden, invalid, notFound } from '../errors';
import { ambitoJunta, esJunta, puedeGestionar } from '../lib/junta';
import { scopeComplejos, scopeMediosPago } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { detectarTipo, dispositionInline, sanearNombre } from '../services/comprobantes';
import { ENTIDADES, GRUPOS_ENTIDAD, MAX_ACTIVOS, MAX_QR, TIPOS_QR, ajusteSchema, camposDePago, columnas, medioSchema, nombreEntidad, ultimos4, type TipoQr } from '../services/mediosPago';
import { boolQuery, idSchema, listQuerySchema, parse, parseBody, parseId, z } from '../validation';

/** Fila sin los bytes del QR (nunca salen en las listas), con `tiene_qr` y el nombre real de la entidad (si es «Otro», el que escribió la junta). */
function formatear<T extends { qr_tipo_mime: string | null; banco: string | null; banco_otro: string | null }>(m: T) {
  return { ...m, tiene_qr: m.qr_tipo_mime != null, entidad: nombreEntidad(m) };
}

const ocultarQr = { qr_datos: true } as const;
const incluir = { complejo: { select: { id: true, nombre: true } }, estructura: { select: { id: true, nombre: true } } } as const;

/** Unidades en las que el residente vive o es dueño, para saber qué medios le corresponden. */
async function unidadesDe(u: AuthUser) {
  const donde = u.rol === 'propietario' ? { propietario_id: u.id } : u.rol === 'inquilino' ? { inquilino_id: u.id } : null;
  if (!donde) return [];
  return prisma.unidad.findMany({ where: donde, select: { complejo_id: true, estructura_id: true } });
}

/** Medios que valen para esas unidades: los de su block y los de todo su condominio. */
export function medioDeUnidades(unidades: { complejo_id: number | null; estructura_id: number | null }[]): Prisma.MedioPagoWhereInput {
  const ors = unidades
    .filter((x): x is { complejo_id: number; estructura_id: number | null } => x.complejo_id != null)
    .map((x) => ({ complejo_id: x.complejo_id, OR: [{ estructura_id: null }, ...(x.estructura_id != null ? [{ estructura_id: x.estructura_id }] : [])] }));
  return ors.length ? { OR: ors } : { id: -1 };
}

/** Condominio y block de un medio nuevo, comprobando que quien lo crea gestiona ese ámbito; si no, 404 (no se revela qué existe). */
async function resolverAmbito(u: AuthUser, complejoId: number | undefined, estructuraId: number | null | undefined) {
  const junta = ambitoJunta(u);
  const complejo = complejoId ?? junta?.complejo_id;
  if (complejo == null) throw invalid('Datos inválidos: complejo_id: es obligatorio', { complejo_id: 'Obligatorio' });
  const estructura = estructuraId === undefined ? (junta?.estructura_id ?? null) : estructuraId;
  if (u.rol === 'propietario') {
    if (!puedeGestionar(u, { complejo_id: complejo, estructura_id: estructura })) throw notFound('Condominio o block');
  } else if (!(await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id: complejo }, scopeComplejos(u)] }, select: { id: true } }))) {
    throw notFound('Condominio');
  }
  if (estructura != null && !(await prisma.estructura.findFirst({ where: { id: estructura, complejo_id: complejo }, select: { id: true } }))) throw notFound('Block');
  return { complejo_id: complejo, estructura_id: estructura };
}

async function verificarTope(ambito: { complejo_id: number; estructura_id: number | null }, excluirId?: number) {
  const activos = await prisma.medioPago.count({ where: { complejo_id: ambito.complejo_id, estructura_id: ambito.estructura_id, activo: true, ...(excluirId != null ? { id: { not: excluirId } } : {}) } });
  if (activos >= MAX_ACTIVOS) throw invalid(`Datos inválidos: activo: máximo ${MAX_ACTIVOS} medios de pago activos por block`, { activo: `Máximo ${MAX_ACTIVOS} activos` });
}

type MedioAuditable = { tipo: string; complejo_id: number; estructura_id: number | null; banco?: string | null; banco_otro?: string | null; servicio?: string | null; numero_cuenta?: string | null; celular?: string | null };
/** Lo mínimo: tipo y ámbito, y los últimos 4 del número (nunca completo). Una recaudación no tiene número: guarda entidad y servicio (nunca datos del vecino). */
const detalleAuditoria = (m: MedioAuditable) => m.tipo === 'recaudacion'
  ? { tipo: m.tipo, complejo_id: m.complejo_id, estructura_id: m.estructura_id, entidad: nombreEntidad({ banco: m.banco ?? null, banco_otro: m.banco_otro }), servicio: m.servicio ?? null }
  : { tipo: m.tipo, complejo_id: m.complejo_id, estructura_id: m.estructura_id, ultimos4: ultimos4(m) };

/** Carga el medio dentro del alcance de quien llama ANTES de leer el cuerpo (un QR crudo no se descarga para un ajeno). */
const cargarMedio: RequestHandler = async (req, res, next) => {
  const u = currentUser(req);
  const m = await prisma.medioPago.findFirst({ where: { AND: [{ id: parseId(req) }, scopeMediosPago(u)] }, omit: ocultarQr });
  if (!m) throw notFound('Medio de pago');
  res.locals.medio = m;
  res.locals.entidadId = m.id;
  next();
};
type MedioCargado = Awaited<ReturnType<typeof prisma.medioPago.findFirstOrThrow<{ omit: typeof ocultarQr }>>>;

const filtrosSchema = listQuerySchema.extend({
  complejo_id: idSchema.optional(),
  estructura_id: z.union([idSchema, z.literal('ninguna')]).optional(),
  activo: boolQuery.optional(),
});

const crudoQr = express.raw({ type: [...TIPOS_QR], limit: MAX_QR });

export const mediosPagoRouter = Router();
mediosPagoRouter.use((_req, res, next) => {
  res.locals.entidad = 'medio-pago';
  next();
});

// ---------- Ver el QR (también los residentes del ámbito del medio, y sólo si está activo) ----------
mediosPagoRouter.get('/:id/qr', requireRole('admin', 'propietario', 'inquilino'), async (req, res) => {
  const u = currentUser(req);
  const id = parseId(req);
  const accesos: Prisma.MedioPagoWhereInput[] = [];
  if (u.rol === 'superadmin' || u.rol === 'admin' || esJunta(u)) accesos.push(scopeMediosPago(u));
  if (u.rol === 'propietario' || u.rol === 'inquilino') accesos.push({ activo: true, ...medioDeUnidades(await unidadesDe(u)) });
  const m = await prisma.medioPago.findFirst({ where: { AND: [{ id }, { OR: accesos }, { qr_tipo_mime: { not: null } }] }, select: { qr_datos: true, qr_tipo_mime: true, qr_nombre: true } });
  if (!m?.qr_datos || !m.qr_tipo_mime) throw notFound('QR');
  res.set({
    'Content-Type': m.qr_tipo_mime,
    'Content-Length': String(m.qr_datos.length),
    'Content-Disposition': dispositionInline(m.qr_nombre ?? 'qr'),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'private, no-store',
  });
  res.status(200).end(Buffer.from(m.qr_datos));
});

// ---------- Gestión: administradora y junta (presidente/tesorero) del ámbito ----------
mediosPagoRouter.use((req, _res, next) => {
  scopeMediosPago(currentUser(req)); // lanza 403 si no es admin, superadmin ni junta con cargo de gestión
  next();
});

/** Condominios y blocks donde puede gestionar medios de pago quien llama (la junta no puede leer `/api/estructuras`). */
mediosPagoRouter.get('/ambitos', async (req, res) => {
  const u = currentUser(req);
  const junta = ambitoJunta(u);
  const complejos = await prisma.complejoHabitacional.findMany({
    where: junta ? { id: junta.complejo_id } : scopeComplejos(u),
    orderBy: { nombre: 'asc' },
    take: 100,
    select: { id: true, nombre: true, estructuras: { where: junta?.estructura_id != null ? { id: junta.estructura_id } : {}, orderBy: { nombre: 'asc' }, select: { id: true, nombre: true } } },
  });
  // `fijo`: la junta de un block sólo gestiona ese block (no puede elegir «todo el condominio»).
  res.json({ complejos, fijo: junta?.estructura_id != null });
});

/** Fuente única de las entidades (con sus formatos habituales, sólo para avisos) para el formulario. */
mediosPagoRouter.get('/catalogo', (_req, res) => {
  res.json({ grupos: GRUPOS_ENTIDAD.map((g) => ({ ...g, entidades: ENTIDADES.filter((x) => x.grupo === g.grupo) })) });
});

mediosPagoRouter.get('/', async (req, res) => {
  const u = currentUser(req);
  const q = parse(filtrosSchema, req.query);
  const where: Prisma.MedioPagoWhereInput = {
    AND: [
      scopeMediosPago(u),
      q.complejo_id !== undefined ? { complejo_id: q.complejo_id } : {},
      q.estructura_id !== undefined ? { estructura_id: q.estructura_id === 'ninguna' ? null : q.estructura_id } : {},
      q.activo !== undefined ? { activo: q.activo } : {},
    ],
  };
  const [total, items] = await Promise.all([
    prisma.medioPago.count({ where }),
    prisma.medioPago.findMany({ where, orderBy: [{ orden: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, omit: ocultarQr, include: incluir }),
  ]);
  res.json({ items: items.map(formatear), total, page: q.page, pageSize: q.pageSize });
});

mediosPagoRouter.post('/', async (req, res) => {
  const u = currentUser(req);
  const d = parseBody(medioSchema, req);
  const ambito = await resolverAmbito(u, d.complejo_id, d.estructura_id);
  if (d.activo !== false) await verificarTope(ambito);
  const m = await prisma.medioPago.create({
    data: { ...ambito, ...columnas(d), activo: d.activo ?? true, orden: d.orden ?? 0, creado_por_id: u.id },
    omit: ocultarQr,
    include: incluir,
  });
  res.locals.entidadId = m.id;
  res.locals.auditDetalle = detalleAuditoria(m);
  res.status(201).json(formatear(m));
});

mediosPagoRouter.put('/:id', cargarMedio, async (req, res) => {
  const actual = res.locals.medio as MedioCargado;
  const d = parseBody(medioSchema, req); // el ámbito (condominio/block) no se cambia: se ignoran complejo_id y estructura_id
  if (d.activo === true && !actual.activo) await verificarTope(actual, actual.id);
  const m = await prisma.medioPago.update({
    where: { id: actual.id },
    data: { ...columnas(d), ...(d.activo !== undefined ? { activo: d.activo } : {}), ...(d.orden !== undefined ? { orden: d.orden } : {}) },
    omit: ocultarQr,
    include: incluir,
  });
  res.locals.auditDetalle = detalleAuditoria(m);
  res.json(formatear(m));
});

mediosPagoRouter.patch('/:id', cargarMedio, async (req, res) => {
  const actual = res.locals.medio as MedioCargado;
  const d = parseBody(ajusteSchema, req);
  if (d.activo === true && !actual.activo) await verificarTope(actual, actual.id);
  const m = await prisma.medioPago.update({ where: { id: actual.id }, data: { ...(d.activo !== undefined ? { activo: d.activo } : {}), ...(d.orden !== undefined ? { orden: d.orden } : {}) }, omit: ocultarQr, include: incluir });
  res.locals.auditDetalle = { ...detalleAuditoria(m), activo: m.activo, orden: m.orden };
  res.json(formatear(m));
});

mediosPagoRouter.delete('/:id', cargarMedio, async (_req, res) => {
  const actual = res.locals.medio as MedioCargado;
  await prisma.medioPago.delete({ where: { id: actual.id } });
  res.locals.auditDetalle = detalleAuditoria(actual);
  res.status(204).end();
});

// ---------- QR ----------
mediosPagoRouter.put('/:id/qr', cargarMedio, crudoQr, async (req, res) => {
  const actual = res.locals.medio as MedioCargado;
  const cuerpo: unknown = req.body;
  const declarado = req.is([...TIPOS_QR]) as TipoQr | false | null;
  if (!declarado || !Buffer.isBuffer(cuerpo)) throw new HttpError(415, 'Tipo de archivo no permitido: sube una imagen PNG, JPG o WebP');
  if (cuerpo.length === 0) throw invalid('El archivo está vacío');
  if (detectarTipo(cuerpo) !== declarado) throw invalid('El contenido del archivo no corresponde a su tipo');
  const m = await prisma.medioPago.update({
    where: { id: actual.id },
    data: { qr_nombre: sanearNombre(req.header('x-nombre-archivo'), declarado), qr_tipo_mime: declarado, qr_datos: cuerpo },
    omit: ocultarQr,
    include: incluir,
  });
  res.locals.accion = 'subir_qr';
  res.locals.auditDetalle = { ...detalleAuditoria(m), tipo_mime: declarado, tamano: cuerpo.length }; // nunca el contenido
  res.json(formatear(m));
});

mediosPagoRouter.delete('/:id/qr', cargarMedio, async (_req, res) => {
  const actual = res.locals.medio as MedioCargado;
  await prisma.medioPago.update({ where: { id: actual.id }, data: { qr_nombre: null, qr_tipo_mime: null, qr_datos: null } });
  res.locals.accion = 'quitar_qr';
  res.locals.auditDetalle = detalleAuditoria(actual);
  res.status(204).end();
});

// ---------- Residente: cómo pagar ----------
/** `GET /api/me/medios-pago?cargo_id=` — los medios activos que valen para la unidad del cargo, los de su block primero. */
export const mediosPagoMeRouter = Router();
mediosPagoMeRouter.get('/', requireRole('propietario', 'inquilino'), async (req, res) => {
  const u = currentUser(req);
  if (u.rol === 'superadmin') throw forbidden();
  const { cargo_id } = parse(z.object({ cargo_id: idSchema }), req.query);
  const donde = u.rol === 'propietario' ? { propietario_id: u.id } : { inquilino_id: u.id };
  const cargo = await prisma.reciboConceptoUnidad.findFirst({ where: { id: cargo_id, unidad: donde }, select: { unidad: { select: { codigo: true, complejo_id: true, estructura_id: true } } } });
  if (!cargo) throw notFound('Cargo');
  const filas = await prisma.medioPago.findMany({
    where: { activo: true, ...medioDeUnidades(cargo.unidad ? [cargo.unidad] : []) },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    omit: ocultarQr,
  });
  const delBlock = filas.filter((m) => m.estructura_id != null);
  const delCondominio = filas.filter((m) => m.estructura_id == null);
  // Sin creado_por_id ni documento del titular: el vecino sólo necesita lo que sirve para pagar. La instrucción de recaudación lleva SU código de unidad.
  res.json([...delBlock, ...delCondominio].map((m) => ({
    id: m.id, tipo: m.tipo, ambito: m.estructura_id != null ? 'block' : 'condominio', banco: m.banco, tipo_cuenta: m.tipo_cuenta,
    numero_cuenta: m.numero_cuenta, cci: m.cci, titular: m.titular, celular: m.celular, tiene_qr: m.qr_tipo_mime != null, orden: m.orden,
    ...camposDePago(m, cargo.unidad?.codigo ?? null),
  })));
});
