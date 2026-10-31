import { Router } from 'express';
import { prisma } from '../db';
import { Prisma } from '@prisma/client';
import { forbidden, invalid, notFound } from '../errors';
import { empresaDe, scopeComplejos } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { CODIGOS_MONEDA, CODIGOS_PAIS, decimalesDe, monedaEnPlural } from '../../lib/paises';
import { CAPACIDADES, ESTADOS_SUSCRIPCION, MEDIOS_PAGO_SUSCRIPCION, MODULOS, MONEDA_BASE_PRECIOS } from '../services/comercial/catalogo';
import { puedeAgregarCondominio } from '../services/comercial/cupo';
import { usoDelMes } from '../services/comercial/consumo';
import { obtenerConfiguracion } from '../services/comercial/configuracion';
import { cambiarImpuesto, reflejarTasaEnPeru } from '../services/comercial/impuestos';
import { complejosDe, invalidarComercial } from '../services/comercial/modulos';
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
  /** Consultas al asistente por departamento que se cobra, al mes (0 a 1000; null = sin tope). */
  asistente_por_unidad_mes: z.number().int().min(0, 'Mínimo 0').max(1000, 'Máximo 1000').nullable().optional(),
  /** Mensajes de WhatsApp por departamento que se cobra, al mes (0 a 1000; null = sin tope). */
  whatsapp_por_unidad_mes: z.number().int().min(0, 'Mínimo 0').max(1000, 'Máximo 1000').nullable().optional(),
  caracteristicas: z.array(texto(120)).max(12).optional(),
  igv_incluido: z.boolean().optional(),
  visible: z.boolean().optional(),
});
/** Tasa de un impuesto en fracción (18 % = 0.18), hasta 4 decimales. */
const tasaSchema = z.union([z.number(), z.string()]).transform((v) => String(v).trim()).pipe(z.string().regex(/^(0(\.\d{1,4})?|1)$/, 'La tasa va entre 0 y 1 (18 % = 0.18)'));
const paisEnum = z.string().transform((v) => v.trim().toUpperCase()).pipe(z.enum(CODIGOS_PAIS, { error: 'País inválido' }));
const monedaEnum = z.string().transform((v) => v.trim().toUpperCase()).pipe(z.enum(CODIGOS_MONEDA, { error: 'Moneda inválida' }));
const impuestoParams = z.object({ pais: paisEnum });
const precioMonedaParams = z.object({ clave: z.string().min(1).max(40), moneda: monedaEnum });
const impuestoSchema = z.object({ nombre: texto(20).optional(), tasa: tasaSchema.optional(), moneda: monedaEnum.optional(), activo: z.boolean().optional() });
/** Texto opcional que, si viene vacío o sólo con espacios, se guarda como null (no como ""). */
const textoLegal = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max, `Máximo ${max} caracteres`).nullish());
const configSchema = z.object({
  igv_tasa: tasaSchema.optional(),
  dias_gracia: z.number().int().min(0).max(90).optional(),
  dias_aviso_vencimiento: z.number().int().min(1).max(60).optional(),
  correo_superadmin: z.preprocess((v) => (v === '' ? null : v), z.email('Correo inválido').max(160).nullish()),
  url_publica: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(200).regex(/^https?:\/\/[^\s/]+[^\s]*$/i, 'Debe empezar con https://').nullish()),
  registro_abierto: z.boolean().optional(),
  /** Días de Pro de prueba al registrarse (0 = sin prueba: el condominio nace en Gratis). */
  dias_prueba_pro: z.number().int().min(0).max(90).optional(),
  /** Días de Gratis desde el registro (la prueba de Pro va dentro); pasado el plazo, el condominio queda en solo lectura. null o 0 = sin plazo. */
  dias_gratis: z.number().int().min(0, 'Mínimo 0').max(365, 'Máximo 365').nullable().optional(),
  pago_titular: textoOpcional(120),
  pago_banco: textoOpcional(80),
  pago_cuenta: textoOpcional(60),
  pago_cci: textoOpcional(60),
  pago_yape: textoOpcional(60),
  pago_instrucciones: textoOpcional(500),
  // Datos legales (Ley 29733): los ve el público en /privacidad y /terminos; vacío (o sólo espacios) = null = «por confirmar».
  legal_razon_social: textoLegal(160),
  legal_ruc: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().regex(/^\d{11}$/, 'El RUC tiene 11 dígitos').nullish()),
  legal_domicilio: textoLegal(255),
  legal_correo: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.email('Correo inválido').max(160).nullish()),
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
 *   get: { summary: "Plan, módulos, monto y vigencia de cada condominio de tu empresa + cómo pagar + si puedes agregar otro condominio", tags: [Comercial], security: [{ cookieAuth: [] }], responses: { 200: { description: "{ condominios, pagar, catalogo, puede_agregar_condominio }" } } } */
