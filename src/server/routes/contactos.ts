/**
 * Carga de contactos de los vecinos por Excel (ficha del condominio › Residentes). Sólo admin y superadmin de la empresa del condominio; la junta y los residentes → 403,
 * el condominio de otra empresa → 404. Ver `services/contactos/*` y docs/API-CONTRATO.md.
 *
 *   GET  /api/contactos/plantilla.xlsx?complejo_id=      plantilla prellenada con lo que Torre tiene (`formato=personas`: una fila por persona; sin `formato`, así sólo si hay personas además del propietario y el inquilino)
 *   POST /api/contactos/excel                            sin `confirmar` → 409 REVISAR_CONTACTOS (vista previa, no escribe); con `confirmar=true` guarda
 *   GET  /api/contactos/invitaciones?complejo_id=        «X enviadas, Y en cola (salen en N días)»
 *   POST /api/contactos/invitaciones                     deja en cola a los pendientes del condominio o de un block
 */
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { invalid, notFound } from '../errors';
import { scopeComplejos } from '../lib/scope';
import { ipDe, registrarAuditoria } from '../middleware/audit';
import { currentUser, requireRole } from '../middleware/auth';
import { comercialDeps } from '../services/comercial/modulos';
import { exigirOperativo } from '../services/comercial/operativo';
import { aplicarPlan } from '../services/contactos/aplicar';
import { contarInvitables, encolarInvitaciones, estadoDeLaCola } from '../services/contactos/cola';
import { leerContactos } from '../services/contactos/lector';
import { planificarContactos, type PlanContactos, type Problema } from '../services/contactos/plan';
import { hayPersonasExtra, libroDeContactos, nombreArchivoPlantilla, unidadesParaPlantilla } from '../services/contactos/plantilla';
import { idSchema, parseBody, parseQuery, z } from '../validation';

export const contactosRouter = Router();

const SIN_CACHE = { 'Cache-Control': 'private, no-store' };
/** Candado por condominio para guardar contactos (el 1 es el de estructuras, el 4 el de la cola de invitaciones). */
const CANDADO_CONTACTOS = 3;
/** Problemas que viajan en la respuesta (el total siempre es exacto en `problemas_total`). */
const MAX_PROBLEMAS = 300;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
/** Multer lanza `MulterError` (→ 500) si el archivo pasa del límite: se convierte en un 422 en español, como en recibos. */
const subirArchivo: RequestHandler = (req, res, next) => {
  upload.single('archivo')(req, res, (err?: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(invalid(err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 10 MB' : 'Archivo inválido', { archivo: err.code === 'LIMIT_FILE_SIZE' ? 'Demasiado grande' : 'Archivo inválido' }));
    }
    next(err);
  });
};

/** `true`/`false` (texto de un formulario o de la URL); ausente o vacío = false. */
const casilla = (campo: string) => z.preprocess((v) => (v === undefined || v === null || v === '' ? false : v), z.union([z.boolean(), z.enum(['true', 'false']).transform((x) => x === 'true')], { error: `${campo} debe ser true o false` }));

/** El condominio, sólo si es de la empresa del usuario (superadmin: cualquiera). Otro tenant → 404, nunca 403. */
async function condominioPropio(req: Parameters<typeof currentUser>[0], complejoId: number) {
  const u = currentUser(req);
  const c = await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id: complejoId }, scopeComplejos(u)] }, select: { id: true, nombre: true, empresa_id: true } });
  if (!c) throw notFound('Condominio');
  return { u, c };
}

const complejoQuery = z.object({ complejo_id: idSchema });
/** `formato`: sin él, la plantilla lleva una fila por persona sólo si algún departamento tiene personas además del propietario y el inquilino. */
const plantillaQuery = z.object({ complejo_id: idSchema, formato: z.enum(['clasico', 'personas'], { error: 'formato debe ser: clasico, personas' }).optional() });

