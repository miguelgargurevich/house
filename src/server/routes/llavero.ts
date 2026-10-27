import { Router, type RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import { forbidden } from '../errors';
import { llaveroConfigurado } from '../lib/secretBox';
import { listarGateways, verOcr } from '../lib/gatewaysDatos';
import { agregarDominio, ajustarGateway, ajustarOcr, borrarGateway, crearGateway, guardarOcr, listarDominios, quitarDominio, quitarOcr } from '../lib/gatewaysAdmin';
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
const modeloOpcional = z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).regex(/^[\w.:/-]+$/, 'Modelo inválido').nullish());
const gatewaySchema = z.object({
  nombre: texto(60),
  base_url: z.string({ error: 'Debe ser un texto' }).trim().min(1, 'Es obligatorio').max(300, 'Máximo 300 caracteres'),
  modelo_por_defecto: modeloOpcional,
  modelo_vision: modeloOpcional,
  vision: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
  prioridad: z.number({ error: 'Debe ser un número' }).int().min(1, 'Entre 1 y 99').max(99, 'Entre 1 y 99').optional(),
});
const gatewayAjusteSchema = gatewaySchema.partial().extend({ habilitado: z.boolean({ error: 'Debe ser verdadero o falso' }).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Indica al menos un campo');
const dominioSchema = z.object({ dominio: z.string({ error: 'Debe ser un texto' }).trim().min(1, 'Es obligatorio').max(253, 'Máximo 253 caracteres') });
const ocrSchema = z.object({
  modo: z.enum(['interno', 'publico'], { error: 'Elige interno o público' }),
  base_url: z.string().trim().max(300).nullish(),
  clave: z.preprocess((v) => (v === '' ? null : v), z.string().nullish()),
  habilitado: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
});
const guardarSchema = z.object({
  gateway_id: z.number({ error: 'Debe ser un número' }).int().positive().optional(),
  clave: z.string({ error: 'Debe ser un texto' }),
  etiqueta: texto(40).regex(/^[a-z0-9-]+$/i, 'Solo letras, números y guiones').transform((v) => v.toLowerCase()).optional(),
  modelo: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).regex(/^[\w.:/-]+$/, 'Modelo inválido').nullish()),
});
const ajusteSchema = z
  .object({
    habilitada: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
    reserva: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
    modelo: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).regex(/^[\w.:/-]+$/, 'Modelo inválido').nullable().optional()),
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
      gateways: await listarGateways(),
      dominios_permitidos: (await listarDominios()).map((d) => ({ id: d.id, dominio: d.dominio, creado: d.created_at.toISOString() })),
      ocr: await verOcr(),
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

  const auditar = (res: Parameters<RequestHandler>[1], accion: string, f: { id: number; proveedor: string; etiqueta: string }, extra: Record<string, string | number | boolean | null> = {}) => {
    res.locals.entidad = 'clave-ia';
    res.locals.accion = accion;
    res.locals.entidadId = f.id;
    res.locals.auditDetalle = { proveedor: f.proveedor, etiqueta: f.etiqueta, ...extra }; // jamás la clave
  };

  // ----- Gateways propios, dominios permitidos y OCR (antes de `/:proveedor` y `/:id`, que los taparían) -----
  const auditarEntidad = (res: Parameters<RequestHandler>[1], entidad: string, accion: string, id: number | null, detalle: Record<string, string | number | boolean | null>) => {
    res.locals.entidad = entidad;
    res.locals.accion = accion;
    res.locals.entidadId = id;
    res.locals.auditDetalle = detalle; // jamás una clave
  };

  router.post('/gateways', async (req, res) => {
    const b = parseBody(gatewaySchema, req);
    const g = await crearGateway(b, currentUser(req).id);
    auditarEntidad(res, 'gateway-ia', 'crear', g.id, { nombre: g.nombre, base_url: g.base_url, vision: g.vision });
    res.status(201).json((await listarGateways()).find((x) => x.id === g.id));
  });

  router.patch('/gateways/:id', async (req, res) => {
    const b = parseBody(gatewayAjusteSchema, req);
    const id = parseId(req);
    const { fila, urlCambia } = await ajustarGateway(id, b);
    auditarEntidad(res, 'gateway-ia', 'editar', fila.id, { nombre: fila.nombre, base_url: fila.base_url, habilitado: fila.habilitado, url_cambia: urlCambia });
    res.json((await listarGateways()).find((x) => x.id === fila.id));
  });

  router.delete('/gateways/:id', async (req, res) => {
    const { fila, clavesBorradas } = await borrarGateway(parseId(req));
    auditarEntidad(res, 'gateway-ia', 'eliminar', fila.id, { nombre: fila.nombre, base_url: fila.base_url, claves_borradas: clavesBorradas });
    res.status(204).end();
  });

  router.post('/dominios', async (req, res) => {
    const b = parseBody(dominioSchema, req);
    const d = await agregarDominio(b.dominio, currentUser(req).id);
    auditarEntidad(res, 'dominio-gateway', 'crear', d.id, { dominio: d.dominio });
    res.status(201).json({ id: d.id, dominio: d.dominio, creado: d.created_at.toISOString() });
  });

  router.delete('/dominios/:id', async (req, res) => {
    const d = await quitarDominio(parseId(req));
    auditarEntidad(res, 'dominio-gateway', 'eliminar', d.id, { dominio: d.dominio });
    res.status(204).end();
  });

  router.put('/ocr', async (req, res) => {
    const b = parseBody(ocrSchema, req);
    const f = await guardarOcr(b, currentUser(req).id);
    auditarEntidad(res, 'ocr-config', 'editar', f.id, { modo: f.modo, destino_interno: f.destino_interno, base_url: f.base_url, clave_cambiada: !!b.clave, ultimos4: f.ultimos4 });
    res.json(await verOcr());
  });

  router.patch('/ocr', async (req, res) => {
    const b = parseBody(z.object({ habilitado: z.boolean({ error: 'Debe ser verdadero o falso' }) }), req);
    const f = await ajustarOcr(b.habilitado, currentUser(req).id);
    auditarEntidad(res, 'ocr-config', 'editar', f.id, { habilitado: f.habilitado });
    res.json(await verOcr());
  });

  router.delete('/ocr', async (req, res) => {
    const f = await quitarOcr(currentUser(req).id);
    auditarEntidad(res, 'ocr-config', 'eliminar', f.id, { modo: f.modo, destino_interno: f.destino_interno, base_url: f.base_url });
    res.status(204).end();
  });

  router.put('/:proveedor', async (req, res) => {
    const { proveedor } = parse(proveedorParams, req.params);
    const body = parseBody(guardarSchema, req);
    const { fila, creada } = await servicio.guardar({ proveedor, gatewayId: body.gateway_id, etiqueta: body.etiqueta, clave: body.clave, modelo: body.modelo, usuarioId: currentUser(req).id });
    auditar(res, creada ? 'crear' : 'editar', fila, { modelo: fila.modelo, ultimos4: fila.ultimos4, gateway_id: fila.gateway_id });
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
