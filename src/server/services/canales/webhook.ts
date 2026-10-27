import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../../db';
import { canalesDeps } from './deps';
import { ponerWebhook } from './evolution';

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
const HASH_NULO = sha256('sin-instancia');

/** URL pública a la que Evolution llama: la de House (la misma de los enlaces de los avisos) + la instancia. */
export const urlWebhook = (instancia: string): string => `${canalesDeps.urlPublica().replace(/\/+$/, '')}/api/canales/whatsapp/${encodeURIComponent(instancia)}`;

/** Comparación en tiempo constante de dos hashes hex de 64 caracteres. */
export function hashesIguales(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * ¿El secreto presentado es el de ESA instancia? Devuelve la empresa o null. Se compara el hash (sha256) con el guardado, en tiempo constante;
 * con una instancia desconocida se compara igual contra un hash nulo para que el tiempo no delate cuáles existen.
 */
export async function autenticarWebhook(instancia: string, secreto: string | undefined): Promise<{ empresaId: number } | null> {
  const fila = await prisma.canalWebhook.findUnique({ where: { instancia }, select: { empresa_id: true, secreto_hash: true } });
  const iguales = hashesIguales(sha256(secreto ?? ''), fila?.secreto_hash ?? HASH_NULO);
  return fila && secreto && iguales ? { empresaId: fila.empresa_id } : null;
}

// Un registro a la vez por empresa: dos (sync y status) a la vez dejarían en Evolution un secreto y en la base otro.
const registrando = new Map<number, Promise<unknown>>();

/**
 * Deja registrado el webhook de la instancia en Evolution apuntando a House. El secreto (32 bytes aleatorios) sólo se guarda HASHEADO en la base;
 * el original vive en la configuración de Evolution. Idempotente: si ya está registrado para esa URL no hace nada, salvo `forzar` (rota el secreto).
 */
export async function registrarWebhook(empresaId: number, instancia: string, opts: { forzar?: boolean } = {}): Promise<'registrado' | 'ya_estaba'> {
  const anterior = registrando.get(empresaId) ?? Promise.resolve();
  const tarea = anterior.catch(() => undefined).then(async () => {
    const url = urlWebhook(instancia);
    const actual = await prisma.canalWebhook.findUnique({ where: { empresa_id: empresaId } });
    if (actual && actual.instancia === instancia && actual.url === url && !opts.forzar) return 'ya_estaba' as const;
    const secreto = randomBytes(32).toString('hex');
    await ponerWebhook(instancia, url, secreto);
    const datos = { instancia, url, secreto_hash: sha256(secreto), registrado_at: canalesDeps.ahora() };
    await prisma.canalWebhook.upsert({ where: { empresa_id: empresaId }, create: { empresa_id: empresaId, ...datos }, update: datos });
    return 'registrado' as const;
  });
  registrando.set(empresaId, tarea);
  try {
    return await tarea;
  } finally {
    if (registrando.get(empresaId) === tarea) registrando.delete(empresaId);
  }
}

/** Al desvincular la instancia el webhook ya no sirve: se borra para que Evolution (si siguiera llamando) reciba 401. */
export const quitarWebhook = (empresaId: number) => prisma.canalWebhook.deleteMany({ where: { empresa_id: empresaId } });

/**
 * ¿El secreto de la cabecera `X-Telegram-Bot-Api-Secret-Token` es el del bot GLOBAL y el bot está activo? Mismo método que WhatsApp: se compara
 * el hash con el guardado en tiempo constante, y sin bot (o pausado) se compara igual contra un hash nulo para que el tiempo no delate el estado.
 */
export async function autenticarWebhookTelegram(secreto: string | undefined): Promise<boolean> {
  const fila = await prisma.configuracionTelegram.findUnique({ where: { id: 1 }, select: { habilitado: true, secreto_hash: true, token_enc: true } });
  const activo = !!fila?.habilitado && !!fila.secreto_hash && !!fila.token_enc;
  const iguales = hashesIguales(sha256(secreto ?? ''), (activo ? fila.secreto_hash : null) ?? HASH_NULO);
  return activo && !!secreto && iguales;
}
