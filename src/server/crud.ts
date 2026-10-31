import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Rol } from './config';
import { currentUser, requireRole, type AuthUser } from './middleware/auth';
import { forbidden, invalid, notFound } from './errors';
import { listQuerySchema, parse, parseBody, parseId, parseOrden, z } from './validation';

type Where = Record<string, unknown>;
type Id = number;

export interface CrudOptions {
  /** Nombre de la entidad en la auditoría. */
  entidad: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any;
  readRoles: Rol[];
  /** Acceso de lectura adicional a usuarios que no tienen un rol de `readRoles` (p. ej. la junta); su `scope` debe acotarlos. */
  readAlso?: (user: AuthUser) => boolean;
  writeRoles: Rol[];
  /** Sólo monta los GET. */
  readOnly?: boolean;
  /** Roles que pueden crear; por defecto `writeRoles`. */
  createRoles?: Rol[];
  deleteRoles?: Rol[];
  scope: (user: AuthUser) => Where;
  /** Alcance para modificar y borrar (por omisión, `scope`): permite que un recurso sea visible pero de sólo consulta (recibos de la administradora anterior). */
  writeScope?: (user: AuthUser) => Where;
  search?: string[];
  orderable: string[];
  defaultOrder: Record<string, 'asc' | 'desc'>;
  include?: Record<string, unknown>;
  omit?: Record<string, boolean>;
  /** Filtros extra de la query: esquema zod + cómo convertirlos en `where`. */
  filtros?: { schema: z.ZodObject; where: (f: Record<string, unknown>, user: AuthUser) => Where | Promise<Where> };
  createSchema?: z.ZodType;
  updateSchema?: z.ZodType;
  /** Valida referencias/tenant y completa campos. Lanza HttpError si algo no corresponde. */
  prepareCreate?: (data: Record<string, unknown>, user: AuthUser) => Promise<Record<string, unknown>> | Record<string, unknown>;
  prepareUpdate?: (data: Record<string, unknown>, user: AuthUser, existing: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  beforeDelete?: (existing: Record<string, unknown>, user: AuthUser) => Promise<void> | void;
  /** Tras crear (y ya guardado): efectos de afuera, como mandar un correo. `data` es lo que se guardó; lo que devuelva se suma a la respuesta 201. */
  afterCreate?: (created: Record<string, unknown>, data: Record<string, unknown>, user: AuthUser) => Promise<Record<string, unknown> | void>;
  afterUpdate?: (existing: Record<string, unknown>, data: Record<string, unknown>) => Promise<void> | void;
  afterDelete?: (existing: Record<string, unknown>) => Promise<void> | void;
  /** Enriquece/transforma filas ya consultadas (lote, para poder agregar con una sola consulta). */
  format?: (items: any[], user: AuthUser) => Promise<any[]> | any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /**
   * Puerta de solo lectura: se llama antes de crear (con los datos ya preparados), editar o borrar (con la fila existente) y debe lanzar 409 si el condominio
   * de esa fila terminó su periodo gratis (`exigirOperativo`). Lo que sólo lee no pasa por aquí.
   */
  operativo?: (row: Record<string, unknown>, user: AuthUser) => Promise<void>;
  /** Reemplaza el create estándar (p. ej. recibos, que generan cargos). Debe devolver la fila creada. */
  create?: (data: Record<string, unknown>, user: AuthUser) => Promise<Record<string, unknown>>;
  /** Reemplaza el update estándar (p. ej. reasignar el departamento de un residente). Debe devolver la fila actualizada. */
  update?: (data: Record<string, unknown>, existing: Record<string, unknown>, user: AuthUser) => Promise<Record<string, unknown>>;
}

/** 'campo' o 'relacion.campo' (anidado) → filtro `contains` sin distinguir mayúsculas. */
const buscar = (ruta: string, q: string): Where =>
  ruta.split('.').reduceRight<Where | string>((acc, parte) => (typeof acc === 'string' ? { [parte]: { contains: acc, mode: 'insensitive' } } : { [parte]: acc }), q) as Where;

const queryArgs = (o: CrudOptions) => ({ ...(o.include ? { include: o.include } : {}), ...(o.omit ? { omit: o.omit } : {}) });

export function crudRouter(o: CrudOptions): Router {
  const router = Router();
  const lectura: RequestHandler = (req, _res, next) => {
    const user = currentUser(req);
    if (user.rol === 'superadmin' || o.readRoles.includes(user.rol) || o.readAlso?.(user)) return next();
    throw forbidden();
  };
  router.use((_req, res, next) => {
    res.locals.entidad = o.entidad;
    next();
  });
  const fmt = async (items: unknown[], user: AuthUser) => (o.format ? o.format(items, user) : items);
  const querySchema = o.filtros ? listQuerySchema.extend(o.filtros.schema.shape) : listQuerySchema;

  router.get('/', lectura, async (req, res) => {
    const user = currentUser(req);
    const query = parse(querySchema, req.query) as z.infer<typeof listQuerySchema> & Record<string, unknown>;
    const and: Where[] = [o.scope(user)];
    if (query.q && o.search?.length) {
      and.push({ OR: o.search.map((f) => buscar(f, query.q as string)) });
    }
    if (o.filtros) and.push(await o.filtros.where(query, user));
    const where = { AND: and };
    const orderBy = parseOrden(query.orden, o.orderable, o.defaultOrder);
    const [total, rows] = await Promise.all([
      o.delegate.count({ where }),
      o.delegate.findMany({ where, orderBy: [orderBy, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, ...queryArgs(o) }),
    ]);
    res.json({ items: await fmt(rows, user), total, page: query.page, pageSize: query.pageSize });
  });

  router.get('/:id', lectura, async (req, res) => {
    const user = currentUser(req);
    const id: Id = parseId(req);
    const row = await o.delegate.findFirst({ where: { AND: [{ id }, o.scope(user)] }, ...queryArgs(o) });
    if (!row) throw notFound();
    res.json((await fmt([row], user))[0]);
  });

  if (o.readOnly || !o.createSchema || !o.updateSchema) return router;
  const { createSchema, updateSchema } = o;

  router.post('/', requireRole(...(o.createRoles ?? o.writeRoles)), async (req, res) => {
    const user = currentUser(req);
    let data = parseBody(createSchema, req) as Record<string, unknown>;
    if (o.prepareCreate) data = await o.prepareCreate(data, user);
    await o.operativo?.(data, user);
    const created = o.create
      ? await o.create(data, user)
      : await o.delegate.create({ data, ...queryArgs(o) });
    res.locals.entidadId = created.id;
    const row = o.create ? await o.delegate.findFirst({ where: { id: created.id }, ...queryArgs(o) }) : created;
    const extra = o.afterCreate ? await o.afterCreate(created, data, user) : undefined;
    res.status(201).json({ ...(await fmt([row], user))[0], ...extra });
  });

  const update = async (req: Request, res: Response) => {
    const user = currentUser(req);
    const id: Id = parseId(req);
    const existing = await o.delegate.findFirst({ where: { AND: [{ id }, (o.writeScope ?? o.scope)(user)] } });
    if (!existing) throw notFound();
    let data = parseBody(updateSchema, req) as Record<string, unknown>;
    if (o.prepareUpdate) data = await o.prepareUpdate(data, user, existing);
    await o.operativo?.(existing, user);
    const updated = o.update
      ? await o.update(data, existing, user)
      : await o.delegate.update({ where: { id }, data, ...queryArgs(o) });
    const row = o.update ? await o.delegate.findFirst({ where: { id: updated.id }, ...queryArgs(o) }) : updated;
    if (o.afterUpdate) await o.afterUpdate(existing, data);
    res.locals.entidadId = id;
    res.json((await fmt([row], user))[0]);
  };
  router.put('/:id', requireRole(...o.writeRoles), update);
  router.patch('/:id', requireRole(...o.writeRoles), update);

  router.delete('/:id', requireRole(...(o.deleteRoles ?? o.writeRoles)), async (req, res) => {
    const user = currentUser(req);
    const id: Id = parseId(req);
    const existing = await o.delegate.findFirst({ where: { AND: [{ id }, (o.writeScope ?? o.scope)(user)] } });
    if (!existing) throw notFound();
    await o.operativo?.(existing, user);
    if (o.beforeDelete) await o.beforeDelete(existing, user);
    await o.delegate.delete({ where: { id } });
    if (o.afterDelete) await o.afterDelete(existing);
    res.locals.entidadId = id;
    res.status(204).end();
  });

  return router;
}

/** Comprueba que una referencia existe dentro del alcance del usuario; mismo error si no existe o es de otra empresa. */
export async function assertRef(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delegate: any,
  id: number | null | undefined,
  scope: Where,
  campo: string,
  extra: Where = {},
): Promise<Record<string, any> | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (id == null) return null;
  const row = await delegate.findFirst({ where: { AND: [{ id }, scope, extra] } });
  if (!row) throw invalidRef(campo);
  return row;
}

export const invalidRef = (campo: string) => invalid(`Datos inválidos: ${campo}: no existe o no tienes acceso`, { [campo]: 'No existe o no tienes acceso' });
