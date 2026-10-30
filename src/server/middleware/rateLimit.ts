import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export interface RateLimitOptions {
  /** API general SIN sesión (tramos públicos y peticiones sin sesión válida): solicitudes por IP cada 15 min. */
  api?: number;
  /** API general CON sesión válida: solicitudes por usuario (no por IP) cada 15 min. */
  apiUsuario?: number;
  login?: number;
  /** Login: fallos por cuenta (correo), desde cualquier IP, antes del bloqueo de 15 min. */
  loginCuenta?: number;
  /** Sólo pruebas: reloj del bloqueo por cuenta (ms). */
  ahora?: () => number;
  ai?: number;
  password?: number;
  llavero?: number;
  evaluacion?: number;
  /** `/mcp`: solicitudes por minuto y por token. */
  mcp?: number;
  /** `/mcp`: intentos con token inválido por IP cada 15 min. */
  mcpFallos?: number;
  /** Registro público: intentos por IP por hora. */
  registroIp?: number;
  /** Registro público: intentos por correo (exista o no) por hora. */
  registroCorreo?: number;
  /** Verificación de correo: intentos por IP cada 15 min. */
  verificacion?: number;
  /** Enlace de invitación (ver y aceptar): intentos FALLIDOS por IP cada 15 min, como el login. */
  invitacion?: number;
}

const QUINCE_MIN = 15 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;

/** Anónimo: por IP. Los tramos públicos son pocos y sin sesión, así que 300 cada 15 min sobran para una persona. */
export const TOPE_API_ANONIMO = 300;
/**
 * Con sesión: por USUARIO. La app hace varias solicitudes por pantalla y los vecinos de un condominio suelen salir por la misma IP
 * (wifi del edificio, NAT del operador): un tope por IP bloqueaba a gente legítima. 3000 cada 15 min (≈ 3,3 por segundo sostenidos)
 * no molesta a nadie y sigue frenando a un cliente descontrolado o a un token robado que raspa la API.
 */
export const TOPE_API_USUARIO = 3000;

function limiter(max: number, mensaje: string, keyGenerator: (req: Request) => string, extra: { soloFallos?: boolean; ventanaMs?: number } = {}): RequestHandler {
  return rateLimit({
    ...(extra.soloFallos ? { skipSuccessfulRequests: true } : {}),
    windowMs: extra.ventanaMs ?? QUINCE_MIN,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    message: { error: mensaje },
    validate: { keyGeneratorIpFallback: false },
  });
}

/**
 * Bloqueo por cuenta (correo normalizado, desde cualquier IP) para el login. Complementa el límite por IP+correo,
 * que no frena a un atacante con muchas IPs. Cuenta sólo los FALLOS: al llegar a `max` bloquea 15 min (durante el
 * bloqueo no se prolonga: el bloqueo dura 15 min desde el último fallo que lo provocó). Un login correcto limpia los fallos de esa cuenta. Existe o no la cuenta,
 * el comportamiento es idéntico. Estado en memoria del proceso (igual que el resto de limitadores).
 */
export class BloqueoCuenta {
  private readonly cuentas = new Map<string, { fallos: number[]; hasta: number }>();
  private static readonly TOPE_CLAVES = 5000;

  private readonly max: number;
  private readonly ahora: () => number;

  constructor(max = 10, ahora: () => number = Date.now) {
    this.max = max;
    this.ahora = ahora;
  }

  private clave = (email: string) => email.trim().toLowerCase().slice(0, 160);

  /** ¿La cuenta está bloqueada ahora? */
  bloqueada(email: string): boolean {
    const c = this.cuentas.get(this.clave(email));
    return !!c && c.hasta > this.ahora();
  }

  /** Anota un intento fallido; al `max`-ésimo dentro de 15 min bloquea la cuenta 15 min. */
  fallo(email: string): void {
    const k = this.clave(email);
    const t = this.ahora();
    const c = this.cuentas.get(k) ?? { fallos: [], hasta: 0 };
    if (c.hasta > t) return;
    c.fallos = c.fallos.filter((f) => t - f < QUINCE_MIN);
    c.fallos.push(t);
    if (c.fallos.length >= this.max) {
      c.hasta = t + QUINCE_MIN;
      c.fallos = [];
    }
    this.cuentas.delete(k);
    this.cuentas.set(k, c);
    if (this.cuentas.size > BloqueoCuenta.TOPE_CLAVES) this.barrer(t);
  }

  /** Login correcto: la cuenta empieza de cero. */
  exito(email: string): void {
    this.cuentas.delete(this.clave(email));
  }

