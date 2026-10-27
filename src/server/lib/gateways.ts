// Gateways propios de IA: la parte PURA (sin base de datos) de las barreras anti-SSRF y el transporte que conecta a la IP ya validada.
//
// Dos barreras, y la de fondo es la de red:
//  1. `validarUrlDestino`: https, sin credenciales, puerto 443, sin IP literal y host EXACTO de la lista permitida. La lista la edita el
//     superadmin (tabla `DominioGatewayPermitido`), así que NO es la barrera de fondo: sólo evita errores y abusos tontos.
//  2. `resolverDestino`: en CADA llamada se resuelve el host y se rechaza si ALGUNA dirección no es pública (loopback, privada, link-local,
//     CGNAT, ULA, metadata 169.254.169.254, documentación, multicast…). Es la defensa contra DNS-rebinding y contra un dominio permitido
//     que apunte adentro. `fetchFijado` conecta a esa IP ya validada (no vuelve a resolver) y nunca sigue redirecciones.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { proveedorPorId, type ProveedorIA } from './proveedoresIA';

export type CodigoGateway =
  | 'url_invalida' | 'https_obligatorio' | 'credenciales' | 'puerto' | 'consulta' | 'ip_literal' | 'dominio_no_permitido'
  | 'dominio_invalido' | 'dns' | 'ip_privada' | 'gateway_inactivo' | 'ocr_destino';

/** Error de una barrera anti-SSRF. El mensaje está en español y es apto para mostrarlo a quien administra (sin direcciones internas). */
export class GatewayError extends Error {
  readonly codigo: CodigoGateway;
  constructor(codigo: CodigoGateway, mensaje: string) {
    super(mensaje);
    this.name = 'GatewayError';
    this.codigo = codigo;
  }
}

// ---------- Dominios y URL ----------
const ETIQUETA_DNS = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Un host exacto en minúsculas, sin esquema, puerto ni ruta; con al menos dos etiquetas y nunca una IP. */
export function normalizarDominio(crudo: string): string {
  const d = String(crudo ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!d || d.length > 253) throw new GatewayError('dominio_invalido', 'Escribe sólo el dominio (por ejemplo api.midominio.dev), sin https:// ni ruta');
  if (isIP(d) || d.startsWith('[')) throw new GatewayError('dominio_invalido', 'Un dominio permitido no puede ser una dirección IP');
  const etiquetas = d.split('.');
  if (etiquetas.length < 2 || !etiquetas.every((e) => ETIQUETA_DNS.test(e))) throw new GatewayError('dominio_invalido', 'Escribe sólo el dominio (por ejemplo api.midominio.dev), sin https:// ni ruta ni comodines');
  if (/^\d+$/.test(etiquetas[etiquetas.length - 1]!)) throw new GatewayError('dominio_invalido', 'Un dominio permitido no puede terminar en un número');
  return d;
}

export interface DestinoUrl { url: string; host: string }

/**
 * Valida una URL de destino contra la lista de dominios. `base` = la URL base de un gateway (sin consulta ni fragmento);
 * con `base: false` es la URL completa de una llamada (admite `?query`). Devuelve la URL normalizada (sin barra final) y su host.
 */
export function validarUrlDestino(crudo: string, dominios: ReadonlySet<string>, opciones: { base: boolean } = { base: true }): DestinoUrl {
  const texto = String(crudo ?? '').trim();
  let u: URL;
  try { u = new URL(texto); } catch { throw new GatewayError('url_invalida', 'La URL no es válida'); }
  if (texto.length > 300) throw new GatewayError('url_invalida', 'La URL es demasiado larga');
  if (u.protocol !== 'https:') throw new GatewayError('https_obligatorio', 'La URL debe empezar con https://');
  if (u.username || u.password) throw new GatewayError('credenciales', 'La URL no puede llevar usuario ni contraseña');
  if (u.port !== '') throw new GatewayError('puerto', 'Sólo se admite el puerto 443 (déjalo vacío)');
  if (u.hash || (opciones.base && u.search)) throw new GatewayError('consulta', 'La URL base no puede llevar parámetros (?…) ni #');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || isIP(host)) throw new GatewayError('ip_literal', 'La URL no puede ser una dirección IP: usa un dominio');
  if (!dominios.has(host)) throw new GatewayError('dominio_no_permitido', `El dominio ${host} no está en la lista de dominios permitidos. Agrégalo primero en «Dominios permitidos».`);
  const ruta = u.pathname.replace(/\/+$/, '');
  return { url: `https://${host}${ruta}${opciones.base ? '' : u.search}`, host };
}

