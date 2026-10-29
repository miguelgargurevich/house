import { Router, type RequestHandler } from 'express';
import { CODIGOS_PAIS } from '../../lib/paises';
import { ipDe } from '../middleware/audit';
import { MENSAJE_REGISTRO, registrarCuenta, reenviarVerificacion, verificarCorreo } from '../services/comercial/registro';
import { catalogoPublico, cotizacionPublica } from '../services/comercial/suscripciones';
import { contrasenaIgualACorreo, emailSchema, MENSAJE_PASSWORD_CORREO, parse, parseBody, passwordSchema, telefonoObligatorio, texto, z } from '../validation';

export interface LimitadoresPublicos { registroIp: RequestHandler; registroCorreo: RequestHandler; verificacion: RequestHandler }

const registroSchema = z.object({
  nombre: texto(120),
  email: emailSchema,
  celular: telefonoObligatorio,
  password: passwordSchema,
  empresa: texto(160),
  condominio: texto(160),
  unidades: z.coerce.number({ error: 'Debe ser un número' }).int('Debe ser un entero').min(1, 'Mínimo 1').max(5000, 'Máximo 5000'),
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
   * /api/publico/cotizar:
   *   get: { summary: "Total al mes y al año (sin impuesto; aparte el impuesto y el total con impuesto del mes) para N departamentos y un plan, en la moneda del país de `?pais=` (Perú por defecto); Pro y Administradora cobran un mínimo de unidades. Ya no hay módulos sueltos", tags: [Público], responses: { 200: { description: "{ pais, moneda, impuesto_nombre, consultar, unidades, unidades_cobradas, minimo_aplicado, total_mes, total_anio, igv_mes, total_con_igv_mes }; sin precio del plan en esa moneda los totales son null y `consultar` true" } } } */
  r.get('/cotizar', async (req, res) => {
    const q = parse(cotizarSchema, req.query);
    res.json(await cotizacionPublica(q.unidades, q.plan ?? null, q.pais));
  });

  /** @openapi
   * /api/publico/registro:
   *   post: { summary: "Crea empresa + administrador + condominio (Gratis); exige verificar el correo", tags: [Público], responses: { 202: { description: "Misma respuesta exista o no el correo" }, 422: { description: "Campos inválidos" }, 429: { description: "Demasiados intentos" } } } */
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
