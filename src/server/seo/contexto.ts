// Lo que el HTML estático, el sitemap y los textos para LLM necesitan de la base: la configuración (URL pública, registro abierto, códigos de
// verificación, datos legales) y el catálogo público de planes. Nada de esto se lee de la petición.
import type { ConfiguracionComercial } from '@prisma/client';
import { prisma } from '../db';
import { obtenerConfiguracion } from '../services/comercial/configuracion';
import { catalogoPublico } from '../services/comercial/suscripciones';
import type { Catalogo } from '../../pages/publico/catalogo';

export interface ContextoSeo {
  cfg: ConfiguracionComercial;
  cat: Catalogo;
  /** URL pública sin barra final («https://torrecondominios.com»); '' si el superadmin aún no la cargó. */
  base: string;
  /** Último cambio de un plan visible: es el `lastmod` de /precios. */
  modificadoPrecios: Date | null;
}

/** «https://torrecondominios.com/» → «https://torrecondominios.com». Sólo http(s); lo demás cuenta como «sin URL». */
export function baseDe(cfg: Pick<ConfiguracionComercial, 'url_publica'>): string {
  const u = (cfg.url_publica ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(u) ? u : '';
}

/** Host de la URL pública (sin puerto), en minúsculas; null si no hay. */
export function hostDe(base: string): string | null {
  try { return base ? new URL(base).hostname.toLowerCase() : null; } catch { return null; }
}

async function cargarContextoReal(): Promise<ContextoSeo> {
  const [cfg, cat, ultimo] = await Promise.all([
    obtenerConfiguracion(),
    catalogoPublico(),
    prisma.planComercial.aggregate({ where: { visible: true }, _max: { updated_at: true } }),
  ]);
  return { cfg, cat, base: baseDe(cfg), modificadoPrecios: ultimo._max.updated_at };
}

/** Punto de inyección para las pruebas (simular una base caída sin tocar la base). En producción siempre es `cargarContextoReal`. */
export const seoDeps = {
  cargarContexto: cargarContextoReal as () => Promise<ContextoSeo>,
  obtenerConfiguracion: obtenerConfiguracion as () => Promise<ConfiguracionComercial>,
};
export const cargarContexto = (): Promise<ContextoSeo> => seoDeps.cargarContexto();
