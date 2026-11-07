import { Router, type RequestHandler } from 'express';
import { CODIGOS_PAIS } from '../../lib/paises';
import { ipDe } from '../middleware/audit';
import { MENSAJE_REGISTRO, registrarCuenta, reenviarVerificacion, verificarCorreo } from '../services/comercial/registro';
import { catalogoPublico, cotizacionPublica } from '../services/comercial/suscripciones';
import { obtenerConfiguracion } from '../services/comercial/configuracion';
import { datosLegales } from '../services/comercial/legal';
import { llenoElSenuelo } from '../lib/textoPublico';
import type { LimitadoresFormularios } from '../lib/limitesPublicos';
import { MENSAJE_CONTACTO, contactoSchema, registrarContacto } from '../services/contacto/solicitud';
import { reclamacionSchema } from '../services/reclamaciones/esquema';
import { registrarReclamacion } from '../services/reclamaciones/registro';
import { contrasenaIgualACorreo, emailSchema, MENSAJE_PASSWORD_CORREO, parse, parseBody, passwordSchema, telefonoObligatorio, texto, z } from '../validation';

export interface LimitadoresPublicos extends LimitadoresFormularios { registroIp: RequestHandler; registroCorreo: RequestHandler; verificacion: RequestHandler }

/** Paso 1 de 2: sólo la cuenta. Los datos del condominio (`empresa`, `condominio`, `unidades`) ya no se piden aquí: si llegan (una pantalla vieja en caché) se IGNORAN, no se rechazan, y no se crea condominio. Se piden en el paso 2 (`POST /api/comercial/primer-condominio`). */
const registroSchema = z.object({
  nombre: texto(120),
  email: emailSchema,
  celular: telefonoObligatorio,
  password: passwordSchema,
  /** Ley 29733: el consentimiento a los Términos y la Política es obligatorio. La versión la graba el servidor (`VERSION_LEGAL`). */
  acepta_terminos: z.literal(true, { error: 'Debes aceptar los términos y la política de privacidad' }),
  /** Señuelo antiabuso: un campo que ninguna persona ve ni llena. Si llega con algo, se responde igual y no se crea nada. */
  sitio_web: z.string().max(200).optional(),
}).superRefine((d, ctx) => {
  if (contrasenaIgualACorreo(d.password, d.email)) ctx.addIssue({ code: 'custom', path: ['password'], message: MENSAJE_PASSWORD_CORREO });
});

/** País para cobrar (ISO 3166-1 alfa-2, mayúsculas o minúsculas); sin él, Perú. Un código que no es de un país del catálogo → 422. */
const paisQuery = z.string().transform((v) => v.trim().toUpperCase()).pipe(z.enum(CODIGOS_PAIS, { error: 'País inválido' })).optional();
const planesSchema = z.object({ pais: paisQuery });
const cotizarSchema = z.object({
  unidades: z.coerce.number().int().min(1).max(100_000).default(100),
  plan: z.string().max(40).optional(),
  pais: paisQuery,
});

