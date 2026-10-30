import { createContext, useCallback, useContext, useState } from 'react';

/** Un condominio del alcance del usuario, con su empresa (el superadmin los ve agrupados por empresa). */
export interface CondominioOpcion { id: number; nombre: string; empresa: { id: number; nombre: string } | null }

/**
 * Pantallas de la administración que se filtran por el condominio de la barra superior. Sólo en ellas el selector se muestra y las listas
 * lo aplican: «Conceptos» es de toda la empresa (no tiene condominio), las fichas y «Mi empresa» tienen el suyo, y un recibo abierto ya
 * es de un condominio concreto.
 */
const RUTAS_CON_CONDOMINIO = [
  '/admin/dashboard', '/admin/pagos', '/admin/medios-pago', '/admin/morosidad', '/admin/unidades', '/admin/mantenimientos',
  '/admin/comunicados', '/admin/avisos', '/admin/juntas', '/admin/residentes', '/admin/personal', '/admin/proveedores',
];

export function rutaUsaCondominio(pathname: string): boolean {
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return ruta === '/admin/recibos' || RUTAS_CON_CONDOMINIO.includes(ruta);
}

const claveGuardado = (usuarioId: number) => `house.condominio.${usuarioId}`;

/** Lo que el usuario eligió la vez anterior en este navegador: un id, `null` = «Todos», `undefined` = nunca eligió (o no hay almacenamiento). */
export function leerGuardado(usuarioId: number): number | null | undefined {
  try {
    const v = localStorage.getItem(claveGuardado(usuarioId));
    if (v === null) return undefined;
    if (v === 'todos') return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  } catch { return undefined; }
}

export function guardar(usuarioId: number, id: number | null) {
  try { localStorage.setItem(claveGuardado(usuarioId), id === null ? 'todos' : String(id)); } catch { /* sin almacenamiento */ }
}

/**
 * El condominio que vale de verdad: con uno solo, ése (su nombre queda fijo); si lo guardado ya no está en el alcance del usuario
 * (lo borraron o dejó de administrarlo), vuelve a «Todos» (`null`). Nunca devuelve un id que el usuario no alcance.
 */
export function elegidoValido(elegido: number | null, condominios: Pick<CondominioOpcion, 'id'>[]): number | null {
  if (condominios.length === 1) return condominios[0]!.id;
  return elegido !== null && condominios.some(c => c.id === elegido) ? elegido : null;
}

export interface Estado {
  /** Hay selector: lo tienen la administración (admin y superadmin); la junta, los residentes y el personal no. */
  activo: boolean;
  /** La pantalla actual se filtra por el condominio elegido. */
  aplica: boolean;
  condominios: CondominioOpcion[];
  cargando: boolean;
  error: string | null;
  /** Condominio elegido; `null` = «Todos los condominios». */
  elegido: number | null;
  condominio: CondominioOpcion | null;
  /** Para los `params` de las listas: el id del condominio elegido, o '' (todos, o la pantalla no se filtra por condominio). */
  complejo: string;
  /** ¿Hay más de un condominio? (con uno solo no hay nada que elegir). */
  varios: boolean;
  elegir: (id: number | null) => void;
  recargar: () => void;
}

export const SIN_SELECTOR: Estado = { activo: false, aplica: false, condominios: [], cargando: false, error: null, elegido: null, condominio: null, complejo: '', varios: false, elegir: () => undefined, recargar: () => undefined };

export const CondominioCtx = createContext<Estado>(SIN_SELECTOR);

/** Estado compartido del selector de condominio de la barra superior. Sin selector (junta, residentes, personal) todo queda como «Todos». */
export function useCondominio(): Estado { return useContext(CondominioCtx); }

/**
 * El block (torre) elegido en el filtro de una pantalla. Los blocks dependen del condominio: al cambiar de condominio el block elegido
 * se descarta en el mismo render (no sale ni una consulta con el block de otro condominio).
 */
export function useTorreElegida(): [string, (torre: string) => void] {
  const { complejo } = useCondominio();
  const [guardada, setGuardada] = useState({ complejo, torre: '' });
  const torre = guardada.complejo === complejo ? guardada.torre : '';
  return [torre, useCallback((t: string) => setGuardada({ complejo, torre: t }), [complejo])];
}
