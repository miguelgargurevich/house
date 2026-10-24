import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { isProduction } from '../../config';
import { depsReales, type DepsAvisos } from './canales';
import { encolarRecordatorios, procesarCola } from './cola';

/** Clave del bloqueo asesor de Postgres: sólo una réplica trabaja a la vez. */
export const LOCK_AVISOS = 7_302_301;
export const CADA_MS = 15 * 60_000;

/** `AVISOS_PLANIFICADOR=on|off`; sin definir, activo sólo en producción. */
export function planificadorActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.AVISOS_PLANIFICADOR?.trim().toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return isProduction(env);
}

/**
 * Un ciclo: encola recordatorios y procesa la cola. El bloqueo es `pg_try_advisory_xact_lock` dentro de una
 * transacción (el `pg_try_advisory_lock` de sesión se pierde con el pool de conexiones de Prisma): se suelta solo
 * al terminar o si el proceso muere. Devuelve `null` si otra réplica tiene el turno.
 */
export async function ciclo(deps: DepsAvisos = depsReales()) {
  return prisma.$transaction(
    async (tx) => {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>(Prisma.sql`SELECT pg_try_advisory_xact_lock(${LOCK_AVISOS}) AS ok`);
      if (!ok) return null;
      const encoladas = await encolarRecordatorios(deps.ahora());
      return { encoladas, ...(await procesarCola(deps)) };
    },
    { timeout: 10 * 60_000, maxWait: 10_000 },
  );
}

let enMarcha = false;
const seguro = async () => {
  if (enMarcha) return; // un ciclo lento no se encima con el siguiente
  enMarcha = true;
  try {
    await ciclo();
  } catch (err) {
    console.error('[avisos] el ciclo falló:', err instanceof Error ? err.message : 'error');
  } finally {
    enMarcha = false;
  }
};

/** Arranca el planificador en proceso (primer ciclo a los 30 s, luego cada 15 min). Devuelve `detener`. */
export function iniciarPlanificador(): () => void {
  const primero = setTimeout(() => void seguro(), 30_000);
  const t = setInterval(() => void seguro(), CADA_MS);
  primero.unref();
  t.unref();
  console.log('[avisos] planificador activo (cada 15 min)');
  return () => { clearTimeout(primero); clearInterval(t); };
}

/** Procesa la cola sin esperar al siguiente ciclo (p. ej. tras emitir un recibo). Sólo si el planificador está activo. */
export function procesarPronto(): void {
  if (!planificadorActivo()) return;
  setTimeout(() => void seguro(), 1_000).unref();
}
