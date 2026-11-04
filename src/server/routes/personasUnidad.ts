/**
 * Personas de un departamento y quién tiene acceso a Torre. Sólo la administración (admin de la empresa del condominio y superadmin): la junta, el personal y los
 * residentes → 403; la unidad de otra empresa → 404. Ver `services/personas/*` y docs/API-CONTRATO.md.
 *
 *   GET    /api/unidades/:id/personas                  lista
 *   POST   /api/unidades/:id/personas                  agrega
 *   PUT    /api/unidades/:id/personas/:pid             edita (incluye «responsable de pago» y «recibe comunicados»)
 *   DELETE /api/unidades/:id/personas/:pid             quita (409 si es el responsable de pago o el titular)
 *   PUT    /api/unidades/:id/personas/:pid/acceso      { activo } enciende (crea la cuenta e invita) o apaga el acceso
 *   PUT    /api/unidades/:id/personas/:pid/titular     «Hacer titular»
 *
 * La auditoría lleva ids y cantidades; nunca nombres, correos ni celulares.
 */
import { Router } from 'express';
import { prisma } from '../db';
import { notFound } from '../errors';
import { scopeUnidades } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { normalizarCelular } from '../services/avisos/celular';
import { exigirOperativo } from '../services/comercial/operativo';
import { agregarPersona, apagarAcceso, editarPersona, encenderAcceso, hacerPrincipal, listarPersonas, quitarPersona } from '../services/personas/servicio';
import { RELACIONES } from '../services/personas/tipos';
import { emailSchema, idSchema, parseBody, parse, z } from '../validation';

export const personasUnidadRouter = Router({ mergeParams: true });
personasUnidadRouter.use(requireRole('admin'));
personasUnidadRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.locals.entidad = 'persona_unidad';
  next();
});

const params = z.object({ id: idSchema, pid: idSchema.optional() });
const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const correo = z.preprocess(vacioANull, emailSchema.nullish());
const celular = z.preprocess(vacioANull, z.string({ error: 'Debe ser un texto' }).trim().max(30, 'Celular inválido').refine((v) => normalizarCelular(v) !== null, 'El celular no es válido (con 9 dígitos, o con el código de país: +51 987 654 321)').nullish());
const nombre = z.string({ error: 'Debe ser un texto' }).trim().min(1, 'Es obligatorio').max(120, 'Máximo 120 caracteres');
const relacion = z.enum(RELACIONES, { error: `La relación debe ser: ${RELACIONES.join(', ')}` });

const crearSchema = z.strictObject({ nombre, relacion, correo, celular, responsable_pago: z.boolean().optional(), recibe_comunicados: z.boolean().optional() });
const editarSchema = z.strictObject({ nombre: nombre.optional(), relacion: relacion.optional(), correo, celular, responsable_pago: z.boolean().optional(), recibe_comunicados: z.boolean().optional() });
const accesoSchema = z.strictObject({ activo: z.boolean({ error: 'activo debe ser true o false' }) });

/** La unidad, sólo si es de la empresa de quien llama (superadmin: cualquiera). Otra empresa → 404, nunca 403. */
async function unidadPropia(req: Parameters<typeof currentUser>[0]) {
  const u = currentUser(req);
  const { id, pid } = parse(params, req.params);
  const unidad = await prisma.unidad.findFirst({ where: { AND: [{ id }, scopeUnidades(u)] }, select: { id: true, complejo_id: true } });
  if (!unidad || unidad.complejo_id == null) throw notFound('Unidad');
  return { u, unidad, pid };
}
const personaId = (pid: number | undefined) => { if (pid == null) throw notFound('Persona'); return pid; };

personasUnidadRouter.get('/', async (req, res) => {
  const { unidad } = await unidadPropia(req);
  res.json({ items: await listarPersonas(unidad.id) });
});

personasUnidadRouter.post('/', async (req, res) => {
  const { u, unidad } = await unidadPropia(req);
  const d = parseBody(crearSchema, req);
  await exigirOperativo(unidad.complejo_id, u);
  const r = await agregarPersona(unidad.id, d);
  res.locals.entidadId = r.persona.id;
  res.locals.auditDetalle = { unidad_id: unidad.id, persona_id: r.persona.id, relacion: d.relacion, responsable_pago: r.persona.responsable_pago, recibe_comunicados: r.persona.recibe_comunicados, con_correo: !!d.correo, con_celular: !!d.celular };
  res.status(201).json(r.persona);
});

personasUnidadRouter.put('/:pid', async (req, res) => {
  const { u, unidad, pid } = await unidadPropia(req);
  const d = parseBody(editarSchema, req);
  await exigirOperativo(unidad.complejo_id, u);
  const r = await editarPersona(unidad.id, personaId(pid), d);
  res.locals.entidadId = r.persona.id;
  res.locals.auditDetalle = { unidad_id: unidad.id, persona_id: r.persona.id, campos: Object.keys(d), responsable_pago: r.persona.responsable_pago, recibe_comunicados: r.persona.recibe_comunicados };
  res.json(r.persona);
});

personasUnidadRouter.delete('/:pid', async (req, res) => {
  const { u, unidad, pid } = await unidadPropia(req);
  await exigirOperativo(unidad.complejo_id, u);
  const r = await quitarPersona(unidad.id, personaId(pid));
  res.locals.entidadId = personaId(pid);
  res.locals.auditDetalle = { unidad_id: unidad.id, persona_id: personaId(pid), accesos_cerrados: r.sinAcceso.length };
  res.status(204).end();
});

personasUnidadRouter.put('/:pid/acceso', async (req, res) => {
  const { u, unidad, pid } = await unidadPropia(req);
  const { activo } = parseBody(accesoSchema, req);
  await exigirOperativo(unidad.complejo_id, u);
  const r = activo ? await encenderAcceso(unidad.id, personaId(pid), u.id) : await apagarAcceso(unidad.id, personaId(pid));
  res.locals.entidadId = r.persona.id;
  res.locals.accion = activo ? 'encender_acceso' : 'apagar_acceso';
  res.locals.auditDetalle = { unidad_id: unidad.id, persona_id: r.persona.id, activo, invitaciones_en_cola: r.efecto.invitacionesEncoladas, accesos_cerrados: r.efecto.sinAcceso.length };
  res.json(r.persona);
});

personasUnidadRouter.put('/:pid/titular', async (req, res) => {
  const { u, unidad, pid } = await unidadPropia(req);
  await exigirOperativo(unidad.complejo_id, u);
  const persona = await hacerPrincipal(unidad.id, personaId(pid));
  res.locals.entidadId = persona.id;
  res.locals.accion = 'hacer_titular';
  res.locals.auditDetalle = { unidad_id: unidad.id, persona_id: persona.id, relacion: persona.relacion };
  res.json(persona);
});