contactosRouter.get('/plantilla.xlsx', requireRole('admin'), async (req, res) => {
  const { complejo_id, formato } = parseQuery(plantillaQuery, req);
  const { u, c } = await condominioPropio(req, complejo_id);
  const unidades = await unidadesParaPlantilla(c.id);
  const porPersona = (formato ?? (hayPersonasExtra(unidades) ? 'personas' : 'clasico')) === 'personas';
  // Lleva nombres, correos y celulares de los vecinos: queda constancia de quién la bajó (sólo cantidades).
  await registrarAuditoria({ usuario_id: u.id, accion: 'descargar_plantilla_contactos', entidad: 'complejo', entidad_id: c.id, detalle: { unidades: unidades.length }, ip: ipDe(req) });
  res.set({ ...SIN_CACHE, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nombreArchivoPlantilla(c.nombre)}"` });
  res.send(libroDeContactos(unidades, porPersona ? 'personas' : 'clasico'));
});

const excelBody = z.object({ complejo_id: idSchema, confirmar: casilla('confirmar'), actualizar: casilla('actualizar'), invitar: casilla('invitar') });

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Texto de la vista previa: sólo cantidades. */
export function mensajeContactos(p: PlanContactos): string {
  const r = p.resumen;
  const partes: string[] = [];
  if (r.correos_nuevos) partes.push(`se agregan ${plural(r.correos_nuevos, 'correo', 'correos')}`);
  if (r.correos_cambiados) partes.push(`se cambian ${plural(r.correos_cambiados, 'correo', 'correos')}`);
  if (r.celulares_nuevos) partes.push(`se agregan ${plural(r.celulares_nuevos, 'celular', 'celulares')}`);
  if (r.celulares_cambiados) partes.push(`se cambian ${plural(r.celulares_cambiados, 'celular', 'celulares')}`);
  if (r.inquilinos_nuevos) partes.push(`se crean ${plural(r.inquilinos_nuevos, 'inquilino', 'inquilinos')}`);
  if (r.propietarios_nuevos) partes.push(`se crean ${plural(r.propietarios_nuevos, 'propietario', 'propietarios')}`);
  if (r.personas_nuevas) partes.push(`se agregan ${plural(r.personas_nuevas, 'persona', 'personas')} a la lista de sus departamentos`);
  if (r.personas_cambiadas) partes.push(`se completan los datos de ${plural(r.personas_cambiadas, 'persona', 'personas')} de la lista`);
  if (r.unidades_unidas) partes.push(`${plural(r.unidades_unidas, 'departamento pasa', 'departamentos pasan')} a la persona que ya tiene ese correo`);
  const lista = partes.length ? partes.join(', ') : 'no hay cambios que guardar';
  const errores = r.filas_con_error ? ` ${plural(r.filas_con_error, 'fila tiene', 'filas tienen')} errores y no se guardarán.` : '';
  return `Revisa antes de guardar: ${lista}.${errores} Todavía no se guardó nada.`;
}

const recortar = (p: Problema[]) => p.slice(0, MAX_PROBLEMAS);

contactosRouter.post('/excel', requireRole('admin'), subirArchivo, async (req, res) => {
  const body = parseBody(excelBody, req);
  const { u, c } = await condominioPropio(req, body.complejo_id);
  if (!req.file) throw invalid('Datos inválidos: archivo es obligatorio', { archivo: 'Obligatorio' });
  const lectura = leerContactos(req.file.buffer);
  const ahora = comercialDeps.ahora();
  const opts = { complejoId: c.id, empresaId: c.empresa_id, actualizar: body.actualizar, ahora, porPersona: lectura.por_persona };

  if (!body.confirmar) {
    // Vista previa: sólo lee (una transacción de lectura para ver todo en el mismo instante). No se escribe nada.
    const { plan, invitables } = await prisma.$transaction(async (tx) => {
      const plan = await planificarContactos(tx, lectura.filas, opts, lectura.extras);
      const existentes = plan.conCorreo.flatMap((v) => (v.id == null ? [] : [v.id]));
      const invitables = plan.conCorreo.filter((v) => v.id == null).length + (await contarInvitables(tx, c.id, existentes, ahora));
      return { plan, invitables };
    }, { maxWait: 10_000, timeout: 60_000 });
    plan.resumen.invitables = invitables;
    return void res.status(409).json({
      error: mensajeContactos(plan),
      code: 'REVISAR_CONTACTOS',
      resumen: plan.resumen,
      problemas: recortar(plan.problemas),
      problemas_total: plan.problemas.length,
      filas_vacias: lectura.vacias,
    });
  }

  // Guardar: volver a planificar DENTRO de la transacción, con el candado del condominio, y aplicar lo mismo que se vio.
  await exigirOperativo(c.id, u);
  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${c.id}::int, ${CANDADO_CONTACTOS}::int)`;
    const plan = await planificarContactos(tx, lectura.filas, opts, lectura.extras);
    const aplicado = await aplicarPlan(tx, plan, { complejoId: c.id });
    let encoladas = 0;
    if (body.invitar) {
      const ids = plan.conCorreo.flatMap((v) => { const id = v.id ?? aplicado.ids.get(v.clave); return id == null ? [] : [id]; });
      encoladas = ids.length ? (await encolarInvitaciones(tx, { complejoId: c.id, ids, porUsuarioId: u.id, ahora })).encoladas : 0;
    }
    return { plan, aplicado, encoladas };
  }, { maxWait: 10_000, timeout: 60_000 });

  // Sólo cantidades: nunca nombres, correos ni celulares.
  res.locals.entidad = 'complejo';
  res.locals.entidadId = c.id;
  res.locals.accion = 'cargar_contactos';
  res.locals.auditDetalle = { ...r.plan.resumen, creados: r.aplicado.creados, actualizados: r.aplicado.actualizados, unidades_asignadas: r.aplicado.unidades, personas_agregadas: r.aplicado.personas, invitaciones_encoladas: r.encoladas, actualizar: body.actualizar, invitar: body.invitar };
  res.status(201).json({
    guardado: true,
    resumen: { ...r.plan.resumen, invitables: r.encoladas },
    creados: r.aplicado.creados,
    actualizados: r.aplicado.actualizados,
    unidades_asignadas: r.aplicado.unidades,
    ...(lectura.por_persona ? { personas_agregadas: r.aplicado.personas } : {}),
    invitaciones_encoladas: r.encoladas,
    problemas: recortar(r.plan.problemas),
    problemas_total: r.plan.problemas.length,
  });
});

contactosRouter.get('/invitaciones', requireRole('admin'), async (req, res) => {
  const { complejo_id } = parseQuery(complejoQuery, req);
  const { c } = await condominioPropio(req, complejo_id);
  res.set(SIN_CACHE).json(await estadoDeLaCola(c.id));
});

const invitarBody = z.object({ complejo_id: idSchema, estructura_id: idSchema.nullish() });

contactosRouter.post('/invitaciones', requireRole('admin'), async (req, res) => {
  const body = parseBody(invitarBody, req);
  const { u, c } = await condominioPropio(req, body.complejo_id);
  if (body.estructura_id != null) {
    const b = await prisma.estructura.findFirst({ where: { id: body.estructura_id, complejo_id: c.id }, select: { id: true } });
    if (!b) throw notFound('Block');
  }
  await exigirOperativo(c.id, u);
  const ahora = comercialDeps.ahora();
  const { encoladas } = await prisma.$transaction((tx) => encolarInvitaciones(tx, { complejoId: c.id, estructuraId: body.estructura_id ?? null, porUsuarioId: u.id, ahora }), { maxWait: 10_000, timeout: 60_000 });
  res.locals.entidad = 'complejo';
  res.locals.entidadId = c.id;
  res.locals.accion = 'encolar_invitaciones';
  res.locals.auditDetalle = { encoladas, ...(body.estructura_id != null ? { estructura_id: body.estructura_id } : {}) };
  res.status(201).json({ encoladas, ...(await estadoDeLaCola(c.id, ahora)) });
});
