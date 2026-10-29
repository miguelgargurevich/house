import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, invalid, notFound } from '../errors';
import { hoyEn } from '../lib/fechas';
import { ambitoJunta, puedeGestionar } from '../lib/junta';
import { scopeComplejos, scopeJuntas } from '../lib/scope';
import { zonaDeComplejo } from '../lib/zonas';
import { currentUser, type AuthUser } from '../middleware/auth';
import {
  bloquearCondominio, cerrarSesiones, copiarCuentas, correoJuntaSchema, crearCuenta, cuentasActivas, diaAnterior, diaSchema, diaTexto, exigirVigente, formatearJuntas,
  incluirDetalle, juntaFormateada, miembrosSchema, notasSchema, reemplazarMiembros, sincronizarCargosTx, soloAdministracion, validarMiembros, vigenteDe,
} from '../services/juntas';
import { medioSchema } from '../services/mediosPago';
import { idSchema, parse, parseBody, parseId, z } from '../validation';

export const juntasRouter = Router();
juntasRouter.use((req, res, next) => {
  res.locals.entidad = 'junta';
  scopeJuntas(currentUser(req)); // lanza 403 si no es admin, superadmin ni junta con cargo de gestión
  next();
});

const esAdministracion = (u: AuthUser) => u.rol === 'admin' || u.rol === 'superadmin';
/** Los miembros, las notas y las gestiones nuevas son de la administración; la junta sólo cambia su correo y su cuenta. */
const exigirAdministracion = (u: AuthUser) => { if (!esAdministracion(u)) throw soloAdministracion(); };

const estructuraIdQuery = z.union([idSchema, z.literal('ninguna')]);

/** Condominio y block de una junta nueva, comprobando que quien llama administra ese condominio; si no, 404 (no se revela qué existe). */
async function resolverAmbito(u: AuthUser, complejoId: number, estructuraId: number | null | undefined) {
  if (!(await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id: complejoId }, scopeComplejos(u)] }, select: { id: true } }))) throw notFound('Condominio');
  const estructura = estructuraId ?? null;
  if (estructura != null && !(await prisma.estructura.findFirst({ where: { id: estructura, complejo_id: complejoId }, select: { id: true } }))) throw notFound('Block');
  return { complejo_id: complejoId, estructura_id: estructura };
}

/** Una junta del alcance de quien llama (otro tenant o la junta de otro block → 404). */
async function cargarJunta(u: AuthUser, id: number) {
  const j = await prisma.juntaDirectiva.findFirst({ where: { AND: [{ id }, scopeJuntas(u)] } });
  if (!j) throw notFound('Junta');
  return j;
}

/** La fecha de inicio de una gestión nunca es futura (en la zona del condominio). */
async function exigirNoFutura(complejoId: number, desde: Date) {
  const hoy = hoyEn(await zonaDeComplejo(complejoId));
  if (desde.getTime() > hoy.getTime()) throw invalid(`Datos inválidos: desde: no puede ser posterior a hoy (${diaTexto(hoy)})`, { desde: 'No puede ser futura' });
}

const detalleAuditoria = (j: { complejo_id: number; estructura_id: number | null; desde: Date }, extra: Record<string, Prisma.InputJsonValue> = {}) =>
  ({ complejo_id: j.complejo_id, estructura_id: j.estructura_id, desde: diaTexto(j.desde), ...extra });

// ---------- Listas ----------
/**
 * @openapi
 * /api/juntas:
 *   get:
 *     tags: [Juntas]
 *     summary: Una ficha por block con su junta vigente (miembros, correo y cuenta)
 *     parameters:
 *       - { in: query, name: complejo_id, schema: { type: integer } }
 *     responses:
 *       200: { description: "{ items: [{ complejo, estructura, vigente, anteriores }], complejos, puede_gestionar }" }
 *       403: { description: Secretario, vocal o residente }
 */
