import { Router, type RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import { forbidden } from '../errors';
import { llaveroConfigurado } from '../lib/secretBox';
import * as servicio from '../services/llavero';
import { ETIQUETA_CATEGORIA, nombreModelo, type Categoria } from '../lib/modelosIA';
import { modelosElegibles } from '../services/modelos/seleccion';
import { sincronizarClave, sincronizarEnSegundoPlano } from '../services/modelos/sync';
import { probar } from '../services/asistente/prueba';
import { datosExtraLlavero } from '../services/asistente/vistaLlavero';
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
const ajusteSchema = z
  .object({
    habilitada: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
    reserva: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
    modelo: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).regex(/^[\w.:/\-]+$/, 'Modelo inválido').nullable().optional()),
  })
  .refine((v) => v.habilitada !== undefined || v.reserva !== undefined || v.modelo !== undefined, 'Indica habilitada, reserva o modelo');

/** Se monta DESPUÉS de `authenticate`. Todo es exclusivo del superadmin; la clave nunca sale en una respuesta. */
export function llaveroRouter(limitador: RequestHandler) {
  const router = Router();
  router.use(soloSuperadmin);

  router.get('/', async (_req, res) => {
    const base = await servicio.listarConRotacion();
    const extra = await datosExtraLlavero(base.claves);
    res.json({
      configurado: llaveroConfigurado(),
      ...base,
      claves: base.claves.map((c) => ({ ...c, ...extra.porClave.get(c.id) })),
      proveedores: servicio.catalogoPublico(),
      salud: extra.salud,
      cambios_recientes: extra.cambios_recientes,
      consultas_recientes: extra.consultas_recientes,
    });
  });

  // Modelos elegibles de UNA clave (para «Cambiar modelo»): aparte de la lista general porque OpenRouter trae cientos.
  router.get('/:id/modelos', async (req, res) => {
    const clave = await servicio.obtenerPublica(parseId(req));
    const filas = await modelosElegibles(clave.id);
    res.json(filas.map((m) => ({ id: m.modelo_id, nombre: nombreModelo(m), categoria: m.categoria as Categoria, categoria_nombre: ETIQUETA_CATEGORIA[m.categoria as Categoria] ?? m.categoria, gratis: m.gratis })));
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
    sincronizarEnSegundoPlano(fila.id); // sólo con MODELOS_SYNC activo: descubre los modelos de la clave nueva
    res.status(creada ? 201 : 200).json(fila);
  });

  router.post('/:id/probar', async (req, res) => {
    const fila = await probar(parseId(req));
    auditar(res, 'editar', fila, { accion: 'probar', estado: fila.estado });
    res.json(fila);
  });

  router.post('/:id/sincronizar', async (req, res) => {
    const f = await servicio.obtenerPublica(parseId(req));
    const r = await sincronizarClave(f.id);
    auditar(res, 'editar', f, { accion: 'sincronizar', ok: r?.ok ?? false });
    res.json({ ok: r?.ok ?? false, nuevos: r?.nuevos ?? 0, deprecados: r?.deprecados ?? 0, revividos: r?.revividos ?? 0, total: r?.total ?? 0, error: r?.error ?? null, aviso_modelo: r?.avisoModelo ?? null });
  });

  router.patch('/:id', async (req, res) => {
    const a = parseBody(ajusteSchema, req);
    const fila = await servicio.ajustar(parseId(req), a, currentUser(req).id);
    auditar(res, 'editar', fila, { ...(a.habilitada !== undefined ? { habilitada: a.habilitada } : {}), ...(a.reserva !== undefined ? { reserva: a.reserva } : {}), ...(a.modelo !== undefined ? { modelo: a.modelo } : {}) });
    if (a.habilitada === true) sincronizarEnSegundoPlano(fila.id);
    res.json(fila);
  });

  router.delete('/:id', async (req, res) => {
    const fila = await servicio.borrar(parseId(req));
    auditar(res, 'eliminar', fila);
    res.status(204).end();
  });

  return router;
}
