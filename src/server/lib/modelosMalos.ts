// Memoria negativa de modelos: si un proveedor dice que un modelo no existe (404) o no sirve, no se vuelve a intentar
// con NINGUNA clave de ese proveedor (la cuenta de modelos es compartida) hasta que venza la marca o el sync lo reviva.
// En memoria y a propósito sin persistir, como el enfriamiento de claves. El estado `deprecado` de la base es la parte durable.
import { cooldownDeps } from './cooldown';

export const MEMORIA_MODELO_MS = 10 * 60_000;

const hasta = new Map<string, number>();
const llave = (proveedor: string, modelo: string) => `${proveedor}|${modelo}`;

export function marcarModeloMalo(proveedor: string, modelo: string, ms = MEMORIA_MODELO_MS): void {
  hasta.set(llave(proveedor, modelo), cooldownDeps.ahora() + ms);
}

export function modeloMalo(proveedor: string, modelo: string, ahora = cooldownDeps.ahora()): boolean {
  const h = hasta.get(llave(proveedor, modelo));
  if (h === undefined) return false;
  if (h <= ahora) { hasta.delete(llave(proveedor, modelo)); return false; }
  return true;
}

export const olvidarModeloMalo = (proveedor: string, modelo: string) => { hasta.delete(llave(proveedor, modelo)); };
export const limpiarModelosMalos = () => { hasta.clear(); lentoHasta.clear(); };

/** Modelos marcados ahora, con el instante en que se les vuelve a dar una oportunidad. */
export function modelosMalosVigentes(ahora = cooldownDeps.ahora()): { proveedor: string; modelo: string; hasta: number }[] {
  const r: { proveedor: string; modelo: string; hasta: number }[] = [];
  for (const [k, h] of hasta) {
    if (h <= ahora) continue;
    const i = k.indexOf('|');
    r.push({ proveedor: k.slice(0, i), modelo: k.slice(i + 1), hasta: h });
  }
  return r;
}

// Memoria de modelos LENTOS (24-oct): un modelo que no contestó a tiempo NO se veta (podría ser la única ruta que queda), sólo pasa al
// final de la fila en todas las claves de su proveedor durante un rato. En producción `gemini-flash-latest` se colgaba > 40 s mientras
// `gemini-flash-lite-latest` contestaba en 3 s: así la siguiente consulta va directo al que sí responde.
export const MEMORIA_LENTO_MS = 15 * 60_000;
const lentoHasta = new Map<string, number>();

export function marcarLento(proveedor: string, modelo: string, ms = MEMORIA_LENTO_MS): void {
  lentoHasta.set(llave(proveedor, modelo), cooldownDeps.ahora() + ms);
}

export function esLento(proveedor: string, modelo: string, ahora = cooldownDeps.ahora()): boolean {
  const h = lentoHasta.get(llave(proveedor, modelo));
  if (h === undefined) return false;
  if (h <= ahora) { lentoHasta.delete(llave(proveedor, modelo)); return false; }
  return true;
}

export const limpiarLentos = () => lentoHasta.clear();