juntasRouter.get('/', async (req, res) => {
  const u = currentUser(req);
  const q = parse(z.object({ complejo_id: idSchema.optional() }), req.query);
  const junta = ambitoJunta(u);
  const complejos = await prisma.complejoHabitacional.findMany({
    where: { AND: [junta ? { id: junta.complejo_id } : scopeComplejos(u), q.complejo_id !== undefined ? { id: q.complejo_id } : {}] },
    orderBy: { nombre: 'asc' },
    take: 100,
    select: { id: true, nombre: true, estructuras: { where: junta?.estructura_id != null ? { id: junta.estructura_id } : {}, orderBy: [{ nombre: 'asc' }, { id: 'asc' }], take: 200, select: { id: true, nombre: true, tipo: true } } },
  });
  const ids = complejos.map((c) => c.id);
  const donde = { AND: [scopeJuntas(u), { complejo_id: { in: ids } }] } satisfies Prisma.JuntaDirectivaWhereInput;
  const [vigentes, cerradas] = await Promise.all([
    prisma.juntaDirectiva.findMany({ where: { AND: [donde, { hasta: null }] }, include: incluirDetalle }),
    prisma.juntaDirectiva.groupBy({ by: ['complejo_id', 'estructura_id'], where: { AND: [donde, { hasta: { not: null } }] }, _count: { _all: true } }),
  ]);
  const formateadas = await formatearJuntas(vigentes);
  const vigentePor = new Map(formateadas.map((j) => [`${j.complejo_id}:${j.estructura_id}`, j]));
  const anteriores = new Map(cerradas.map((c) => [`${c.complejo_id}:${c.estructura_id}`, c._count._all]));
  const items = complejos.flatMap((c) => {
    const complejo = { id: c.id, nombre: c.nombre };
    const ficha = (estructura: { id: number; nombre: string | null; tipo: string } | null) => {
      const clave = `${c.id}:${estructura?.id ?? null}`;
      return { complejo, estructura, vigente: vigentePor.get(clave) ?? null, anteriores: anteriores.get(clave) ?? 0 };
    };
    const delCondominio = ficha(null);
    // La junta de todo el condominio sólo sale si existe (vigente o pasada): no es un block más.
    return [...c.estructuras.map(ficha), ...(delCondominio.vigente || delCondominio.anteriores ? [delCondominio] : [])];
  });
  res.json({ items, complejos: complejos.map((c) => ({ id: c.id, nombre: c.nombre })), puede_gestionar: esAdministracion(u) });
});

/**
 * @openapi
 * /api/juntas/historial:
 *   get:
 *     tags: [Juntas]
 *     summary: Gestiones anteriores (cerradas) de un block, con sus miembros, correo y cuenta (sólo lectura)
 *     parameters:
 *       - { in: query, name: complejo_id, required: true, schema: { type: integer } }
 *       - { in: query, name: estructura_id, schema: { oneOf: [{ type: integer }, { type: string, enum: [ninguna] }] }, description: "Sin él o «ninguna»: la junta de todo el condominio" }
 *     responses:
 *       200: { description: "{ items: [junta] } de la más reciente a la más antigua" }
 */
juntasRouter.get('/historial', async (req, res) => {
  const u = currentUser(req);
  const q = parse(z.object({ complejo_id: idSchema, estructura_id: estructuraIdQuery.optional() }), req.query);
  const estructura = q.estructura_id === undefined || q.estructura_id === 'ninguna' ? null : q.estructura_id;
  const filas = await prisma.juntaDirectiva.findMany({
    where: { AND: [scopeJuntas(u), { complejo_id: q.complejo_id, estructura_id: estructura, hasta: { not: null } }] },
    orderBy: [{ desde: 'desc' }, { id: 'desc' }],
    take: 100,
    include: incluirDetalle,
  });
  res.json({ items: await formatearJuntas(filas) });
});