comercialRouter.get('/mi-plan', requireRole('admin'), async (req, res) => {
  const u = soloAdmin(req);
  const complejos = await prisma.complejoHabitacional.findMany({ where: scopeComplejos(u), select: { id: true } });
  const [condominios, pagar, catalogo, puede] = await Promise.all([vistas(complejos.map((c) => c.id)), datosParaPagar(), catalogoPublico(), puedeAgregarCondominio(empresaDe(u))]);
  // Cada condominio trae cuánto va del mes (topes y vouchers) para la pantalla y el Resumen.
  const usos = await Promise.all(condominios.map((c) => usoDelMes(c.complejo_id)));
  res.json({ condominios: condominios.map((c, i) => ({ ...c, uso: usos[i] })), pagar, catalogo, puede_agregar_condominio: puede });
});

/** @openapi
 * /api/comercial/estado-operativo:
 *   get: { summary: "Si los condominios que alcanzas están en solo lectura (terminó su periodo gratis), con el último día gratis y lo que cuesta Básico; lo lee la banda de todas las pantallas", tags: [Comercial], security: [{ cookieAuth: [] }], responses: { 200: { description: "{ condominios: [{ complejo_id, complejo, solo_lectura, gratis_hasta, solo_lectura_desde, dias_gratis_restantes, basico_desde }] }; el superadmin recibe la lista vacía (nunca queda en solo lectura)" } } } */
comercialRouter.get('/estado-operativo', async (req, res) => {
  const ids = await complejosDe(currentUser(req));
  if (!ids?.length) return void res.json({ condominios: [] });
  const vs = await vistas(ids);
  res.json({
    condominios: vs.map((v) => ({ complejo_id: v.complejo_id, complejo: v.complejo, solo_lectura: v.solo_lectura, gratis_hasta: v.gratis_hasta, solo_lectura_desde: v.solo_lectura_desde, dias_gratis_restantes: v.dias_gratis_restantes, basico_desde: v.basico_desde })),
  });
});

/** @openapi
 * /api/comercial/mi-plan/{complejoId}/uso:
 *   get: { summary: "Lo que va del mes de un condominio de tu empresa: consultas al asistente y WhatsApp frente a su tope, y los vouchers validados a mano y con la IA", tags: [Comercial], responses: { 200: { description: "{ periodo, renueva, asistente, whatsapp, vouchers_a_mano, vouchers_ia }" }, 404: { description: "No es de tu empresa" } } } */
comercialRouter.get('/mi-plan/:complejoId/uso', requireRole('admin'), async (req, res) => {
  const { complejoId } = parse(complejoParams, req.params);
  const { id } = await complejoPropio(req, complejoId);
  res.json(await usoDelMes(id));
});

/** @openapi
 * /api/comercial/puede-agregar-condominio:
 *   get: { summary: "¿Puedes crear otro condominio? Gratis incluye uno: con uno ya en Gratis, no (y el motivo para mostrarlo)", tags: [Comercial], responses: { 200: { description: "{ puede, motivo, gratis }" } } } */
comercialRouter.get('/puede-agregar-condominio', requireRole('admin'), async (req, res) => {
  res.json(await puedeAgregarCondominio(empresaDe(soloAdmin(req))));
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
  res.locals.auditDetalle = { complejo_id: complejoId, monto: pago.monto.toFixed(decimalesDe(pago.moneda)), moneda: pago.moneda, medio: pago.medio, operacion: pago.operacion, periodo_desde: body.periodo_desde.toISOString().slice(0, 10), periodo_hasta: body.periodo_hasta.toISOString().slice(0, 10) };
  res.status(201).json({ pago: pagoVista(pago), suscripcion: (await vistas([complejoId], { conNotas: true }))[0] });
});

comercialRouter.get('/suscripciones/:complejoId/pagos', superadmin, async (req, res) => {
  const { complejoId } = parse(complejoParams, req.params);
  const pagos = await prisma.pagoSuscripcion.findMany({ where: { complejo_id: complejoId }, orderBy: [{ fecha_pago: 'desc' }, { id: 'desc' }] });
  res.json({ items: pagos.map(pagoVista) });
});

/** Precios BASE y datos completos para editarlos (el público sólo ve el precio sin impuesto, en la moneda de su país), más el impuesto de cada país y los precios por moneda. */
comercialRouter.get('/catalogo', superadmin, async (_req, res) => {
  const [planes, modulos, configuracion] = await Promise.all([prisma.planComercial.findMany({ orderBy: { orden: 'asc' } }), prisma.moduloComercial.findMany({ orderBy: { orden: 'asc' } }), obtenerConfiguracion()]);
  const [impuestos, precios_moneda] = await Promise.all([prisma.impuestoPais.findMany({ orderBy: { pais: 'asc' } }), prisma.precioPlanMoneda.findMany({ orderBy: [{ plan_clave: 'asc' }, { moneda: 'asc' }] })]);
  res.json({ planes, modulos, configuracion, impuestos, precios_moneda });
});

