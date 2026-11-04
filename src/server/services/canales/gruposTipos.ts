// A quién representa un grupo de WhatsApp en Torre. Sin imports a propósito: lo usan el servidor (validación, envío por defecto) y las pantallas del navegador (como `avisos/whatsappTipos.ts`).

export const DESTINOS_GRUPO = ['block', 'junta_block', 'condominio'] as const;
export type DestinoGrupo = (typeof DESTINOS_GRUPO)[number];

export const ROTULO_DESTINO: Record<DestinoGrupo, string> = {
  block: 'Vecinos de un block',
  junta_block: 'Junta de un block',
  condominio: 'Todo el condominio',
};

/** El grupo en el que se puede escribir desde un comunicado: lo que la pantalla del comunicado y la API necesitan saber de él (sin el JID). */
export interface GrupoElegible {
  id: number;
  nombre: string;
  destino: string | null;
  estructura_id: number | null;
}

/**
 * ¿Viene marcado de entrada en un comunicado? Para un block: los grupos que representan a los vecinos de ESE block. Para todo el condominio:
 * los de los vecinos de cada block y los del condominio entero. Los de las juntas no se marcan solos: se eligen a propósito.
 */
export function esSugerido(g: Pick<GrupoElegible, 'destino' | 'estructura_id'>, estructuraId: number | null): boolean {
  if (g.destino === 'block') return estructuraId == null || g.estructura_id === estructuraId;
  if (g.destino === 'condominio') return estructuraId == null;
  return false;
}
