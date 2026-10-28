import { Router } from 'express';
import { prisma } from '../db';
import { forbidden, notFound } from '../errors';
import { scopeComplejos } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { CAPACIDADES, ESTADOS_SUSCRIPCION, MEDIOS_PAGO_SUSCRIPCION, MODULOS } from '../services/comercial/catalogo';
import { obtenerConfiguracion } from '../services/comercial/configuracion';
import { invalidarComercial } from '../services/comercial/modulos';
import { cambiarSuscripcion, cancelarSolicitud, catalogoPublico, datosParaPagar, pagoVista, registrarPago, solicitar, vistas } from '../services/comercial/suscripciones';
import { fechaSchema, idSchema, listQuerySchema, parse, parseBody, parseQuery, texto, textoOpcional, z } from '../validation';

const precio = z.union([z.number(), z.string()], { error: 'Precio inválido' }).transform((v) => String(v).trim()).pipe(z.string().regex(/^\d{1,6}(\.\d{1,4})?$/, 'Precio inválido (máx. 4 decimales)'));
const moduloEnum = z.enum(MODULOS, { error: `Módulo inválido (${MODULOS.join(', ')})` });
const capacidadEnum = z.enum(CAPACIDADES, { error: `Capacidad inválida (${CAPACIDADES.join(', ')})` });
const claveParams = z.object({ clave: z.string().min(1).max(40) });
const complejoParams = z.object({ complejoId: idSchema });

/** Los módulos ya no se piden sueltos (una clave `modulos` en el body se ignora): se pide un plan y trae todo. */
const solicitudSchema = z.object({ plan: z.string({ error: 'Elige un plan' }).min(1, 'Elige un plan').max(40) });

const cambioSchema = z.object({
  plan_clave: z.string().min(1).max(40).optional(),
  modulos: z.array(moduloEnum).max(MODULOS.length).optional(),
  vigente_hasta: fechaSchema.nullable().optional(),
  notas: textoOpcional(1000),
});

const pagoSchema = z.object({
  monto: z.union([z.number(), z.string()], { error: 'Monto inválido' }).transform((v) => String(v).trim()).pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Monto inválido (máx. 2 decimales)')).refine((v) => Number(v) > 0, 'El monto debe ser mayor que cero'),
  fecha_pago: fechaSchema,
  medio: z.enum(MEDIOS_PAGO_SUSCRIPCION, { error: `Medio inválido (${MEDIOS_PAGO_SUSCRIPCION.join(', ')})` }),
  operacion: textoOpcional(80),
  periodo_desde: fechaSchema,
  periodo_hasta: fechaSchema,
  voucher_ref: textoOpcional(200),
  notas: textoOpcional(500),
});

const moduloSchema = z.object({ nombre: texto(80).optional(), descripcion: textoOpcional(300), precio_por_unidad: precio.optional(), activo: z.boolean().optional() });
const planSchema = z.object({
  nombre: texto(80).optional(),
  descripcion: textoOpcional(300),
  precio_por_unidad: precio.optional(),
  modulos_incluidos: z.array(capacidadEnum).max(CAPACIDADES.length).optional(),
  unidades_maximas: z.number().int().min(1, 'Mínimo 1').max(100_000).nullable().optional(),
  unidades_minimas: z.number().int().min(1, 'Mínimo 1').max(100_000).nullable().optional(),
  caracteristicas: z.array(texto(120)).max(12).optional(),
  igv_incluido: z.boolean().optional(),
  visible: z.boolean().optional(),
});
const configSchema = z.object({
  igv_tasa: z.union([z.number(), z.string()]).transform((v) => String(v).trim()).pipe(z.string().regex(/^(0(\.\d{1,4})?|1)$/, 'La tasa va entre 0 y 1 (18 % = 0.18)')).optional(),
  dias_gracia: z.number().int().min(0).max(90).optional(),
  dias_aviso_vencimiento: z.number().int().min(1).max(60).optional(),
  correo_superadmin: z.preprocess((v) => (v === '' ? null : v), z.email('Correo inválido').max(160).nullish()),
  url_publica: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(200).regex(/^https?:\/\/[^\s/]+[^\s]*$/i, 'Debe empezar con https://').nullish()),
  registro_abierto: z.boolean().optional(),
  pago_titular: textoOpcional(120),
  pago_banco: textoOpcional(80),
  pago_cuenta: textoOpcional(60),
  pago_cci: textoOpcional(60),
  pago_yape: textoOpcional(60),
  pago_instrucciones: textoOpcional(500),
});
const listaSchema = listQuerySchema.extend({ estado: z.enum(ESTADOS_SUSCRIPCION).optional(), empresa_id: idSchema.optional() });

