// Tokens de API personales de SOLO LECTURA para el endpoint MCP (`POST /mcp`). El token se muestra UNA vez al crearlo; en la base sólo
// queda su sha256. Hereda el rol y el alcance de su dueño (se relee al usuario en cada llamada) y deja de valer si el dueño se desactiva
// o cambia su rol o su contraseña (la «huella»); el alcance (empresa, junta) se relee en cada llamada. El Bearer sólo lo lee `/mcp`.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Rol } from '../config';
import { prisma } from '../db';
import { forbidden, invalid } from '../errors';
import { cooldownDeps } from '../lib/cooldown';
import type { AuthUser } from '../middleware/auth';
import { herramientasDe } from '../tools';

export const PREFIJO_TOKEN = 'hse_';
export const MAX_TOKENS_ACTIVOS = 5;
export const DIAS_POR_DEFECTO = 90;
export const DIAS_MAXIMOS = 365;
const DIA_MS = 86_400_000;
/** `ultimo_uso` se actualiza como mucho una vez por minuto (no hay una escritura por llamada). */
const TOQUE_MS = 60_000;
/** hse_ + 43 caracteres base64url (32 bytes aleatorios). */
const FORMATO = /^hse_[A-Za-z0-9_-]{43}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ahora = () => new Date(cooldownDeps.ahora());

/** Rol y contraseña del dueño: si cambia cualquiera, el token deja de valer. El alcance (empresa, cargo de junta, block) NO va aquí: se relee en cada llamada y el token lo hereda tal cual. */
interface DuenoHuella { rol: string | null; password_hash: string | null }
export const huellaDe = (u: DuenoHuella): string => sha256(JSON.stringify([u.rol, u.password_hash]));
/** El hash se pide a propósito (sólo para la huella): `select` explícito pisa el `omit` global. */
const selectDueno = { id: true, email: true, rol: true, empresa_id: true, complejo_id: true, cargo_junta: true, estructura_id: true, password_hash: true } as const;

export interface FilaToken { id: string; nombre: string; prefijo: string; creado: string; ultimo_uso: string | null; vence: string; estado: 'activo' | 'vencido' | 'revocado' | 'invalidado' }

const estadoDe = (t: { expira: Date; revocado_at: Date | null; huella: string }, huellaActual: string, ahoraD: Date): FilaToken['estado'] =>
  t.revocado_at ? 'revocado' : t.expira <= ahoraD ? 'vencido' : t.huella !== huellaActual ? 'invalidado' : 'activo';

export async function listarTokens(userId: number): Promise<FilaToken[]> {
  const dueno = await prisma.usuario.findUniqueOrThrow({ where: { id: userId }, select: selectDueno });
  const filas = await prisma.tokenApi.findMany({ where: { usuario_id: userId }, orderBy: { created_at: 'desc' }, take: 50 });
  const h = huellaDe(dueno);
  const a = ahora();
  return filas.map((t) => ({ id: t.id, nombre: t.nombre, prefijo: t.prefijo, creado: t.created_at.toISOString(), ultimo_uso: t.ultimo_uso?.toISOString() ?? null, vence: t.expira.toISOString(), estado: estadoDe(t, h, a) }));
}

/** Crea el token. Devuelve el texto completo UNA sola vez. */
export async function crearToken(u: AuthUser, nombre: string, dias: number = DIAS_POR_DEFECTO): Promise<FilaToken & { token: string }> {
  if (herramientasDe(u).length === 0) throw forbidden('Tu perfil no tiene herramientas de consulta, así que no necesita un token');
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_MAXIMOS) throw invalid(`Datos inválidos: dias: entre 1 y ${DIAS_MAXIMOS}`, { dias: `Entre 1 y ${DIAS_MAXIMOS}` });
  const dueno = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: selectDueno });
  const h = huellaDe(dueno);
  const a = ahora();
  const activos = (await prisma.tokenApi.findMany({ where: { usuario_id: u.id, revocado_at: null, expira: { gt: a } }, select: { huella: true } })).filter((t) => t.huella === h).length;
  if (activos >= MAX_TOKENS_ACTIVOS) throw invalid(`Ya tienes ${MAX_TOKENS_ACTIVOS} tokens activos: revoca alguno para crear otro`, { nombre: `Máximo ${MAX_TOKENS_ACTIVOS} tokens activos` });
  const token = `${PREFIJO_TOKEN}${randomBytes(32).toString('base64url')}`;
  const fila = await prisma.tokenApi.create({
    data: { usuario_id: u.id, nombre, prefijo: token.slice(0, 8), hash: sha256(token), huella: h, expira: new Date(a.getTime() + dias * DIA_MS) },
  });
  return { id: fila.id, nombre: fila.nombre, prefijo: fila.prefijo, creado: fila.created_at.toISOString(), ultimo_uso: null, vence: fila.expira.toISOString(), estado: 'activo', token };
}

/** Revoca un token PROPIO. false si no existe, no es suyo o ya estaba revocado. */
export async function revocarToken(userId: number, id: string): Promise<boolean> {
  const r = await prisma.tokenApi.updateMany({ where: { id, usuario_id: userId, revocado_at: null }, data: { revocado_at: ahora() } });
  return r.count > 0;
}

export interface TokenValido { tokenId: string; usuario: AuthUser }

/**
 * Valida un token del encabezado `Authorization: Bearer`. null = no vale (formato, desconocido, revocado, vencido, dueño desactivado o
 * cambiado). Se busca por prefijo y se compara el hash en tiempo constante; el usuario se relee de la base en CADA llamada.
 */
export async function autenticarToken(token: string): Promise<TokenValido | null> {
  if (!FORMATO.test(token)) return null;
  const esperado = Buffer.from(sha256(token), 'hex');
  const candidatos = await prisma.tokenApi.findMany({ where: { prefijo: token.slice(0, 8) }, take: 50 });
  const t = candidatos.find((c) => {
    const real = Buffer.from(c.hash, 'hex');
    return real.length === esperado.length && timingSafeEqual(real, esperado);
  });
  if (!t) return null;
  const a = ahora();
  if (t.revocado_at || t.expira <= a) return null;
  const u = await prisma.usuario.findUnique({ where: { id: t.usuario_id }, select: selectDueno });
  if (!u || !u.rol || huellaDe(u) !== t.huella) return null;
  if (!t.ultimo_uso || a.getTime() - t.ultimo_uso.getTime() >= TOQUE_MS) await prisma.tokenApi.update({ where: { id: t.id }, data: { ultimo_uso: a } }).catch(() => undefined);
  return { tokenId: t.id, usuario: { id: u.id, email: u.email, rol: u.rol as Rol, empresa_id: u.empresa_id, complejo_id: u.complejo_id, cargo_junta: u.cargo_junta, estructura_id: u.estructura_id } };
}

/** Borra tokens vencidos hace más de 30 días o revocados hace más de 30 días. */
export const limpiarTokens = async () => (await prisma.tokenApi.deleteMany({ where: { OR: [{ expira: { lt: new Date(cooldownDeps.ahora() - 30 * DIA_MS) } }, { revocado_at: { lt: new Date(cooldownDeps.ahora() - 30 * DIA_MS) } }] } })).count;
