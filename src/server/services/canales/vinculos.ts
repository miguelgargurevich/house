import { createHash, randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { canalesDeps } from './deps';
import { cargarAuthUser, empresasDelUsuario, perteneceAEmpresa } from './identidad';
import { limites } from './limites';

export const CANALES_BOT = ['whatsapp', 'telegram'] as const;
export type CanalBot = (typeof CANALES_BOT)[number];

export const VIGENCIA_CODIGO_MIN = 10;
/** Tras este número de intentos que ya identificaron al código (empresa ajena, número tomado…) el código muere. */
export const MAX_INTENTOS_CODIGO = 5;

const MIN = 60_000;
const hashCodigo = (canal: CanalBot, codigo: string) => createHash('sha256').update(`vinculo:${canal}:${codigo}`).digest('hex');
const claveVigente = (canal: CanalBot, identificador: string) => `${canal}:${identificador}`;
const claveUsuario = (usuarioId: number, canal: CanalBot) => `${usuarioId}:${canal}`;

/** `51987654321` → `+51 ••• ••• 321` (el número completo no sale en listados); un chat de Telegram → `Telegram ••• 321`. */
export const mascara = (identificador: string, canal: CanalBot = 'whatsapp'): string =>
  canal === 'telegram' ? `Telegram ••• ${identificador.slice(-3)}` : /^\d{8,15}$/.test(identificador) ? `+${identificador.slice(0, 2)} ••• ••• ${identificador.slice(-3)}` : `••• ${identificador.slice(-3)}`;

/** Empresa con la que se vincula un bot GLOBAL (Telegram): la del personal, o la primera con la que el residente tiene unidades. `null` si no tiene ninguna. */
async function empresaDe(u: { id: number; empresa_id: number | null }): Promise<number | null> {
  if (u.empresa_id != null) return u.empresa_id;
  return (await empresasDelUsuario(u)).sort((a, b) => a - b)[0] ?? null;
}

/** Normaliza lo que la persona escribió como código: seis dígitos, con o sin espacios o guion. `null` si no lo parece. */
export function leerCodigo(texto: string): string | null {
  const t = texto.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(t) ? t : null;
}

/** Un código vigente por usuario y canal: genera uno nuevo (6 dígitos, sin repetir otro vigente) y descarta el anterior. Sólo se guarda su hash. */
export async function generarCodigo(usuarioId: number, canal: CanalBot): Promise<{ codigo: string; expira_at: Date }> {
  const ahora = canalesDeps.ahora();
  const expira_at = new Date(ahora.getTime() + VIGENCIA_CODIGO_MIN * MIN);
  for (let i = 0; i < 20; i++) {
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codigo_hash = hashCodigo(canal, codigo);
    // Dos personas con el mismo código vigente harían ambigua la búsqueda: se vuelve a sortear.
    if (await prisma.codigoVinculacion.count({ where: { canal, codigo_hash, usado_at: null, expira_at: { gt: ahora } } })) continue;
    await prisma.$transaction([
      prisma.codigoVinculacion.deleteMany({ where: { usuario_id: usuarioId, canal } }),
      prisma.codigoVinculacion.create({ data: { usuario_id: usuarioId, canal, codigo_hash, expira_at } }),
    ]);
    return { codigo, expira_at };
  }
  throw new HttpError(503, 'No se pudo generar el código, inténtalo de nuevo');
}

export const listarVinculos = (usuarioId: number) =>
  prisma.canalVinculado.findMany({
    where: { usuario_id: usuarioId, revocado_at: null },
    orderBy: { id: 'asc' },
    select: { id: true, canal: true, identificador: true, verificado_at: true, empresa: { select: { id: true, nombre: true } } },
  });

/** Libera el número y el cupo del usuario: las claves únicas quedan en null y el vínculo en el historial. Devuelve si había algo que revocar. */
export async function revocarVinculo(where: Prisma.CanalVinculadoWhereInput): Promise<boolean> {
  const vigentes: Prisma.CanalVinculadoWhereInput = { ...where, revocado_at: null };
  await prisma.canalPendiente.deleteMany({ where: { vinculo: vigentes } }); // un voucher a medias no sobrevive al vínculo
  const r = await prisma.canalVinculado.updateMany({ where: vigentes, data: { revocado_at: canalesDeps.ahora(), clave_vigente: null, clave_usuario: null } });
  return r.count > 0;
}

/** El vínculo VIGENTE de un identificador de un canal (o null). */
export const vinculoVigente = (canal: CanalBot, identificador: string) =>
  prisma.canalVinculado.findUnique({ where: { clave_vigente: claveVigente(canal, identificador) } });

export type ResultadoVinculo = { ok: true; usuarioId: number; nombre: string } | { ok: false };

/**
 * Un mensaje con un código de seis dígitos desde un número SIN vínculo vigente. El número del mensaje es el que queda vinculado.
 * `empresaId: null` (bot global de Telegram): la empresa del vínculo sale de la persona dueña del código; sin ninguna, se rechaza.
 * Cualquier rechazo (código vencido, usado, ajeno a la empresa o con demasiados intentos) es idéntico para quien escribe: `{ ok: false }`, sin pistas.
 * Los fallos se cuentan por número y por empresa: pasado el tope se rechaza TODO, también el código bueno, sin mirar la base.
 */
export async function intentarVincular(o: { canal: CanalBot; identificador: string; empresaId: number | null; texto: string }): Promise<ResultadoVinculo> {
  const { canal, identificador } = o;
  const kNumero = `${canal}:${identificador}`;
  // Bot global: no hay empresa antes de identificar el código, así que los fallos se cuentan en un solo cubo del canal.
  const kEmpresa = `${canal}:${o.empresaId ?? 'global'}`;
  const cubo = o.empresaId == null ? limites.fallosGlobal : limites.fallosEmpresa;
  if (limites.fallosNumero.llena(kNumero) || cubo.llena(kEmpresa)) return { ok: false };
  const fallo = (): ResultadoVinculo => {
    limites.fallosNumero.golpear(kNumero);
    cubo.golpear(kEmpresa);
    return { ok: false };
  };
  const codigo = leerCodigo(o.texto);
  if (!codigo) return fallo();
  const ahora = canalesDeps.ahora();
  const fila = await prisma.codigoVinculacion.findFirst({
    where: { canal, codigo_hash: hashCodigo(canal, codigo), usado_at: null, expira_at: { gt: ahora }, intentos: { lt: MAX_INTENTOS_CODIGO } },
  });
  if (!fila) return fallo();
  const rechazar = async (): Promise<ResultadoVinculo> => {
    await prisma.codigoVinculacion.update({ where: { id: fila.id }, data: { intentos: { increment: 1 } } });
    return fallo();
  };
  const user = await cargarAuthUser(fila.usuario_id);
  const empresaId = user ? o.empresaId ?? (await empresaDe(user)) : null;
  if (!user || empresaId == null || !(await perteneceAEmpresa(user, empresaId))) return rechazar();
  try {
    await prisma.$transaction(async (tx) => {
      // El código se gasta UNA vez: de dos mensajes simultáneos con el mismo código, sólo uno pasa de «sin usar» a «usado».
      const gastado = await tx.codigoVinculacion.updateMany({ where: { id: fila.id, usado_at: null }, data: { usado_at: ahora } });
      if (gastado.count !== 1) throw new Error('codigo-gastado');
      // Un solo vínculo vigente por persona y canal: el anterior (otro número) se revoca.
      await tx.canalVinculado.updateMany({ where: { usuario_id: user.id, canal, revocado_at: null }, data: { revocado_at: ahora, clave_vigente: null, clave_usuario: null } });
      await tx.canalVinculado.create({
        data: { usuario_id: user.id, canal, identificador, empresa_id: empresaId, verificado_at: ahora, clave_vigente: claveVigente(canal, identificador), clave_usuario: claveUsuario(user.id, canal) },
      });
    });
  } catch {
    // Número ya vinculado a otra persona (clave única), código gastado a la vez, etc.: mismo rechazo sin pistas.
    return rechazar();
  }
  const u = await prisma.usuario.findUnique({ where: { id: user.id }, select: { nombre: true } });
  return { ok: true, usuarioId: user.id, nombre: u?.nombre ?? '' };
}