const PRIORIDAD: Record<string, number> = { solicitada: 0, por_vencer: 1, vencida: 2, activa: 3, gratis: 4 };

/** Lo definido por el body, sin las claves `undefined` (para `update` parcial). */
const definidos = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export const comercialRouter = Router();

// ---------- Mi plan (administradora): sólo los condominios de SU empresa; otro tenant → 404 ----------
const soloAdmin = (req: Parameters<typeof currentUser>[0]) => {
  const u = currentUser(req);
  if (u.rol !== 'admin') throw forbidden('Mi plan es para administradoras; el superadmin usa Suscripciones');
  return u;
};
const complejoPropio = async (req: Parameters<typeof currentUser>[0], id: number) => {
  const u = soloAdmin(req);
  const c = await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id }, scopeComplejos(u)] }, select: { id: true } });
  if (!c) throw notFound('Condominio');
  return { u, id: c.id };
};

/** @openapi
 * /api/comercial/mi-plan:
 *   get: { summary: "Plan, módulos, monto y vigencia de cada condominio de tu empresa + cómo pagar", tags: [Comercial], security: [{ cookieAuth: [] }], responses: { 200: { description: "{ condominios, pagar, catalogo }" } } } */
comercialRouter.get('/mi-plan', requireRole('admin'), async (req, res) => {
  const u = soloAdmin(req);
  const complejos = await prisma.complejoHabitacional.findMany({ where: scopeComplejos(u), select: { id: true } });
  const [condominios, pagar, catalogo] = await Promise.all([vistas(complejos.map((c) => c.id)), datosParaPagar(), catalogoPublico()]);
  res.json({ condominios, pagar, catalogo });
});

/** @openapi
 * /api/comercial/mi-plan/{complejoId}/solicitud:
 *   post: { summary: "Solicita un plan (Pro o Administradora) para un condominio (avisa al superadmin; no activa nada)", tags: [Comercial], responses: { 200: { description: "Vista del condominio" }, 404: { description: "No es de tu empresa" } } }
 *   delete: { summary: "Cancela la solicitud pendiente", tags: [Comercial], responses: { 204: { description: "Cancelada" } } } */
comercialRouter.post('/mi-plan/:complejoId/solicitud', requireRole('admin'), async (req, res) => {
  const { complejoId } = parse(complejoParams, req.params);
  const { u, id } = await complejoPropio(req, complejoId);
  const body = parseBody(solicitudSchema, req);
  const yo = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { nombre: true, email: true } });
  await solicitar(id, body, yo);
  res.locals.entidad = 'suscripcion';
  res.locals.entidadId = id;
  res.locals.accion = 'solicitar';
  res.locals.auditDetalle = { complejo_id: id, plan: body.plan };
  res.json((await vistas([id]))[0]);
});

comercialRouter.delete('/mi-plan/:complejoId/solicitud', requireRole('admin'), async (req, res) => {
  const { complejoId } = parse(complejoParams, req.params);
  const { id } = await complejoPropio(req, complejoId);
  await cancelarSolicitud(id);
  res.locals.entidad = 'suscripcion';
  res.locals.entidadId = id;
  res.locals.accion = 'cancelar_solicitud';
  res.locals.auditDetalle = { complejo_id: id };
  res.status(204).end();
});

