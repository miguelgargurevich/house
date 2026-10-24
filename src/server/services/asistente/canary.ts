// Salud proactiva («canary»): una consulta mínima a un proveedor (con una clave sana, rotando) para detectar un proveedor caído o un modelo
// retirado ANTES de que lo sufra un vecino. El resultado alimenta el enfriamiento y el estado visible. Presupuesto bajo: máx. 50 consultas al día
// en total; para alcanzar cada 30 min sin pasarse, cada pasada revisa a los proveedores más rezagados (rotando), no a todos a la vez.
import { Prisma } from '@prisma/client';
import { isProduction } from '../../config';
import { prisma } from '../../db';
import { claveCooldown, cooldownDeps, estaEnfriando, limpiar, registrarEstado } from '../../lib/cooldown';
import { llaveroConfigurado } from '../../lib/secretBox';
import { ESTADO_RECHAZADA, eslabonDeFila, rechazarClave } from '../rotacion';
import { pruebaDeChat } from './prueba';
import { actualizarSalud, anotarCausa, olvidarCausa } from './salud';

export const CADA_CANARY_MS = 30 * 60_000;
export const PRIMERA_PASADA_CANARY_MS = 90_000;
export const PRESUPUESTO_DIARIO = 50;
/** Clave del bloqueo asesor de Postgres: sólo una réplica hace el canary a la vez. */
export const LOCK_CANARY = 7_302_303;

/** `ASISTENTE_CANARY=on|off`; sin definir, activo sólo en producción (en las pruebas está apagado). */
export function canaryActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.ASISTENTE_CANARY?.trim().toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return isProduction(env);
}

const LIMA_MS = 5 * 3_600_000;
const diaLima = (ms: number) => Math.floor((ms - LIMA_MS) / 86_400_000);
const finDelDiaLima = (ms: number) => (diaLima(ms) + 1) * 86_400_000 + LIMA_MS;

// Presupuesto y turnos en memoria (por proceso); el bloqueo entre réplicas evita que dos lo gasten a la vez.
let consumo = { dia: -1, n: 0 };
const ultimoChequeo = new Map<string, number>();
const turnoClave = new Map<string, number>();
export const reiniciarCanary = () => { consumo = { dia: -1, n: 0 }; ultimoChequeo.clear(); turnoClave.clear(); };
export const consumoDelDia = (ahora = cooldownDeps.ahora()) => (consumo.dia === diaLima(ahora) ? consumo.n : 0);

export interface ResultadoCanary { consultas: number; resultados: { proveedor: string; clave_id: number; modelo: string; tipo: string }[]; presupuesto_restante: number }

/**
 * Una pasada. Elige los proveedores más rezagados (hasta `maxPorPasada`, por omisión lo que el presupuesto del resto del día permita a
 * una consulta por pasada de 30 min), y por proveedor UNA clave sana (habilitada, no rechazada, no enfriada), rotando entre ellas.
 */
export async function ejecutarCanary(opts: { maxPorPasada?: number } = {}): Promise<ResultadoCanary> {
  const ahora = cooldownDeps.ahora();
  if (consumo.dia !== diaLima(ahora)) consumo = { dia: diaLima(ahora), n: 0 };
  const restante = PRESUPUESTO_DIARIO - consumo.n;
  const vacio: ResultadoCanary = { consultas: 0, resultados: [], presupuesto_restante: Math.max(0, restante) };
  if (restante <= 0 || !llaveroConfigurado()) return vacio;

  const pasadasQueQuedan = Math.max(1, Math.floor((finDelDiaLima(ahora) - ahora) / CADA_CANARY_MS));
  const porPasada = Math.max(1, Math.min(opts.maxPorPasada ?? Math.floor(restante / pasadasQueQuedan), restante));

  const filas = await prisma.claveIntegracion.findMany({ where: { habilitada: true, estado: { not: ESTADO_RECHAZADA } }, orderBy: [{ proveedor: 'asc' }, { id: 'asc' }] });
  const porProveedor = new Map<string, typeof filas>();
  for (const f of filas) {
    if (estaEnfriando(claveCooldown(f.proveedor, f.id), ahora)) continue; // las enfriadas ya tienen su espera
    porProveedor.set(f.proveedor, [...(porProveedor.get(f.proveedor) ?? []), f]);
  }
  const orden = [...porProveedor.keys()].sort((a, b) => (ultimoChequeo.get(a) ?? 0) - (ultimoChequeo.get(b) ?? 0) || a.localeCompare(b));
  const salida: ResultadoCanary = { consultas: 0, resultados: [], presupuesto_restante: restante };

  for (const proveedor of orden.slice(0, porPasada)) {
    const claves = porProveedor.get(proveedor)!;
    const turno = turnoClave.get(proveedor) ?? 0;
    const f = claves[turno % claves.length]!; // rota entre las claves sanas del proveedor
    turnoClave.set(proveedor, turno + 1);
    const e = eslabonDeFila(f);
    if (!e) continue;
    consumo.n++;
    ultimoChequeo.set(proveedor, ahora);
    const p = await pruebaDeChat(e);
    salida.consultas++;
    salida.presupuesto_restante = PRESUPUESTO_DIARIO - consumo.n;
    salida.resultados.push({ proveedor, clave_id: f.id, modelo: p.modelo, tipo: p.tipo });
    // El resultado alimenta el enfriamiento y el estado visible.
    switch (p.tipo) {
      case 'ok': limpiar(e.cooldownKey); olvidarCausa(e.cooldownKey); break;
      case 'limite': registrarEstado(e.cooldownKey, 429, p.fallo?.retryAfterMs); anotarCausa(e.cooldownKey, 'limite', 429); break;
      case 'caido': case 'red': case 'tiempo': registrarEstado(e.cooldownKey, p.fallo?.status || 0); anotarCausa(e.cooldownKey, 'caido', p.fallo?.status || null); break;
      case 'rechazada': await rechazarClave(e, p.fallo?.status ?? 401); break;
      case 'sin_saldo': await rechazarClave(e, 402); break;
      default: break; // 'modelo' ya lo retiró pruebaDeChat; 'sin_texto' y 'peticion' no culpan a la clave
    }
  }
  if (salida.consultas > 0) await actualizarSalud();
  return salida;
}

/** Una pasada con el bloqueo entre réplicas (`pg_try_advisory_xact_lock` dentro de una transacción). `null` = otra réplica tiene el turno. */
export async function pasadaDeCanary(): Promise<ResultadoCanary | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>(Prisma.sql`SELECT pg_try_advisory_xact_lock(${LOCK_CANARY}) AS ok`);
      if (!ok) return null;
      return ejecutarCanary();
    },
    { timeout: 5 * 60_000, maxWait: 10_000 },
  );
}