// ---------- Direcciones ----------
const aNumeros = (ip: string) => ip.split('.').map(Number);
const v4 = (a: number, b: number, c: number, d: number) => ((a * 256 + b) * 256 + c) * 256 + d;
/** [base, bits] de lo que NO es Internet público en IPv4. */
const V4_BLOQUEADOS: readonly (readonly [number, number])[] = [
  [v4(0, 0, 0, 0), 8], [v4(10, 0, 0, 0), 8], [v4(100, 64, 0, 0), 10], [v4(127, 0, 0, 0), 8], [v4(169, 254, 0, 0), 16], [v4(172, 16, 0, 0), 12],
  [v4(192, 0, 0, 0), 24], [v4(192, 0, 2, 0), 24], [v4(192, 88, 99, 0), 24], [v4(192, 168, 0, 0), 16], [v4(198, 18, 0, 0), 15], [v4(198, 51, 100, 0), 24],
  [v4(203, 0, 113, 0), 24], [v4(224, 0, 0, 0), 4], [v4(240, 0, 0, 0), 4],
];

function v4Bloqueada(ip: string): boolean {
  const p = aNumeros(ip);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const n = v4(p[0]!, p[1]!, p[2]!, p[3]!);
  return V4_BLOQUEADOS.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

/** IPv6 → 8 grupos de 16 bits; null si no se puede leer (y entonces se trata como bloqueada). */
function grupos6(ip: string): number[] | null {
  if (ip.includes('%')) return null; // zonas (fe80::1%en0): nunca públicas
  let texto = ip.toLowerCase();
  const punto = texto.lastIndexOf('.');
  if (punto >= 0) {
    const ini = texto.lastIndexOf(':') + 1;
    const q = aNumeros(texto.slice(ini));
    if (q.length !== 4 || q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    texto = `${texto.slice(0, ini)}${((q[0]! << 8) | q[1]!).toString(16)}:${((q[2]! << 8) | q[3]!).toString(16)}`;
  }
  const mitades = texto.split('::');
  if (mitades.length > 2) return null;
  const izq = mitades[0] ? mitades[0].split(':') : [];
  const der = mitades.length === 2 && mitades[1] ? mitades[1].split(':') : [];
  const relleno = mitades.length === 2 ? 8 - izq.length - der.length : 0;
  if (relleno < (mitades.length === 2 ? 1 : 0)) return null;
  const todos = [...izq, ...Array<string>(Math.max(relleno, 0)).fill('0'), ...der];
  if (todos.length !== 8) return null;
  const g = todos.map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN));
  return g.some(Number.isNaN) ? null : g;
}

/**
 * ¿Esta dirección NO es de Internet público? Para IPv6 se acepta sólo el unicast global (2000::/3) menos documentación, Teredo, 6to4 y
 * rangos reservados; ::ffff:a.b.c.d se juzga como la IPv4 que lleva dentro. Lo ilegible cuenta como bloqueado.
 */