  /** Quita lo vencido; si aun así sobra, descarta las más antiguas (la memoria no crece sin límite con correos inventados). */
  private barrer(t: number): void {
    for (const [k, c] of this.cuentas) if (c.hasta <= t && c.fallos.every((f) => t - f >= QUINCE_MIN)) this.cuentas.delete(k);
    for (const k of this.cuentas.keys()) {
      if (this.cuentas.size <= BloqueoCuenta.TOPE_CLAVES) break;
      this.cuentas.delete(k);
    }
  }
}

export const MENSAJE_LOGIN_BLOQUEADO = 'Demasiados intentos de inicio de sesión, intenta de nuevo en 15 minutos';

const MENSAJE_API = 'Demasiadas solicitudes, intenta de nuevo en unos minutos';

const ip = (req: Request) => ipKeyGenerator(req.ip ?? '');

/**
 * Autentica y reparte el límite general: con sesión válida cuenta por USUARIO (`porUsuario`); si `autenticar` falla (sin sesión, vencida,
 * CSRF) la petición es anónima: cuenta por IP en `anonimo` y se responde el error de `autenticar` (401 como siempre), salvo que ese cupo esté
 * agotado (429). Así el cupo por IP sólo lo gasta lo anónimo.
 */
export function limitarSegunSesion(autenticar: RequestHandler, anonimo: RequestHandler, porUsuario: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      await new Promise<void>((listo, fallo) => {
        Promise.resolve(autenticar(req, res, (e?: unknown) => (e ? fallo(e) : listo()))).catch(fallo);
      });
    } catch (e) {
      anonimo(req, res, (limite?: unknown) => next(limite ?? e));
      return;
    }
    porUsuario(req, res, next);
  };
}

export function crearLimitadores(opts: RateLimitOptions = {}) {
  return {
    // Por IP: sólo lo anónimo (ver `limitarSegunSesion`); lo autenticado no gasta este cupo.
    apiAnonimo: limiter(opts.api ?? TOPE_API_ANONIMO, MENSAJE_API, ip),
    // Por usuario: se monta después de `authenticate`, la IP no cuenta.
    apiUsuario: limiter(opts.apiUsuario ?? TOPE_API_USUARIO, MENSAJE_API, (req) => `u${req.user?.id ?? ip(req)}`),
    login: limiter(opts.login ?? 10, MENSAJE_LOGIN_BLOQUEADO, (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 160) : '';
      return `${ip(req)}|${email}`;
    }),
    loginCuenta: new BloqueoCuenta(opts.loginCuenta ?? 10, opts.ahora),
    // Por usuario: se monta después de `authenticate`.
    ai: limiter(opts.ai ?? 20, 'Has alcanzado el límite de consultas a la IA, intenta de nuevo más tarde', (req) => `u${req.user?.id ?? ip(req)}`),
    llavero: limiter(opts.llavero ?? 20, 'Demasiadas operaciones en el llavero, intenta de nuevo más tarde', (req) => `u${req.user?.id ?? ip(req)}`),
    evaluacion: limiter(opts.evaluacion ?? 20, 'Has pedido demasiadas evaluaciones de comprobantes, intenta de nuevo más tarde', (req) => `u${req.user?.id ?? ip(req)}`),
    // Sólo cuenta los 4xx de `/mcp` (token inválido): una IP que tantea tokens se frena; un cliente con token válido no gasta este cupo.
    mcpFallos: limiter(opts.mcpFallos ?? 30, 'Demasiados intentos con un token inválido, intenta de nuevo más tarde', ip, { soloFallos: true }),
    // Registro público: por IP y por correo (cuenta todos los intentos, exista o no la cuenta: no delata nada).
    registroIp: limiter(opts.registroIp ?? 5, 'Demasiados registros desde esta conexión, intenta de nuevo más tarde', ip, { ventanaMs: UNA_HORA }),
    registroCorreo: limiter(opts.registroCorreo ?? 3, 'Demasiados intentos con este correo, intenta de nuevo más tarde', (req) => `c${typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 160) : ip(req)}`, { ventanaMs: UNA_HORA }),
    verificacion: limiter(opts.verificacion ?? 20, 'Demasiados intentos, intenta de nuevo en unos minutos', ip),
    // Como el login: sólo cuentan los fallos (enlace inválido, contraseña rechazada); quien entra bien no gasta el cupo.
    invitacion: limiter(opts.invitacion ?? 10, 'Demasiados intentos, intenta de nuevo en 15 minutos', ip, { soloFallos: true }),
    password: limiter(opts.password ?? 10, 'Demasiados intentos de cambio de contraseña, intenta de nuevo más tarde', (req) => `u${req.user?.id ?? ip(req)}`),
  };
}
