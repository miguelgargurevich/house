import { Router, type RequestHandler } from 'express';
import { CODIGOS_PAIS } from '../../lib/paises';
import { ipDe } from '../middleware/audit';
import { MENSAJE_REGISTRO, registrarCuenta, reenviarVerificacion, verificarCorreo } from '../services/comercial/registro';
import { catalogoPublico, cotizacionPublica } from '../services/comercial/suscripciones';
import { obtenerConfiguracion } from '../services/comercial/configuracion';
import { datosLegales } from '../services/comercial/legal';
import { contrasenaIgualACorreo, emailSchema, MENSAJE_PASSWORD_CORREO, parse, parseBody, passwordSchema, telefonoObligatorio, texto, z } from '../validation';

export interface LimitadoresPublicos { registroIp: RequestHandler; registroCorreo: RequestHandler; verificacion: RequestHandler }

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

  return r;
}