export function esIpBloqueada(ip: string): boolean {
  const tipo = isIP(ip);
  if (tipo === 4) return v4Bloqueada(ip);
  if (tipo !== 6) return true;
  const g = grupos6(ip);
  if (!g) return true;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Bloqueada(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  if (g[0]! < 0x2000 || g[0]! > 0x3fff) return true; // fuera de 2000::/3: loopback, ULA (fc00::/7), link-local, multicast, NAT64…
  if (g[0] === 0x2001 && (g[1]! < 0x200 || g[1] === 0xdb8 || (g[1]! >= 0x10 && g[1]! < 0x30))) return true; // 2001::/23 (Teredo y protocolos), documentación, ORCHID
  if (g[0] === 0x2002) return true; // 6to4: lleva una IPv4 adentro
  if (g[0] === 0x3fff && g[1]! < 0x1000) return true; // documentación 3fff::/20
  return false;
}

// ---------- Resolución ----------
export interface Destino { host: string; ip: string; family: 4 | 6 }
export const TOPE_DNS_MS = 5_000;

/** Punto de inyección: las pruebas reemplazan `resolver` (nunca hay DNS real en ellas). */
export const gatewayDeps = {
  resolver: (host: string): Promise<{ address: string; family: number }[]> => dns.promises.lookup(host, { all: true, verbatim: true }),
};

/** Resuelve el host y exige que TODAS sus direcciones sean públicas. Devuelve la que se usará para conectar. */
export async function resolverDestino(host: string): Promise<Destino> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let direcciones: { address: string; family: number }[];
  try {
    direcciones = await Promise.race([
      gatewayDeps.resolver(host),
      new Promise<never>((_, rechazar) => { timer = setTimeout(() => rechazar(new Error('dns lento')), TOPE_DNS_MS); timer.unref?.(); }),
    ]);
  } catch {
    throw new GatewayError('dns', `No se pudo resolver el dominio ${host}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!Array.isArray(direcciones) || direcciones.length === 0) throw new GatewayError('dns', `No se pudo resolver el dominio ${host}`);
  if (direcciones.some((d) => esIpBloqueada(d.address))) throw new GatewayError('ip_privada', `El dominio ${host} apunta a una dirección que no es pública: se bloqueó la llamada`);
  const elegida = direcciones.find((d) => d.family === 4) ?? direcciones[0]!;
  return { host, ip: elegida.address, family: isIP(elegida.address) === 6 ? 6 : 4 };
}

// ---------- Transporte ----------
export type InitFijado = RequestInit & { destino?: Destino };

/**
 * `fetch` que conecta a la IP YA validada (`destino`) sin volver a resolver: el `lookup` del socket devuelve siempre esa IP, mientras el
 * certificado TLS y la cabecera Host siguen siendo los del dominio. No sigue redirecciones (devuelve la 3xx tal cual) y respeta `signal`.
 * Sólo se llama desde `fetchProveedor` DESPUÉS de las barreras; acepta http únicamente para poder probarse contra un servidor local.
 */
export async function fetchFijado(url: string, init: InitFijado): Promise<Response> {
  const destino = init.destino;
  if (!destino) throw new GatewayError('dns', 'Falta el destino validado');
  const u = new URL(url);
  const cabeceras = new Headers(init.headers);
  let cuerpo: Buffer | null = null;
  if (typeof init.body === 'string') cuerpo = Buffer.from(init.body);
  else if (init.body != null) {
    const rq = new Request(url, { method: 'POST', body: init.body });
    cuerpo = Buffer.from(await rq.arrayBuffer());
    const tipo = rq.headers.get('content-type');
    if (tipo && !cabeceras.has('content-type')) cabeceras.set('content-type', tipo);
  }
  if (cuerpo) cabeceras.set('content-length', String(cuerpo.length));
  const senal = init.signal ?? undefined;
  if (senal?.aborted) throw senal.reason ?? new DOMException('cancelado', 'AbortError');

  return new Promise<Response>((resolver, rechazar) => {
    const modulo = u.protocol === 'http:' ? http : https;
    const req = modulo.request({
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(cabeceras.entries()),
      servername: u.protocol === 'https:' ? u.hostname : undefined,
      lookup: ((_h: string, opciones: { all?: boolean }, cb: (...a: unknown[]) => void) => {
        if (opciones?.all) cb(null, [{ address: destino.ip, family: destino.family }]);
        else cb(null, destino.ip, destino.family);
      }) as never,
    });
    const cortar = () => {
      const razon = senal?.reason ?? new DOMException('cancelado', 'AbortError');
      req.destroy();
      rechazar(razon);
    };
    senal?.addEventListener('abort', cortar, { once: true });
    req.once('error', (err) => { senal?.removeEventListener('abort', cortar); rechazar(err); });
    req.once('response', (res) => {
      const cabs = new Headers();
      for (const [k, v] of Object.entries(res.headers)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) cabs.append(k, x);
      const estado = res.statusCode ?? 502;
      const sinCuerpo = estado === 204 || estado === 205 || estado === 304;
      if (sinCuerpo) res.resume();
      senal?.addEventListener('abort', () => res.destroy(senal.reason as Error), { once: true });
      resolver(new Response(sinCuerpo ? null : (Readable.toWeb(res) as ReadableStream), { status: estado, statusText: res.statusMessage, headers: cabs }));
    });
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

// ---------- Del gateway al proveedor ----------
export interface FilaGateway {
  id: number;
  nombre: string;
  base_url: string;
  modelo_por_defecto: string | null;
  modelo_vision: string | null;
  vision: boolean;
  prioridad: number;
  prioridad_vision?: number | null;
  habilitado: boolean;
}

export const PROVEEDOR_GATEWAY = 'gateway';

/** Un gateway se comporta como un proveedor `openai-compatible`; su `id` es siempre `gateway` (lo que guarda `ClaveIntegracion.proveedor`). */
export function proveedorDeGateway(g: FilaGateway): ProveedorIA {
  return {
    id: PROVEEDOR_GATEWAY,
    nombre: g.nombre,
    descripcion: 'Gateway propio compatible con OpenAI.',
    tipo: 'openai-compatible',
    baseUrl: g.base_url,
    urlParaConseguirKey: '',
    modeloPorDefecto: g.modelo_por_defecto ?? '',
    variableDeEntorno: '',
    prioridad: g.prioridad,
    prioridadVision: g.prioridad_vision ?? null,
    vision: g.vision,
    modeloVision: g.modelo_vision ?? g.modelo_por_defecto ?? '',
    visionPdf: false,
    gatewayId: g.id,
  };
}

/**
 * LA resolución de proveedor: dada una fila de `ClaveIntegracion` (con su `gateway` cargado), el proveedor del catálogo o el construido desde su
 * gateway. Ningún otro lugar arma URLs. No juzga si el gateway se puede USAR (eso es `gatewayUsable` y, en cada llamada, `fetchProveedor`).
 */
export function proveedorDeFila(f: { proveedor: string; gateway?: FilaGateway | null }): ProveedorIA | null {
  if (f.proveedor !== PROVEEDOR_GATEWAY) return proveedorPorId(f.proveedor) ?? null;
  return f.gateway ? proveedorDeGateway(f.gateway) : null;
}

/** ¿El gateway se puede usar ahora? Habilitado y con la URL válida contra la lista vigente (si el dominio salió de la lista, falla cerrado). */
export function gatewayUsable(g: Pick<FilaGateway, 'base_url' | 'habilitado'>, dominios: ReadonlySet<string>): boolean {
  if (!g.habilitado) return false;
  try { validarUrlDestino(g.base_url, dominios); return true; } catch { return false; }
}

// ---------- Etiquetas de las claves de gateway ----------
// `ClaveIntegracion` es única por (proveedor, etiqueta): las claves de un gateway guardan `g<id>:<etiqueta>` para no chocar con las de otro.
export const etiquetaInterna = (gatewayId: number | null | undefined, etiqueta: string) => (gatewayId ? `g${gatewayId}:${etiqueta}` : etiqueta);
export const etiquetaVisible = (etiqueta: string, gatewayId: number | null | undefined) => (gatewayId && etiqueta.startsWith(`g${gatewayId}:`) ? etiqueta.slice(`g${gatewayId}:`.length) : etiqueta);

// ---------- OCR ----------
/** Destinos INTERNOS permitidos al OCR: lista fija en el código (nadie la amplía desde la base). Hoy sólo el contenedor de la red `coolify`. */
export const OCR_DESTINOS_INTERNOS: Readonly<Record<string, string>> = { 'house-ocr': 'http://house-ocr:5050' };

const sinBarraFinal = (s: string) => s.trim().replace(/\/+$/, '').toLowerCase();

/** Entrada del OCR (API o migración) → la forma que se guarda. `interno` sólo acepta un destino de la lista fija; `publico`, las barreras de los gateways. */
export function validarEntradaOcr(e: { modo: 'interno' | 'publico'; base_url?: string | null }, dominios: ReadonlySet<string>): { modo: 'interno'; destino_interno: string; base_url: null } | { modo: 'publico'; destino_interno: null; base_url: string } {
  if (e.modo === 'interno') {
    const pedida = e.base_url ? sinBarraFinal(e.base_url) : null;
    const clave = pedida === null ? Object.keys(OCR_DESTINOS_INTERNOS)[0]! : Object.keys(OCR_DESTINOS_INTERNOS).find((k) => sinBarraFinal(OCR_DESTINOS_INTERNOS[k]!) === pedida);
    if (!clave) throw new GatewayError('ocr_destino', 'Ese destino interno no está permitido para el OCR');
    return { modo: 'interno', destino_interno: clave, base_url: null };
  }
  return { modo: 'publico', destino_interno: null, base_url: validarUrlDestino(e.base_url ?? '', dominios).url };
}

/** URL a la que se llama según lo guardado; lanza si lo guardado ya no es válido (destino interno fuera de la lista fija o dominio retirado). */
export function urlDeOcr(cfg: { modo: string; destino_interno: string | null; base_url: string | null }, dominios: ReadonlySet<string>): { baseUrl: string; interno: boolean } {
  if (cfg.modo === 'interno') {
    const url = cfg.destino_interno ? OCR_DESTINOS_INTERNOS[cfg.destino_interno] : undefined;
    if (!url) throw new GatewayError('ocr_destino', 'El destino interno del OCR ya no está permitido');
    return { baseUrl: url, interno: true };
  }
  if (cfg.modo === 'publico') return { baseUrl: validarUrlDestino(cfg.base_url ?? '', dominios).url, interno: false };
  throw new GatewayError('ocr_destino', 'La configuración del OCR no es válida');
}
