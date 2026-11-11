// El candado de la demo. Con el modo demostración encendido (`ConfiguracionDemo.activo`), lo que podría sacar algo de la instancia o dañar las cuentas
// compartidas responde 403 `{ error, code: 'DEMO' }` ANTES de llegar a la ruta: registrar empresas, «Entrar como», tokens de API, cambiar claves,
// correos o celulares de las cuentas, eliminar una cuenta, el llavero de IA, el chat de IA, vincular números propios. El WhatsApp se contesta con datos de ejemplo.
// Los envíos de correo y WhatsApp y la IA de pago se cortan en sus propios puntos (`avisos/canales.ts`, `canales/evolution.ts`, `evaluacion.ts`).
// Sin el modo encendido este middleware no hace nada: producción queda igual.
import type { RequestHandler } from 'express';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { CODIGO_DEMO, MENSAJE_DEMO, modoDemo } from '../services/demo/estado';
import { INSTANCIA_DEMO, NUMERO_WHATSAPP_DEMO } from '../services/demo/evolutionDemo';

interface Regla {
  metodos: readonly string[];
  ruta: RegExp;
  /** Si se indica, sólo se bloquea cuando el cuerpo JSON trae alguno de estos campos (editar nombre sí; correo, celular o clave no). */
  campos?: readonly string[];
}

const ESCRITURA = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const CAMPOS_DE_CUENTA = ['password', 'nueva', 'contrasena', 'email', 'correo', 'telefono', 'celular'] as const;

/** Tramo público (antes de la sesión): registros y formularios que mandan correos a la casa. */
export const REGLAS_PUBLICAS: readonly Regla[] = [
  { metodos: ['POST'], ruta: /^\/publico\/(registro|reenviar-verificacion|verificar-correo|contacto|reclamaciones)$/ },
];

/** Con sesión: lo que cambia una cuenta de demo o abre una puerta hacia fuera. */
export const REGLAS_CON_SESION: readonly Regla[] = [
  { metodos: ['POST'], ruta: /^\/impersonacion(\/.*)?$/ }, // «Entrar como»
  { metodos: ['POST', 'DELETE'], ruta: /^\/me\/tokens-api(\/.*)?$/ }, // tokens de API (MCP)
  { metodos: ['PUT'], ruta: /^\/me$/ }, // nombre y celular propios
  { metodos: ['PUT'], ruta: /^\/me\/password$/ }, // contraseña propia
  { metodos: ['POST'], ruta: /^\/me\/(eliminar|solicitar-cierre)$/ }, // eliminar la propia cuenta o pedir el cierre de la empresa: las cuentas de la demo son compartidas
  { metodos: ['POST', 'DELETE'], ruta: /^\/me\/canales(\/.*)?$/ }, // vincular el WhatsApp o Telegram propio
  { metodos: ['POST'], ruta: /^\/ai-chat(\/.*)?$/ }, // IA de pago
  { metodos: ['POST', 'PUT', 'PATCH', 'DELETE'], ruta: /^\/llavero(\/.*)?$/ }, // claves y gateways de IA
  { metodos: ['POST', 'DELETE'], ruta: /^\/empresas(\/\d+)?$/ }, // empresas nuevas
  { metodos: ['DELETE'], ruta: /^\/whatsapp\/disconnect$/ }, // el número de ejemplo no se desvincula
  { metodos: ['PUT', 'PATCH'], ruta: /^\/usuarios\/\d+$/, campos: CAMPOS_DE_CUENTA }, // cuentas existentes
  { metodos: ['POST', 'PUT', 'PATCH'], ruta: /^\/unidades\/\d+\/personas(\/\d+)?$/, campos: CAMPOS_DE_CUENTA }, // contactos reales de vecinos
];

const normalizar = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

function bloquea(reglas: readonly Regla[], metodo: string, ruta: string, cuerpo: unknown): boolean {
  const r = normalizar(ruta);
  return reglas.some((x) => {
    if (!x.metodos.includes(metodo) || !x.ruta.test(r)) return false;
    if (!x.campos) return true;
    const c = cuerpo && typeof cuerpo === 'object' ? (cuerpo as Record<string, unknown>) : {};
    return x.campos.some((k) => k in c);
  });
}

/** `tramo`: 'publico' va antes de la autenticación; 'sesion' va después y además contesta el WhatsApp de ejemplo. */
export function candadoDemo(tramo: 'publico' | 'sesion'): RequestHandler {
  const reglas = tramo === 'publico' ? REGLAS_PUBLICAS : REGLAS_CON_SESION;
  return async (req, res, next) => {
    // Sólo las peticiones que podrían caer en una regla gastan la consulta del modo (en producción, casi ninguna llega a ella).
    const candidata = tramo === 'publico' ? ESCRITURA.includes(req.method as never) : ESCRITURA.includes(req.method as never) || (req.method === 'GET' && req.path === '/whatsapp/status');
    if (!candidata) return next();
    if (!(await modoDemo())) return next();
    if (bloquea(reglas, req.method, req.path, req.body)) throw new HttpError(403, MENSAJE_DEMO, undefined, CODIGO_DEMO);
    if (tramo === 'sesion' && req.user?.empresa_id != null && ((req.method === 'GET' && req.path === '/whatsapp/status') || (req.method === 'POST' && req.path === '/whatsapp/sync'))) {
      // El número de WhatsApp de la demo está siempre vinculado: se contesta sin llamar a Evolution.
      const empresa = await prisma.empresaAdministradora.findUnique({ where: { id: req.user.empresa_id }, select: { whatsapp_instance: true } });
      const instance = empresa?.whatsapp_instance ?? INSTANCIA_DEMO;
      return void res.json(req.method === 'GET'
        ? { connected: true, status: 'open', instance, numero: NUMERO_WHATSAPP_DEMO }
        : { instance, webhook: 'ya_estaba', qr: null, status: 'open', numero: NUMERO_WHATSAPP_DEMO });
    }
    next();
  };
}
