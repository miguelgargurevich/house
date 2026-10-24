// Sincronización del catálogo vivo de modelos (como `syncService` de My Workspace): por clave, `GET {base}/models` y comparar con lo guardado.
//  - modelo nuevo → se inserta y se ACTIVA solo (queda en el historial);
//  - modelo que ya no aparece → `deprecado` con fecha (NO se borra; jamás se usa para ruteo);
//  - modelo deprecado que reaparece → `activo` de nuevo.
// Una lista vacía, ilegible o un error del proveedor NO deprecan nada: una caída del proveedor no debe dejar la clave sin modelos.
import { Prisma } from '@prisma/client';
import { isProduction } from '../../config';
import { prisma } from '../../db';
import { cooldownDeps } from '../../lib/cooldown';
import { clasificarModelo, esGratis, esModeloDeChat, leerListaModelos } from '../../lib/modelosIA';
import { olvidarModeloMalo } from '../../lib/modelosMalos';
import { proveedorPorId } from '../../lib/proveedoresIA';
import { aadClave, descifrar, llaveroConfigurado } from '../../lib/secretBox';
import { cabecerasDe, detalleDeEstadoHttp, llaveroDeps } from '../llavero';
import { ESTADO_RECHAZADA } from '../rotacion';
import { elegirModeloAuto } from './seleccion';

export const TOPE_SYNC_MS = 10_000;
/** Cada cuánto se sincroniza (en proceso) y cuándo la primera pasada tras arrancar. */
export const CADA_SYNC_MS = 6 * 3_600_000;
export const PRIMERA_PASADA_MS = 60_000;
/** Clave del bloqueo asesor de Postgres: sólo una réplica sincroniza a la vez. */
export const LOCK_MODELOS = 7_302_302;
/** Historial que se conserva por clave. */
const HISTORIAL_MAX = 50;
const DETALLE_MAX = 25;

/** Puntos de inyección: `fetch` (el del llavero) y el reloj (el del cooldown). */
export const syncDeps = {
  fetch: (url: string, init?: RequestInit) => llaveroDeps.fetch(url, init),
  ahora: (): Date => new Date(cooldownDeps.ahora()),
};

export interface ResultadoSync {
  ok: boolean;
  /** Estado HTTP de `GET /models` (null si hubo error de red). */
  status: number | null;
  nuevos: number;
  deprecados: number;
  revividos: number;
  total: number;
  error: string | null;
  /** Texto para la pantalla si el modelo fijado dejó de existir. */
  avisoModelo: string | null;
}

const vacio = (status: number | null, error: string | null): ResultadoSync => ({ ok: false, status, nuevos: 0, deprecados: 0, revividos: 0, total: 0, error, avisoModelo: null });

/** `MODELOS_SYNC=on|off`; sin definir, activo sólo en producción (en las pruebas está apagado). */
export function sincronizacionActiva(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.MODELOS_SYNC?.trim().toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return isProduction(env);
}

async function registrar(claveId: number, r: ResultadoSync, detalle?: Prisma.InputJsonValue) {
  await prisma.syncModelosIA.create({ data: { clave_id: claveId, ok: r.ok, nuevos: r.nuevos, deprecados: r.deprecados, revividos: r.revividos, total: r.total, error: r.error, ...(detalle ? { detalle } : {}) } });
  const viejos = await prisma.syncModelosIA.findMany({ where: { clave_id: claveId }, orderBy: { id: 'desc' }, skip: HISTORIAL_MAX, select: { id: true } });
  if (viejos.length) await prisma.syncModelosIA.deleteMany({ where: { id: { in: viejos.map((v) => v.id) } } });
}

