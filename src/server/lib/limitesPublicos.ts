// Topes de los formularios públicos (contacto y Libro de Reclamaciones). Van por IP, y el Libro además por el correo del consumidor
// (a ese correo sale la copia: sin tope, alguien podría usar el formulario para llenar la bandeja de otra persona).
// Cada formulario lleva su propio cupo: no comparte el del registro ni el del inicio de sesión.
import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export interface OpcionesLimitesPublicos { contactoIp?: number; reclamoIp?: number; reclamoCorreo?: number }

const UNA_HORA = 60 * 60 * 1000;
const ip = (req: Request) => ipKeyGenerator(req.ip ?? '');

function limitador(max: number, mensaje: string, clave: (req: Request) => string): RequestHandler {
  return rateLimit({ windowMs: UNA_HORA, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: clave, message: { error: mensaje }, validate: { keyGeneratorIpFallback: false } });
}

export const TOPE_CONTACTO_IP = 5;
export const TOPE_RECLAMO_IP = 5;
export const TOPE_RECLAMO_CORREO = 3;

export function crearLimitadoresFormularios(o: OpcionesLimitesPublicos = {}) {
  return {
    contactoIp: limitador(o.contactoIp ?? TOPE_CONTACTO_IP, 'Enviaste varios mensajes seguidos. Intenta de nuevo en una hora o escríbenos por WhatsApp.', (req) => `k${ip(req)}`),
    reclamoIp: limitador(o.reclamoIp ?? TOPE_RECLAMO_IP, 'Registraste varias hojas seguidas desde esta conexión. Intenta de nuevo en una hora o escríbenos por correo.', (req) => `r${ip(req)}`),
    reclamoCorreo: limitador(o.reclamoCorreo ?? TOPE_RECLAMO_CORREO, 'Ya registraste varias hojas con este correo. Intenta de nuevo en una hora o escríbenos por correo.', (req) => `m${typeof req.body?.correo === 'string' ? req.body.correo.trim().toLowerCase().slice(0, 160) : ip(req)}`),
  };
}
export type LimitadoresFormularios = ReturnType<typeof crearLimitadoresFormularios>;