/**
 * @openapi
 * /api/juntas/candidatos:
 *   get:
 *     tags: [Juntas]
 *     summary: Propietarios que pueden ser miembros de la junta de un block (administración)
 *     parameters:
 *       - { in: query, name: complejo_id, required: true, schema: { type: integer } }
 *       - { in: query, name: estructura_id, schema: { type: integer } }
 */
juntasRouter.get('/candidatos', async (req, res) => {
  const u = currentUser(req);
  exigirAdministracion(u);
  const q = parse(z.object({ complejo_id: idSchema, estructura_id: idSchema.optional() }), req.query);
  const ambito = await resolverAmbito(u, q.complejo_id, q.estructura_id);
  const enAmbito = { complejo_id: ambito.complejo_id, ...(ambito.estructura_id != null ? { estructura_id: ambito.estructura_id } : {}) };
  const propietarios = await prisma.usuario.findMany({
    where: { rol: 'propietario', unidades: { some: enAmbito } },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    take: 500,
    select: { id: true, nombre: true, email: true, telefono: true, unidades: { where: enAmbito, orderBy: { codigo: 'asc' }, select: { codigo: true } }, miembrosJunta: { where: { junta: { hasta: null } }, select: { junta_id: true } } },
  });
  res.json({ items: propietarios.map((p) => ({ id: p.id, nombre: p.nombre, email: p.email, telefono: p.telefono, departamentos: p.unidades.map((x) => x.codigo), junta_vigente_id: p.miembrosJunta[0]?.junta_id ?? null })) });
});

/**
 * @openapi
 * /api/juntas/{id}:
 *   get:
 *     tags: [Juntas]
 *     summary: Una junta (vigente o de una gestión anterior)
 *     responses:
 *       200: { description: La junta con sus miembros, correo y cuenta }
 *       404: { description: No existe o es de otro tenant o de otro block }
 */
juntasRouter.get('/:id', async (req, res) => {
  const j = await cargarJunta(currentUser(req), parseId(req));
  res.json(await juntaFormateada(j.id));
});

// ---------- Escritura ----------
const crearSchema = z.object({
  complejo_id: idSchema,
  /** Ausente o null = la junta de todo el condominio. */
  estructura_id: idSchema.nullish(),
  desde: diaSchema,
  correo: correoJuntaSchema,
  notas: notasSchema,
  miembros: miembrosSchema.default([]),
  /** La cuenta de la junta (el formulario de medio de pago de siempre); opcional: se puede agregar después. */
  medio: medioSchema.optional(),
});

/**
 * @openapi
 * /api/juntas:
 *   post:
 *     tags: [Juntas]
 *     summary: Registra la PRIMERA junta de un block (administración). Una junta vigente ya existente → 409 (usa nueva-gestion)
 *     responses:
 *       201: { description: La junta creada; sus miembros reciben el cargo y sus sesiones se cierran }
 *       403: { description: Sólo la administración }
 *       404: { description: Condominio o block ajeno }
 *       409: { description: El block ya tiene una junta vigente }
 *       422: { description: Fecha futura, cargos repetidos o miembro que no es propietario del block }
 */
