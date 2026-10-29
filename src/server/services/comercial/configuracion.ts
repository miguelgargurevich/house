import type { ConfiguracionComercial } from '@prisma/client';
import { prisma } from '../../db';
import { depsReales, enviarCorreo, type DepsAvisos, type ResultadoEnvio } from '../avisos/canales';
import { CONFIGURACION_ID, sembrarCatalogoComercial } from './catalogo';

/** Fila única de configuración (se crea con sus valores de partida si todavía no existe). */
export async function obtenerConfiguracion(): Promise<ConfiguracionComercial> {
  const c = await prisma.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID } });
  if (c) return c;
  await sembrarCatalogoComercial(prisma);
  return prisma.configuracionComercial.findUniqueOrThrow({ where: { id: CONFIGURACION_ID } });
}

/** Inyectable para pruebas: correo (Resend) sin red. En producción, los envíos reales de `services/avisos/canales.ts`. */
export const comercialCorreo = {
  deps: (): DepsAvisos => depsReales(),
};

export const correoA = (destino: string | null, asunto: string, cuerpo: string, deps: DepsAvisos = comercialCorreo.deps(), html?: string): Promise<ResultadoEnvio> => enviarCorreo(deps, destino, asunto, cuerpo, undefined, html);

/** Enlace a una pantalla pública. La base sale de la configuración (nunca de la cabecera Host de la petición: sería un enlace envenenable). */
export function enlace(cfg: Pick<ConfiguracionComercial, 'url_publica'>, ruta: string): string {
  const base = (cfg.url_publica ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}${ruta}` : ruta;
}

/** `maria@casa.pe` → `m***@casa.pe` (para auditoría y respuestas: nunca el correo completo). */
export function enmascarar(email: string): string {
  const i = email.lastIndexOf('@');
  return i < 1 ? '***' : `${email[0]}***${email.slice(i)}`;
}