/** Sincroniza los modelos de UNA clave (la use quien la use). Nunca lanza: el resultado dice si salió bien. */
export async function sincronizarClave(claveId: number): Promise<ResultadoSync | null> {
  if (!llaveroConfigurado()) return null;
  const f = await prisma.claveIntegracion.findUnique({ where: { id: claveId } });
  const p = f ? proveedorPorId(f.proveedor) : undefined;
  if (!f || !p) return null;

  let resp: Response;
  let cuerpo: unknown = null;
  try {
    const clave = descifrar(f.api_key_enc, aadClave(f.proveedor, f.etiqueta));
    resp = await syncDeps.fetch(`${p.baseUrl}/models`, { method: 'GET', headers: { Accept: 'application/json', ...cabecerasDe(p, clave) }, redirect: 'manual', signal: AbortSignal.timeout(TOPE_SYNC_MS) });
    if (resp.ok) cuerpo = await resp.json().catch(() => null);
    else await resp.body?.cancel().catch(() => undefined);
  } catch (err) {
    const nombre = err instanceof Error ? err.name : '';
    const r = vacio(null, nombre === 'TimeoutError' || nombre === 'AbortError' ? 'El proveedor no respondió a tiempo' : 'No se pudo conectar con el proveedor');
    console.warn(`[modelos] la sincronización de ${f.proveedor}#${f.id} falló (${nombre || 'error'})`);
    await registrar(claveId, r);
    return r;
  }
  if (!resp.ok) {
    const r = vacio(resp.status, detalleDeEstadoHttp(resp.status));
    await registrar(claveId, r);
    return r;
  }
  const lista = leerListaModelos(p, cuerpo);
  if (lista === null || lista.length === 0) {
    const r = vacio(resp.status, lista === null ? 'El proveedor devolvió una lista ilegible' : 'El proveedor devolvió una lista vacía');
    await registrar(claveId, r);
    return r;
  }

  const ahora = syncDeps.ahora();
  const guardados = await prisma.modeloIA.findMany({ where: { clave_id: claveId } });
  const porId = new Map(guardados.map((m) => [m.modelo_id, m]));
  const listados = new Set(lista.map((m) => m.modelo_id));
  const nuevos: string[] = [];
  const revividos: string[] = [];
  const deprecados: string[] = [];
  const aCrear: Prisma.ModeloIACreateManyInput[] = [];
  const sinCambios: number[] = [];

  for (const m of lista) {
    const categoria = clasificarModelo(m.modelo_id);
    const gratis = esGratis(f.proveedor, m.modelo_id);
    const previo = porId.get(m.modelo_id);
    if (!previo) {
      aCrear.push({ clave_id: claveId, modelo_id: m.modelo_id, nombre: m.nombre, categoria, estado: 'activo', gratis, ventana: m.ventana, vision: m.vision, visto_at: ahora });
      if (esModeloDeChat(m.modelo_id)) nuevos.push(m.modelo_id);
      continue;
    }
    const revive = previo.estado === 'deprecado';
    const cambio = revive || previo.estado !== 'activo' || previo.nombre !== m.nombre || previo.categoria !== categoria || previo.gratis !== gratis || previo.ventana !== m.ventana || previo.vision !== m.vision;
    if (!cambio) { sinCambios.push(previo.id); continue; }
    await prisma.modeloIA.update({
      where: { id: previo.id },
      data: { nombre: m.nombre, categoria, gratis, ventana: m.ventana, vision: m.vision, visto_at: ahora, estado: 'activo', ...(revive ? { deprecado_at: null } : {}) },
    });
    if (revive && esModeloDeChat(m.modelo_id)) {
      revividos.push(m.modelo_id);
      olvidarModeloMalo(f.proveedor, m.modelo_id); // el sync lo reviva → vuelve a ser candidato
    }
  }
  if (sinCambios.length) await prisma.modeloIA.updateMany({ where: { id: { in: sinCambios } }, data: { visto_at: ahora } });
  if (aCrear.length) await prisma.modeloIA.createMany({ data: aCrear, skipDuplicates: true });
  for (const previo of guardados) {
    if (listados.has(previo.modelo_id) || previo.estado === 'deprecado') continue;
    await prisma.modeloIA.update({ where: { id: previo.id }, data: { estado: 'deprecado', deprecado_at: ahora } });
    if (previo.categoria !== 'otro') deprecados.push(previo.modelo_id);
  }

  // Si el modelo fijado en la clave ya no existe, la clave vuelve a elección automática y la pantalla lo dice.
  let avisoModelo: string | null = null;
  if (f.modelo && !listados.has(f.modelo)) {
    const nuevoModelo = await elegirModeloAuto({ claveId, proveedor: p, modelo: null });
    avisoModelo = `El modelo ${f.modelo} ya no existe; ahora usa ${nuevoModelo}`;
    await prisma.claveIntegracion.update({ where: { id: claveId }, data: { modelo: null, aviso_modelo: avisoModelo }, select: { id: true } });
  }

  const chatListados = lista.filter((m) => esModeloDeChat(m.modelo_id)).length;
  const r: ResultadoSync = { ok: true, status: resp.status, nuevos: nuevos.length, deprecados: deprecados.length, revividos: revividos.length, total: chatListados, error: null, avisoModelo };
  await registrar(claveId, r, {
    nuevos: nuevos.slice(0, DETALLE_MAX),
    deprecados: deprecados.slice(0, DETALLE_MAX),
    revividos: revividos.slice(0, DETALLE_MAX),
    ...(avisoModelo ? { aviso: avisoModelo } : {}),
  });
  return r;
}

/** Sincroniza todas las claves habilitadas y no rechazadas, de una en una (una caída no frena a las demás). */
export async function sincronizarTodas(): Promise<{ claves: number; ok: number }> {
  if (!llaveroConfigurado()) return { claves: 0, ok: 0 };
  const claves = await prisma.claveIntegracion.findMany({ where: { habilitada: true, estado: { not: ESTADO_RECHAZADA } }, select: { id: true }, orderBy: { id: 'asc' } });
  let ok = 0;
  for (const { id } of claves) {
    try {
      if ((await sincronizarClave(id))?.ok) ok++;
    } catch (err) {
      console.error('[modelos] falló una sincronización', err instanceof Error ? err.name : 'error');
    }
  }
  return { claves: claves.length, ok };
}

// ---------- Segundo plano ----------
const enCurso = new Set<Promise<unknown>>();

/** Al guardar o cambiar una clave (sólo si `MODELOS_SYNC` está activo): no bloquea la respuesta. */
export function sincronizarEnSegundoPlano(claveId: number): void {
  if (!sincronizacionActiva()) return;
  const p: Promise<unknown> = sincronizarClave(claveId)
    .catch((err) => console.error('[modelos] falló una sincronización', err instanceof Error ? err.name : 'error'))
    .finally(() => { enCurso.delete(p); });
  enCurso.add(p);
}

/** Gancho de pruebas: espera a las sincronizaciones en segundo plano. */
export async function esperarSincronizaciones(): Promise<void> {
  while (enCurso.size) await Promise.allSettled([...enCurso]);
}

/**
 * Una pasada periódica: sincroniza todas las claves. El bloqueo es `pg_try_advisory_xact_lock` dentro de una transacción
 * (el de sesión se pierde con el pool de Prisma): se suelta solo al terminar o si el proceso muere. `null` = otra réplica tiene el turno.
 */
export async function pasadaDeSync(): Promise<{ claves: number; ok: number } | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>(Prisma.sql`SELECT pg_try_advisory_xact_lock(${LOCK_MODELOS}) AS ok`);
      if (!ok) return null;
      return sincronizarTodas();
    },
    { timeout: 10 * 60_000, maxWait: 10_000 },
  );
}
