// Gateways propios y OCR: lo que lee la base. La lista de dominios permitidos, las barreras de cada llamada y la configuración del OCR.
// Las escrituras (sólo superadmin, auditadas desde la ruta) están en `gatewaysAdmin.ts`.
import { prisma } from '../db';
import { cifrar, descifrar, llaveroConfigurado } from './secretBox';
import {
  GatewayError, OCR_DESTINOS_INTERNOS, gatewayUsable, normalizarDominio, resolverDestino, urlDeOcr, validarEntradaOcr, validarUrlDestino,
  type Destino,
} from './gateways';

export const aadOcr = () => 'clave:ocr:comprobantes';

/** Dominios permitidos HOY (se lee en cada llamada: quitar uno corta el uso de inmediato). */
export async function dominiosPermitidos(): Promise<Set<string>> {
  const filas = await prisma.dominioGatewayPermitido.findMany({ select: { dominio: true } });
  return new Set(filas.map((f) => f.dominio));
}

/**
 * Barrera de CADA llamada a un gateway: el gateway existe y está habilitado, su dominio sigue en la lista, la URL a llamar es de ese mismo
 * host (https, 443, sin credenciales ni IP literal) y el host resuelve SÓLO a direcciones públicas. Devuelve la IP a la que se conecta.
 */
export async function verificarDestinoGateway(gatewayId: number, url: string): Promise<Destino> {
  const g = await prisma.gatewayIA.findUnique({ where: { id: gatewayId } });
  if (!g || !g.habilitado) throw new GatewayError('gateway_inactivo', 'El gateway está pausado o ya no existe');
  const dominios = await dominiosPermitidos();
  const base = validarUrlDestino(g.base_url, dominios);
  const destino = validarUrlDestino(url, dominios, { base: false });
  if (destino.host !== base.host || !destino.url.startsWith(base.url)) throw new GatewayError('dominio_no_permitido', 'La URL no corresponde al gateway registrado');
  return resolverDestino(destino.host);
}

export type EstadoGateway = 'ok' | 'pausado' | 'dominio_no_permitido';

export function estadoDeGateway(g: { base_url: string; habilitado: boolean }, dominios: ReadonlySet<string>): EstadoGateway {
  if (!g.habilitado) return 'pausado';
  return gatewayUsable(g, dominios) ? 'ok' : 'dominio_no_permitido';
}

export const hostDe = (baseUrl: string): string => { try { return new URL(baseUrl).hostname; } catch { return ''; } };

/** Gateways para la pantalla (nunca llevan claves) con su estado frente a la lista de dominios vigente. */
export async function listarGateways() {
  const [filas, dominios, conteos] = await Promise.all([
    prisma.gatewayIA.findMany({ orderBy: [{ prioridad: 'asc' }, { id: 'asc' }] }),
    dominiosPermitidos(),
    prisma.claveIntegracion.groupBy({ by: ['gateway_id'], where: { gateway_id: { not: null } }, _count: { _all: true } }),
  ]);
  const n = new Map(conteos.map((c) => [c.gateway_id, c._count._all]));
  return filas.map((g) => ({
    id: g.id, nombre: g.nombre, base_url: g.base_url, dominio: hostDe(g.base_url), modelo_por_defecto: g.modelo_por_defecto, modelo_vision: g.modelo_vision,
    vision: g.vision, prioridad: g.prioridad, prioridad_vision: g.prioridad_vision, habilitado: g.habilitado, estado: estadoDeGateway(g, dominios), claves: n.get(g.id) ?? 0,
  }));
}

// ---------- OCR ----------
export interface OcrParaUso { baseUrl: string; apiKey: string | null; interno: boolean; destino: Destino | null }

/**
 * OCR configurado en la base, listo para llamar; `null` si no hay, está pausado o dejó de ser válido (dominio retirado, destino interno fuera de
 * la lista fija, IP no pública). Un OCR público se resuelve aquí mismo, en cada llamada. NUNCA lee variables de entorno.
 */
