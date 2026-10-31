// Solo lectura al terminar el periodo gratis: lo que la banda y los botones necesitan saber. El backend es la fuente de verdad (responde 409 al
// registrar algo nuevo); aquí sólo se refleja. Sin React ni API: lo prueban las pruebas de Node.
import { createContext, useContext } from 'react';

/** Un condominio del alcance del usuario, tal como lo trae `GET /api/comercial/estado-operativo`. */
export interface EstadoOperativo {
  complejo_id: number;
  complejo: string;
  solo_lectura: boolean;
  /** Último día gratis (AAAA-MM-DD…). */
  gratis_hasta: string | null;
  /** Primer día en solo lectura. */
  solo_lectura_desde: string | null;
  dias_gratis_restantes: number | null;
  /** «S/ 20»: lo menos que cuesta Básico para este condominio; null si no cabe o no se ofrece. */
  basico_desde: string | null;
}

/** El motivo que lleva cada botón desactivado (en el `title` y para lectores de pantalla). */
export const MOTIVO_SOLO_LECTURA = 'Este condominio está en solo lectura: terminó su periodo gratis. Pásalo a un plan de pago desde Mi plan para seguir registrando.';
export const MOTIVO_SOLO_LECTURA_JUNTA = 'Este condominio está en solo lectura: terminó su periodo gratis. Pídele a tu administración que lo pase a un plan de pago.';

export interface VistaSoloLectura {
  soloLectura: boolean;
  /** Primer día en solo lectura (el del condominio mostrado). */
  desde: string | null;
  basicoDesde: string | null;
  condominio: string | null;
  /** Qué decir en un botón desactivado (undefined si no está bloqueado, para que no ponga `title`). */
  motivo: string | undefined;
}

export const SIN_BLOQUEO: VistaSoloLectura = { soloLectura: false, desde: null, basicoDesde: null, condominio: null, motivo: undefined };

/**
 * El estado que vale para la pantalla: con un condominio elegido, el suyo; sin elegir («Todos»), sólo hay solo lectura si TODOS los condominios
 * lo están (con uno que sí opera, la administración sigue trabajando y el servidor frena el que no).
 */
export function vistaSoloLectura(condominios: EstadoOperativo[], elegido: number | null, junta: boolean): VistaSoloLectura {
  const alcance = elegido == null ? condominios : condominios.filter(c => c.complejo_id === elegido);
  if (!alcance.length || !alcance.every(c => c.solo_lectura)) return SIN_BLOQUEO;
  const c = alcance[0]!;
  return { soloLectura: true, desde: c.solo_lectura_desde, basicoDesde: c.basico_desde, condominio: alcance.length === 1 ? c.complejo : null, motivo: junta ? MOTIVO_SOLO_LECTURA_JUNTA : MOTIVO_SOLO_LECTURA };
}

/** «Te quedan 12 días gratis» / «Hoy es tu último día gratis»: los días que le faltan al periodo gratis. */
export function diasGratisTexto(n: number | null): string | null {
  if (n == null) return null;
  if (n <= 0) return 'Hoy es tu último día gratis';
  return `Te quedan ${n} ${n === 1 ? 'día' : 'días'} gratis`;
}

/** «Pásalo a Pro» con la oferta de Básico cuando cabe: «Básico desde S/ 20 o Pro». */
export const ofertaDePago = (basicoDesde: string | null): string => (basicoDesde ? `Torre Básico desde ${basicoDesde} o Torre Pro` : 'Torre Pro');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** `2027-01-29T00:00:00.000Z` → `29 de enero de 2027` (la fecha es un día calendario: se lee en UTC, sin corrimiento de zona). */
export function fechaLarga(iso: string | null): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return a && m && d ? `${d} de ${MESES[m - 1]} de ${a}` : '';
}

/** El texto de la banda, tal como se pidió: «Este condominio está en solo lectura desde el <fecha>. Tus datos siguen aquí.» */
export function textoBanda(v: Pick<VistaSoloLectura, 'desde'>): string {
  const cuando = v.desde ? ` desde el ${fechaLarga(v.desde)}` : '';
  return `Este condominio está en solo lectura${cuando}. Tus datos siguen aquí.`;
}

/** Contexto con la lista de condominios del usuario y qué hacer con ella; lo llena `SoloLecturaProvider`. */
export const SoloLecturaCtx = createContext<VistaSoloLectura>(SIN_BLOQUEO);

/** Para desactivar un botón de una acción que crea trabajo: `<Bloqueable>{b => <Button disabled={b}>…</Button>}</Bloqueable>` (o `useSoloLectura().soloLectura`). */
export function useSoloLectura(): VistaSoloLectura { return useContext(SoloLecturaCtx); }
