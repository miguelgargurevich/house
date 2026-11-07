/** Torre/block tal como la devuelve `/api/estructuras` (con su condominio). Cada torre tiene su propio recibo mensual. */
export interface Torre { id: number; nombre: string | null; tipo?: string | null; complejo?: { id: number; nombre: string } | null }

export const nombreTorre = (t: { id: number; nombre: string | null }): string => t.nombre ?? `Block ${t.id}`;

/** ¿Las torres son de más de un condominio? Entonces «Block 1» solo no alcanza para distinguirlas. */
export const hayVariosCondominios = (torres: Pick<Torre, 'complejo'>[]): boolean => new Set(torres.map(t => t.complejo?.id ?? 0)).size > 1;

/** Rótulo de una torre: «Block 1», o «Block 1 · Los Libertadores» si hay torres de varios condominios. Sirve también para filas que sólo traen nombre y condominio (p. ej. el resumen). */
export const rotuloTorre = (nombre: string, complejo: { nombre: string } | null | undefined, variosCondominios: boolean): string =>
  `${nombre}${variosCondominios && complejo ? ` · ${complejo.nombre}` : ''}`;

/** Texto de una torre en un select: «Block 1», o «Block 1 · Los Libertadores» si hay torres de varios condominios. */
export const etiquetaTorre = (t: Torre, variosCondominios: boolean): string => rotuloTorre(nombreTorre(t), t.complejo, variosCondominios);

/** Cómo se llaman los edificios en el filtro: siempre «block». */
export const palabraDeTorres = (_torres: Pick<Torre, 'tipo'>[]): { titulo: string; todas: string } => ({ titulo: 'Block', todas: 'Todos los blocks' });