juntasRouter.post('/', async (req, res) => {
  const u = currentUser(req);
  exigirAdministracion(u);
  const d = parseBody(crearSchema, req);
  const ambito = await resolverAmbito(u, d.complejo_id, d.estructura_id);
  await exigirNoFutura(ambito.complejo_id, d.desde);
  const { junta, cambiados } = await prisma.$transaction(async (tx) => {
    await bloquearCondominio(tx, ambito.complejo_id);
    if (await vigenteDe(tx, ambito.complejo_id, ambito.estructura_id)) throw conflict('Ese block ya tiene una junta vigente: registra una nueva gestión');
    const ultima = await tx.juntaDirectiva.findFirst({ where: { ...ambito, hasta: { not: null } }, orderBy: { hasta: 'desc' }, select: { hasta: true } });
    if (ultima?.hasta && d.desde.getTime() <= ultima.hasta.getTime()) throw invalid(`Datos inválidos: desde: debe ser posterior al fin de la gestión anterior (${diaTexto(ultima.hasta)})`, { desde: 'Se cruza con la gestión anterior' });
    await validarMiembros(tx, ambito, d.miembros);
    const creada = await tx.juntaDirectiva.create({ data: { ...ambito, desde: d.desde, correo: d.correo ?? null, notas: d.notas ?? null, creado_por_id: u.id } });
    if (d.miembros.length) await tx.miembroJunta.createMany({ data: d.miembros.map((m) => ({ junta_id: creada.id, usuario_id: m.usuario_id, cargo: m.cargo })) });
    // Los medios que el block ya tenía (de antes de las juntas) pasan a ser la cuenta de esta junta.
    await tx.medioPago.updateMany({ where: { ...ambito, junta_id: null, activo: true }, data: { junta_id: creada.id } });
    if (d.medio) await crearCuenta(tx, creada, d.medio, u.id);
    return { junta: creada, cambiados: await sincronizarCargosTx(tx, ambito.complejo_id, ambito.estructura_id) };
  });
  await cerrarSesiones(cambiados);
  res.locals.entidadId = junta.id;
  res.locals.auditDetalle = detalleAuditoria(junta, { miembros: d.miembros.length });
  res.status(201).json(await juntaFormateada(junta.id));
});

const editarSchema = z.object({
  correo: correoJuntaSchema,
  notas: notasSchema,
  miembros: miembrosSchema.optional(),
});

/**
 * @openapi
 * /api/juntas/{id}:
 *   put:
 *     tags: [Juntas]
 *     summary: Edita la junta VIGENTE sin cerrar la gestión
 *     description: >
 *       La administración cambia correo, notas y miembros (la lista completa: agrega, quita y cambia de cargo).
 *       El presidente y el tesorero sólo cambian el correo de SU junta; `notas` o `miembros` → 403. La cuenta se edita con `/api/medios-pago`.
 *     responses:
 *       200: { description: La junta }
 *       403: { description: La junta intentó cambiar miembros o notas }
 *       404: { description: Ajena }
 *       422: { description: Gestión cerrada, cargos repetidos o miembro que no es propietario del block }
 */
juntasRouter.put('/:id', async (req, res) => {
  const u = currentUser(req);
  const actual = await cargarJunta(u, parseId(req));
  const d = parseBody(editarSchema, req);
  if (!esAdministracion(u)) {
    if (!puedeGestionar(u, actual)) throw notFound('Junta');
    if (d.miembros !== undefined || d.notas !== undefined) throw soloAdministracion();
  }
  exigirVigente(actual);
  const cambiados = await prisma.$transaction(async (tx) => {
    await bloquearCondominio(tx, actual.complejo_id);
    const fresca = await tx.juntaDirectiva.findUniqueOrThrow({ where: { id: actual.id } });
    exigirVigente(fresca);
    if (d.miembros !== undefined) {
      await validarMiembros(tx, fresca, d.miembros, fresca.id);
      await reemplazarMiembros(tx, fresca.id, d.miembros);
    }
    await tx.juntaDirectiva.update({ where: { id: fresca.id }, data: { ...(d.correo !== undefined ? { correo: d.correo } : {}), ...(d.notas !== undefined ? { notas: d.notas } : {}) } });
    return d.miembros !== undefined ? sincronizarCargosTx(tx, fresca.complejo_id, fresca.estructura_id) : [];
  });
  await cerrarSesiones(cambiados);
  res.locals.entidadId = actual.id;
  res.locals.auditDetalle = detalleAuditoria(actual, { correo: d.correo !== undefined, notas: d.notas !== undefined, ...(d.miembros ? { miembros: d.miembros.length } : {}) });
  res.json(await juntaFormateada(actual.id));
});

