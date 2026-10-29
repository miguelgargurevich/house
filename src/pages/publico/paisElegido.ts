// País elegido para los precios de /precios. Va aparte del catálogo (que pide a la API) para que el selector no arrastre la red.
// Se recuerda por visitante en localStorage, que puede no estar (modo privado, datos bloqueados): todo acceso va en try/catch.
import { useSyncExternalStore } from 'react';

const CLAVE_PAIS = 'house.precios.pais';
const leerPais = (): string | null => { try { return window.localStorage.getItem(CLAVE_PAIS); } catch { return null; } };
const guardarPais = (p: string): void => { try { window.localStorage.setItem(CLAVE_PAIS, p); } catch { /* sin almacenamiento: la elección vale sólo para esta visita */ } };

let elegido: string | null = null;
let leido = false;
const oyentes = new Set<() => void>();
export const paisElegido = (): string | null => { if (!leido) { leido = true; elegido = leerPais(); } return elegido; };

/** Cambia el país de los precios (lo recuerda y avisa a todo el que lo muestre: el marco y la página de precios comparten la elección). */
export function elegirPais(codigo: string): void {
  elegido = codigo;
  leido = true;
  guardarPais(codigo);
  oyentes.forEach(f => f());
}
export const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };

/** El país elegido en este navegador (o `null`): se actualiza solo cuando alguien lo cambia. */
export const usePaisElegido = (): string | null => useSyncExternalStore(suscribir, paisElegido, () => null);