export async function ocrParaUso(): Promise<OcrParaUso | null> {
  const cfg = await prisma.configuracionOcr.findUnique({ where: { id: 1 } });
  if (!cfg || !cfg.habilitado) return null;
  try {
    const { baseUrl, interno } = urlDeOcr(cfg, await dominiosPermitidos());
    let apiKey: string | null = null;
    if (cfg.api_key_enc) {
      if (!llaveroConfigurado()) return null;
      apiKey = descifrar(cfg.api_key_enc, aadOcr());
    }
    const destino = interno ? null : await resolverDestino(new URL(baseUrl).hostname);
    return { baseUrl, apiKey, interno, destino };
  } catch (err) {
    console.warn(`[ocr] no se usa el servicio configurado (${err instanceof GatewayError ? err.codigo : 'error'})`);
    return null;
  }
}

/** Vista pública de la configuración del OCR (sin la clave). */
export async function verOcr() {
  const [cfg, dominios] = await Promise.all([prisma.configuracionOcr.findUnique({ where: { id: 1 } }), dominiosPermitidos()]);
  const destinos = Object.entries(OCR_DESTINOS_INTERNOS).map(([id, url]) => ({ id, url }));
  if (!cfg || (!cfg.destino_interno && !cfg.base_url)) return { configurado: false as const, destinos_internos: destinos };
  let estado: 'ok' | 'pausado' | 'invalido' = cfg.habilitado ? 'ok' : 'pausado';
  let url: string | null = null;
  try { url = urlDeOcr(cfg, dominios).baseUrl; } catch { if (cfg.habilitado) estado = 'invalido'; }
  return { configurado: true as const, modo: cfg.modo, destino_interno: cfg.destino_interno, base_url: cfg.base_url, url, ultimos4: cfg.ultimos4, tiene_clave: !!cfg.api_key_enc, habilitado: cfg.habilitado, estado, destinos_internos: destinos };
}

/**
 * Migración ÚNICA desde `OCR_BASE_URL` / `OCR_API_KEY`: sólo si la base no tiene configuración. Después el código nunca vuelve a leer esas variables.
 * El operador que puso la variable es de más confianza que el superadmin, así que un `https` público que no esté en la lista de dominios se agrega
 * a ella (la barrera de red sigue aplicándose en cada llamada). Devuelve qué pasó, para el log.
 */
export async function migrarOcrDesdeEnv(env: NodeJS.ProcessEnv = process.env): Promise<'ya_configurado' | 'sin_variable' | 'sin_llavero' | 'url_no_valida' | 'migrado'> {
  if (await prisma.configuracionOcr.findUnique({ where: { id: 1 }, select: { id: true } })) return 'ya_configurado';
  const url = env.OCR_BASE_URL?.trim();
  if (!url) return 'sin_variable';
  const clave = env.OCR_API_KEY?.trim() || null;
  if (clave && !llaveroConfigurado(env)) return 'sin_llavero';
  const dominios = await dominiosPermitidos();
  let entrada: ReturnType<typeof validarEntradaOcr>;
  try {
    const interno = Object.values(OCR_DESTINOS_INTERNOS).some((u) => u.toLowerCase() === url.replace(/\/+$/, '').toLowerCase());
    if (interno) entrada = validarEntradaOcr({ modo: 'interno', base_url: url }, dominios);
    else {
      const host = new URL(url).hostname.toLowerCase();
      entrada = validarEntradaOcr({ modo: 'publico', base_url: url }, new Set([...dominios, host]));
      if (!dominios.has(host)) await prisma.dominioGatewayPermitido.create({ data: { dominio: normalizarDominio(host) } });
    }
  } catch {
    return 'url_no_valida';
  }
  await prisma.configuracionOcr.create({ data: { id: 1, ...entrada, api_key_enc: clave ? cifrar(clave, aadOcr()) : null, ultimos4: clave ? clave.slice(-4) : null } });
  return 'migrado';
}