const nuevaGestionSchema = z.object({
  desde: diaSchema,
  correo: correoJuntaSchema,
  notas: notasSchema,
  miembros: miembrosSchema,
  /** «La cuenta sigue siendo la misma»: las cuentas activas de la gestión que termina se copian a la nueva. */
  misma_cuenta: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
  /** Una cuenta nueva para la gestión (no se combina con `misma_cuenta`). */
  medio: medioSchema.optional(),
}).refine((v) => !(v.misma_cuenta && v.medio), { path: ['medio'], message: 'Elige la misma cuenta o una nueva, no las dos' });

/**
 * @openapi
 * /api/juntas/{id}/nueva-gestion:
 *   post:
 *     tags: [Juntas]
 *     summary: Cierra la gestión vigente y abre otra (administración)
 *     description: >
 *       La vigente termina el día anterior a `desde` (que no puede ser futura ni anterior o igual al inicio de la vigente); sus cuentas pasan a inactivas
 *       (los vecinos ya no las ven) y, con `misma_cuenta`, se copian a la nueva junta. Los cargos pasan solos a los miembros nuevos y se cierran las
 *       sesiones de quien cambió de cargo.
 *     responses:
 *       201: { description: La junta nueva }
 *       403: { description: Sólo la administración }
 *       404: { description: Ajena }
 *       409: { description: La gestión ya estaba cerrada }
 *       422: { description: Fecha inválida, cargos repetidos o miembro que no es propietario del block }
 */
juntasRouter.post('/:id/nueva-gestion', async (req, res) => {
  const u = currentUser(req);
  exigirAdministracion(u);
  const actual = await cargarJunta(u, parseId(req));
  const d = parseBody(nuevaGestionSchema, req);
  exigirVigente(actual);
  await exigirNoFutura(actual.complejo_id, d.desde);
  const { nueva, cambiados, copiadas } = await prisma.$transaction(async (tx) => {
    await bloquearCondominio(tx, actual.complejo_id);
    const fresca = await tx.juntaDirectiva.findUniqueOrThrow({ where: { id: actual.id } });
    if (fresca.hasta != null) throw conflict('Esa gestión ya estaba cerrada');
    if (d.desde.getTime() <= fresca.desde.getTime()) throw invalid(`Datos inválidos: desde: debe ser posterior al inicio de la gestión vigente (${diaTexto(fresca.desde)})`, { desde: 'Debe ser posterior al inicio de la vigente' });
    const ambito = { complejo_id: fresca.complejo_id, estructura_id: fresca.estructura_id };
    await validarMiembros(tx, ambito, d.miembros, fresca.id);
    const cuentas = d.misma_cuenta ? await cuentasActivas(tx, fresca.id) : [];
    await tx.juntaDirectiva.update({ where: { id: fresca.id }, data: { hasta: diaAnterior(d.desde) } });
    await tx.medioPago.updateMany({ where: { junta_id: fresca.id, activo: true }, data: { activo: false } });
    const creada = await tx.juntaDirectiva.create({ data: { ...ambito, desde: d.desde, correo: d.correo ?? null, notas: d.notas ?? null, creado_por_id: u.id } });
    if (d.miembros.length) await tx.miembroJunta.createMany({ data: d.miembros.map((m) => ({ junta_id: creada.id, usuario_id: m.usuario_id, cargo: m.cargo })) });
    const copiadas = await copiarCuentas(tx, cuentas, creada.id, u.id);
    if (d.medio) await crearCuenta(tx, creada, d.medio, u.id);
    return { nueva: creada, copiadas, cambiados: await sincronizarCargosTx(tx, ambito.complejo_id, ambito.estructura_id) };
  });
  await cerrarSesiones(cambiados);
  res.locals.entidadId = nueva.id;
  res.locals.accion = 'nueva_gestion';
  res.locals.auditDetalle = detalleAuditoria(nueva, { anterior_id: actual.id, miembros: d.miembros.length, cuentas_copiadas: copiadas });
  res.status(201).json(await juntaFormateada(nueva.id));
});
