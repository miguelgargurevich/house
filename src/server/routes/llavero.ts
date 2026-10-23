import { Router, type RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import { forbidden } from '../errors';
import { llaveroConfigurado } from '../lib/secretBox';
import * as servicio from '../services/llavero';
import { parseBody, parseId, parse, texto, z } from '../validation';

const soloSuperadmin: RequestHandler = (req, _res, next) => {
  if (currentUser(req).rol !== 'superadmin') throw forbidden();
  next();
};

const proveedorParams = z.object({ proveedor: z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9-]+$/, 'Proveedor inválido') });
const guardarSchema = z.object({
  clave: z.string({ error: 'Debe ser un texto' }),
  etiqueta: texto(40).regex(/^[a-z0-9-]+$/i, 'Solo letras, números y guiones').transform((v) => v.toLowerCase()).optional(),
  modelo: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).regex(/^[\w.:/\-]+$/, 'Modelo inválido').nullish()),
});
const habilitarSchema = z.object({ habilitada: z.boolean({ error: 'Debe ser verdadero o falso' }) });

/** Se monta DESPUÉS de `authenticate`. Todo es exclusivo del superadmin; la clave nunca sale en una respuesta. */
export function llaveroRouter(limitador: RequestHandler) {
  const router = Router();
  router.use(soloSuperadmin);

  router.get('/', async (_req, res) => {
    res.json({ configurado: llaveroConfigurado(), claves: await servicio.listar(), proveedores: servicio.catalogoPublico() });
  });

  // Límite sólo en escrituras y pruebas.
  router.use((req, res, next) => (req.method === 'GET' ? next() : limitador(req, res, next)));

  const auditar = (res: Parameters<RequestHandler>[1], accion: string, f: { id: number; proveedor: string; etiqueta: string }, extra: Record<string, string | boolean | null> = {}) => {
    res.locals.entidad = 'clave-ia';
    res.locals.accion = accion;
    res.locals.entidadId = f.id;
    res.locals.auditDetalle = { proveedor: f.proveedor, etiqueta: f.etiqueta, ...extra }; // jamás la clave
  };

  router.put('/:proveedor', async (req, res) => {
    const { proveedor } = parse(proveedorParams, req.params);
    const body = parseBody(guardarSchema, req);
    const { fila, creada } = await servicio.guardar({ proveedor, etiqueta: body.etiqueta, clave: body.clave, modelo: body.modelo, usuarioId: currentUser(req).id });
    auditar(res, creada ? 'crear' : 'editar', fila, { modelo: fila.modelo, ultimos4: fila.ultimos4 });
    res.status(creada ? 201 : 200).json(fila);
  });

  router.post('/:id/probar', async (req, res) => {
    const fila = await servicio.probar(parseId(req));
    auditar(res, 'editar', fila, { accion: 'probar', estado: fila.estado });
    res.json(fila);
  });

  router.patch('/:id', async (req, res) => {
    const { habilitada } = parseBody(habilitarSchema, req);
    const fila = await servicio.pausar(parseId(req), habilitada, currentUser(req).id);
    auditar(res, 'editar', fila, { habilitada });
    res.json(fila);
  });

  router.delete('/:id', async (req, res) => {
    const fila = await servicio.borrar(parseId(req));
    auditar(res, 'eliminar', fila);
    res.status(204).end();
  });

  return router;
}