/** @openapi
 * /api/comercial/impuestos/{pais}:
 *   put: { summary: "Edita el impuesto (nombre, tasa en fracción), la moneda de cobro y si el país está abierto a contratar (sólo superadmin; auditado)", tags: [Comercial], responses: { 200: { description: "La fila del país" }, 403: { description: "Sólo superadmin" }, 404: { description: "País desconocido" }, 422: { description: "Datos inválidos" } } } */
comercialRouter.put('/impuestos/:pais', superadmin, async (req, res) => {
  const { pais } = parse(impuestoParams, req.params);
  const body = parseBody(impuestoSchema, req);
  const fila = await cambiarImpuesto(pais, body);
  invalidarComercial();
  res.locals.entidad = 'impuesto_pais';
  res.locals.accion = 'editar';
  res.locals.auditDetalle = { pais, ...definidos(body) };
  res.json(fila);
});

/** @openapi
 * /api/comercial/planes/{clave}/precios/{moneda}:
 *   put: { summary: "Fija el precio base por departamento al mes de un plan en una moneda (en soles es el precio del plan); sin precio en la moneda de un país, ese país no puede contratarlo (sólo superadmin; auditado)", tags: [Comercial], responses: { 200: { description: "El precio" }, 404: { description: "Plan inexistente" } } }
 *   delete: { summary: "Quita el precio de un plan en una moneda (vuelve a «Consúltanos»); el de soles no se quita", tags: [Comercial], responses: { 204: { description: "Quitado" } } } */
comercialRouter.put('/planes/:clave/precios/:moneda', superadmin, async (req, res) => {
  const { clave, moneda } = parse(precioMonedaParams, req.params);
  const { precio_por_unidad } = parseBody(z.object({ precio_por_unidad: precio }), req);
  if (decimalesDe(moneda) === 0 && /\./.test(precio_por_unidad)) throw invalid(`Datos inválidos: precio_por_unidad: en ${monedaEnPlural(moneda)} el precio no lleva decimales`, { precio_por_unidad: 'Sin decimales en esta moneda' });
  if (!(await prisma.planComercial.findUnique({ where: { clave }, select: { clave: true } }))) throw notFound('Plan');
  const dato = new Prisma.Decimal(precio_por_unidad);
  // El precio en soles es el del plan mismo (lo que ya existía); las demás monedas viven en PrecioPlanMoneda.
  if (moneda === MONEDA_BASE_PRECIOS) await prisma.planComercial.update({ where: { clave }, data: { precio_por_unidad: dato } });
  else await prisma.precioPlanMoneda.upsert({ where: { plan_clave_moneda: { plan_clave: clave, moneda } }, create: { plan_clave: clave, moneda, precio_por_unidad: dato }, update: { precio_por_unidad: dato } });
  invalidarComercial();
  res.locals.entidad = 'precio_plan_moneda';
  res.locals.accion = 'editar';
  res.locals.auditDetalle = { plan: clave, moneda, precio_por_unidad };
  res.json({ plan_clave: clave, moneda, precio_por_unidad });
});

comercialRouter.delete('/planes/:clave/precios/:moneda', superadmin, async (req, res) => {
  const { clave, moneda } = parse(precioMonedaParams, req.params);
  if (moneda === MONEDA_BASE_PRECIOS) throw invalid('Datos inválidos: moneda: el precio en soles es el del plan y no se quita', { moneda: 'El precio en soles no se quita' });
  const hay = await prisma.precioPlanMoneda.findUnique({ where: { plan_clave_moneda: { plan_clave: clave, moneda } }, select: { plan_clave: true } });
  if (!hay) throw notFound('Precio');
  await prisma.precioPlanMoneda.delete({ where: { plan_clave_moneda: { plan_clave: clave, moneda } } });
  invalidarComercial();
  res.locals.entidad = 'precio_plan_moneda';
  res.locals.accion = 'quitar';
  res.locals.auditDetalle = { plan: clave, moneda };
  res.status(204).end();
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
  if (body.igv_tasa !== undefined) await reflejarTasaEnPeru(body.igv_tasa); // el IGV de aquí es el de Perú: la tabla de impuestos por país lo sigue
  invalidarComercial();
  res.locals.entidad = 'configuracion_comercial';
  res.locals.entidadId = null;
  res.locals.accion = 'editar';
  res.locals.auditDetalle = { campos: Object.keys(definidos(body)) }; // datos de pago: sólo qué campos cambiaron
  res.json(c);
});
