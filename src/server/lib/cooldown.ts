// Enfriamiento de claves de IA, en memoria y a propósito sin persistir: al reiniciar el proceso todo vuelve a empezar.
// Un 429 enfría ESA clave (no el proveedor entero). Identidad: `${proveedor}#${claveId}`.

/** Punto de inyección del reloj (las pruebas lo reemplazan; nunca se duerme de verdad). */
export const cooldownDeps = { ahora: (): number => Date.now() };

export const ESPERA_MIN_MS = 1_000;
export const ESPERA_MAX_MS = 5 * 60_000;
export const ESPERA_POR_DEFECTO_MS = 60_000;
export const ESPERA_TRANSITORIA_MS = 30_000;

const hasta = new Map<string, number>();

export const claveCooldown = (proveedor: string, claveId: number | string) => `${proveedor}#${claveId}`;

const acotar = (ms: number) => Math.min(ESPERA_MAX_MS, Math.max(ESPERA_MIN_MS, ms));

/**
 * Espera que pide el proveedor, en ms, o null si no dijo nada utilizable. Acepta `Retry-After` en segundos (`42`),
 * como fecha HTTP, y `"retryDelay":"50s"` dentro del cuerpo (Gemini). No aplica las cotas: eso lo hace `registrarEstado`.
 */
export function parsearRetryAfter(cabecera?: string | null, cuerpo?: string | null, ahora = cooldownDeps.ahora()): number | null {
  const c = cabecera?.trim();
  if (c) {
    if (/^\d+(\.\d+)?$/.test(c)) return Math.round(Number(c) * 1000);
    const fecha = Date.parse(c);
    if (!Number.isNaN(fecha)) return Math.max(0, fecha - ahora);
  }
  const m = cuerpo ? /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(cuerpo) : null;
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/** 429 → enfría con `Retry-After` (1 s–5 min; 60 s si no dice nada). 5xx, timeout o red (status 0) → 30 s fijos. Lo demás no enfría. */
export function registrarEstado(id: string, status: number, retryAfterMs?: number | null): void {
  let espera: number;
  if (status === 429) espera = retryAfterMs == null ? ESPERA_POR_DEFECTO_MS : acotar(retryAfterMs);
  else if (status === 0 || status >= 500) espera = ESPERA_TRANSITORIA_MS;
  else return;
  hasta.set(id, cooldownDeps.ahora() + espera);
}

/** Instante (ms) hasta el que la clave sigue enfriada, o null. */
export function enfriandoHasta(id: string, ahora = cooldownDeps.ahora()): number | null {
  const h = hasta.get(id);
  return h !== undefined && h > ahora ? h : null;
}

export const estaEnfriando = (id: string, ahora = cooldownDeps.ahora()) => enfriandoHasta(id, ahora) !== null;

export function limpiar(id: string): void {
  hasta.delete(id);
}

export function limpiarProveedor(proveedor: string): void {
  for (const id of [...hasta.keys()]) if (id.startsWith(`${proveedor}#`)) hasta.delete(id);
}

export function limpiarTodo(): void {
  hasta.clear();
}

/** Claves enfriadas ahora, con su instante de fin. */
export function snapshot(ahora = cooldownDeps.ahora()): Record<string, number> {
  const r: Record<string, number> = {};
  for (const [id, h] of hasta) if (h > ahora) r[id] = h;
  return r;
}