/** Tramo SIN sesión: planes y precios, registro y verificación del correo. Nunca devuelve datos de pago, correos ni cuentas. */
export function publicoRouter(l: LimitadoresPublicos) {
  const r = Router();

  /** @openapi
   * /api/publico/planes:
   *   get: { summary: "Planes y módulos con su precio por departamento al mes (sin impuesto, en la moneda del país de `?pais=`; Perú por defecto) y los topes de unidades", tags: [Público], responses: { 200: { description: "{ pais, moneda, impuesto, paises, igv_incluido, planes, modulos, registro_abierto }; un plan sin precio en esa moneda trae `precio_por_unidad: null` y `consultar: true`" } } } */
  r.get('/planes', async (req, res) => {
    const q = parse(planesSchema, req.query);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await catalogoPublico(q.pais));
  });

  /** @openapi
   * /api/publico/legal:
   *   get: { summary: "Datos del responsable y versión de los Términos y la Política de privacidad (Ley 29733). Sólo estos campos; nada más de la configuración", tags: [Público], responses: { 200: { description: "{ razon_social, ruc, domicilio, correo, version }; un dato sin cargar es null (la página dice «por confirmar»)" } } } */
  r.get('/legal', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(datosLegales(await obtenerConfiguracion()));
  });

  /** @openapi
   * /api/publico/cotizar:
   *   get: { summary: "Total al mes y al año (sin impuesto; aparte el impuesto y el total con impuesto del mes) para N departamentos y un plan, en la moneda del país de `?pais=` (Perú por defecto); Torre Pro y Torre Administradora cobran un mínimo de unidades. Ya no hay módulos sueltos", tags: [Público], responses: { 200: { description: "{ pais, moneda, impuesto_nombre, consultar, unidades, unidades_cobradas, minimo_aplicado, total_mes, total_anio, igv_mes, total_con_igv_mes }; sin precio del plan en esa moneda los totales son null y `consultar` true" } } } */
  r.get('/cotizar', async (req, res) => {
    const q = parse(cotizarSchema, req.query);
    res.json(await cotizacionPublica(q.unidades, q.plan ?? null, q.pais));
  });

  /** @openapi
   * /api/publico/registro:
   *   post: { summary: "Paso 1 de 2: crea la cuenta (empresa con nombre provisional + administrador, sin condominio ni suscripción); exige verificar el correo y aceptar los Términos (`acepta_terminos: true`). El condominio se crea después con POST /api/comercial/primer-condominio; si el body trae `empresa`, `condominio` o `unidades` se ignoran", tags: [Público], responses: { 202: { description: "Misma respuesta exista o no el correo" }, 422: { description: "Campos inválidos (también si no se aceptan los términos)" }, 429: { description: "Demasiados intentos" } } } */
  r.post('/registro', l.registroIp, l.registroCorreo, async (req, res) => {
    const d = parseBody(registroSchema, req);
    // Señuelo lleno = robot: mismo 202, sin crear nada.
    if (!d.sitio_web?.trim()) await registrarCuenta(d, ipDe(req));
    res.status(202).json({ mensaje: MENSAJE_REGISTRO });
  });

  /** @openapi
   * /api/publico/verificar-correo:
   *   post: { summary: "Confirma el correo con el token del enlace (un solo uso, 24 h)", tags: [Público], responses: { 200: { description: "{ ok: true }" }, 400: { description: "Enlace inválido o vencido" } } } */
  r.post('/verificar-correo', l.verificacion, async (req, res) => {
    const { token } = parseBody(z.object({ token: z.string().min(20).max(200) }), req);
    await verificarCorreo(token, ipDe(req));
    res.json({ ok: true });
  });

  /** @openapi
   * /api/publico/reenviar-verificacion:
   *   post: { summary: "Pide otro enlace de verificación (misma respuesta exista o no la cuenta)", tags: [Público], responses: { 202: { description: "Aceptado" } } } */
  r.post('/reenviar-verificacion', l.registroIp, l.registroCorreo, async (req, res) => {
    const { email } = parseBody(z.object({ email: emailSchema }), req);
    await reenviarVerificacion(email);
    res.status(202).json({ mensaje: MENSAJE_REGISTRO });
  });

  /** @openapi
   * /api/publico/contacto:
   *   post: { summary: "Formulario /contacto (sin sesión): guarda el mensaje (tabla SolicitudContacto) y avisa a Torre por correo. Campo trampa `sitio_web`: si llega lleno responde igual y no guarda ni envía. Tope por IP", tags: [Público], responses: { 200: { description: "{ ok: true, mensaje }" }, 422: { description: "Campos inválidos (sin correo o mensaje, texto demasiado largo, etiquetas HTML)" }, 429: { description: "Demasiados mensajes desde esta conexión" } } } */
  r.post('/contacto', l.contactoIp, async (req, res) => {
    // Señuelo lleno = robot: misma respuesta que un envío bueno (nada que le diga que fue detectado), sin guardar ni enviar.
    if (!llenoElSenuelo(req.body)) {
      const d = parseBody(contactoSchema, req);
      await registrarContacto(d, { ip: ipDe(req), user_agent: req.get('user-agent') ?? null });
    }
    res.json({ ok: true, mensaje: MENSAJE_CONTACTO });
  });

  /** @openapi
   * /api/publico/reclamaciones:
   *   post: { summary: "Libro de Reclamaciones virtual (Ley 29571): registra la hoja con número correlativo por año (2026-000001) y plazo de respuesta de 15 días hábiles (sábados y domingos no cuentan; feriados sí). Manda copia al consumidor y avisa a Torre. Topes por IP y por correo", tags: [Público], responses: { 201: { description: "La constancia: { correlativo, fecha, fecha_limite, plazo_dias_habiles, tipo, proveedor, consumidor, bien, detalle, pedido, mensaje }" }, 200: { description: "Sólo si el campo trampa `sitio_web` vino lleno: { ok: true } y no se registra nada" }, 422: { description: "Campos inválidos" }, 429: { description: "Demasiados intentos" }, 503: { description: "Faltan los datos legales del proveedor" } } } */
  r.post('/reclamaciones', l.reclamoIp, l.reclamoCorreo, async (req, res) => {
    if (llenoElSenuelo(req.body)) { res.json({ ok: true }); return; }
    const d = parseBody(reclamacionSchema, req);
    res.status(201).json(await registrarReclamacion(d, { ip: ipDe(req), user_agent: req.get('user-agent') ?? null }));
  });

  return r;
}