/** @openapi
 * /api/comercial/mi-plan/{complejoId}/pagos:
 *   get: { summary: "Historial de pagos de la suscripción de un condominio de tu empresa", tags: [Comercial], responses: { 200: { description: "{ items }" }, 404: { description: "No es de tu empresa" } } } */
comercialRouter.get('/mi-plan/:complejoId/pagos', requireRole('admin'), async (req, res) => {
  const { complejoId } = parse(complejoParams, req.params);
  const { id } = await complejoPropio(req, complejoId);
  const pagos = await prisma.pagoSuscripcion.findMany({ where: { complejo_id: id }, orderBy: [{ fecha_pago: 'desc' }, { id: 'desc' }] });
  res.json({ items: pagos.map(pagoVista) });
});

// ---------- Superadmin: suscripciones, pagos, precios y datos de pago ----------
const superadmin = requireRole(); // sin roles: sólo superadmin

/** @openapi
 * /api/comercial/suscripciones:
 *   get: { summary: "Condominios con empresa, plan, módulos, monto, estado y vigencia (solicitada y por vencer primero)", tags: [Comercial], responses: { 200: { description: "Lista paginada" }, 403: { description: "Sólo superadmin" } } } */
comercialRouter.get('/suscripciones', superadmin, async (req, res) => {
  const q = parseQuery(listaSchema, req);
  const complejos = await prisma.complejoHabitacional.findMany({
    where: { ...(q.empresa_id ? { empresa_id: q.empresa_id } : {}), ...(q.q ? { OR: [{ nombre: { contains: q.q, mode: 'insensitive' } }, { empresa: { nombre: { contains: q.q, mode: 'insensitive' } } }] } : {}) },
    select: { id: true },
  });
  const todas = (await vistas(complejos.map((c) => c.id), { conNotas: true })).filter((v) => !q.estado || v.estado === q.estado);
  todas.sort((a, b) => PRIORIDAD[a.estado] - PRIORIDAD[b.estado] || a.complejo.localeCompare(b.complejo, 'es'));
  const desde = (q.page - 1) * q.pageSize;
  res.json({ items: todas.slice(desde, desde + q.pageSize), total: todas.length, page: q.page, pageSize: q.pageSize });
});

comercialRouter.patch('/suscripciones/:complejoId', superadmin, async (req, res) => {
  const { complejoId } = parse(complejoParams, req.params);
  if (!(await prisma.complejoHabitacional.findUnique({ where: { id: complejoId }, select: { id: true } }))) throw notFound('Condominio');
  const body = parseBody(cambioSchema, req);
  await cambiarSuscripcion(complejoId, body);
  res.locals.entidad = 'suscripcion';
  res.locals.entidadId = complejoId;
  res.locals.accion = 'cambiar';
  res.locals.auditDetalle = { complejo_id: complejoId, ...(body.plan_clave ? { plan: body.plan_clave } : {}), ...(body.modulos ? { modulos: body.modulos } : {}), ...(body.vigente_hasta !== undefined ? { vigente_hasta: body.vigente_hasta?.toISOString().slice(0, 10) ?? null } : {}) };
  res.json((await vistas([complejoId], { conNotas: true }))[0]);
});

/** @openapi
 * /api/comercial/suscripciones/{complejoId}/pagos:
 *   post: { summary: "Registra un pago manual y extiende vigente_hasta (sólo superadmin)", tags: [Comercial], responses: { 201: { description: "Pago registrado" }, 403: { description: "Sólo superadmin" }, 409: { description: "Operación repetida o condominio sin plan de pago" } } }
 *   get: { summary: "Historial de pagos del condominio", tags: [Comercial], responses: { 200: { description: "{ items }" } } } */
comercialRouter.post('/suscripciones/:complejoId/pagos', superadmin, async (req, res) => {
  const { complejoId } = parse(complejoParams, req.params);
  const body = parseBody(pagoSchema, req);
  const pago = await registrarPago(complejoId, body, currentUser(req).id);
  res.locals.entidad = 'pago_suscripcion';
  res.locals.entidadId = pago.id;
  res.locals.accion = 'registrar_pago';
  res.locals.auditDetalle = { complejo_id: complejoId, monto: pago.monto.toFixed(2), medio: pago.medio, operacion: pago.operacion, periodo_desde: body.periodo_desde.toISOString().slice(0, 10), periodo_hasta: body.periodo_hasta.toISOString().slice(0, 10) };
  res.status(201).json({ pago: pagoVista(pago), suscripcion: (await vistas([complejoId], { conNotas: true }))[0] });
});

comercialRouter.get('/suscripciones/:complejoId/pagos', superadmin, async (req, res) => {
  const { complejoId } = parse(complejoParams, req.params);
  const pagos = await prisma.pagoSuscripcion.findMany({ where: { complejo_id: complejoId }, orderBy: [{ fecha_pago: 'desc' }, { id: 'desc' }] });
  res.json({ items: pagos.map(pagoVista) });
});

/** Precios BASE y datos completos para editarlos (el público sólo ve el precio con IGV). */
comercialRouter.get('/catalogo', superadmin, async (_req, res) => {
  const [planes, modulos, configuracion] = await Promise.all([prisma.planComercial.findMany({ orderBy: { orden: 'asc' } }), prisma.moduloComercial.findMany({ orderBy: { orden: 'asc' } }), obtenerConfiguracion()]);
  res.json({ planes, modulos, configuracion });
});

comercialRouter.put('/modulos/:clave', superadmin, async (req, res) => {
  const { clave } = parse(claveParams, req.params);
  const body = parseBody(moduloSchema, req);
  if (!(await prisma.moduloComercial.findUnique({ where: { clave }, select: { clave: true } }))) throw notFound('Módulo');
  const m = await prisma.moduloComercial.update({ where: { clave }, data: definidos(body) });
  invalidarComercial();
  res.locals.entidad = 'modulo_comercial';
  res.locals.accion = 'editar';
  res.locals.auditDetalle = { modulo: clave, ...definidos(body) };
  res.json(m);
});

comercialRouter.put('/planes/:clave', superadmin, async (req, res) => {
  const { clave } = parse(claveParams, req.params);
  const body = parseBody(planSchema, req);
  if (!(await prisma.planComercial.findUnique({ where: { clave }, select: { clave: true } }))) throw notFound('Plan');
  const p = await prisma.planComercial.update({ where: { clave }, data: definidos(body) });
  invalidarComercial();
  res.locals.entidad = 'plan_comercial';
  res.locals.accion = 'editar';
  res.locals.auditDetalle = { plan: clave, ...(body.precio_por_unidad !== undefined ? { precio_por_unidad: body.precio_por_unidad } : {}), ...(body.modulos_incluidos ? { modulos_incluidos: body.modulos_incluidos } : {}), ...(body.unidades_maximas !== undefined ? { unidades_maximas: body.unidades_maximas } : {}), ...(body.unidades_minimas !== undefined ? { unidades_minimas: body.unidades_minimas } : {}), ...(body.visible !== undefined ? { visible: body.visible } : {}) };
  res.json(p);
});

comercialRouter.put('/configuracion', superadmin, async (req, res) => {
  const body = parseBody(configSchema, req);
  await obtenerConfiguracion();
  const c = await prisma.configuracionComercial.update({ where: { id: 1 }, data: definidos(body) });
  invalidarComercial();
  res.locals.entidad = 'configuracion_comercial';
  res.locals.entidadId = null;
  res.locals.accion = 'editar';
  res.locals.auditDetalle = { campos: Object.keys(definidos(body)) }; // datos de pago: sólo qué campos cambiaron
  res.json(c);
});
