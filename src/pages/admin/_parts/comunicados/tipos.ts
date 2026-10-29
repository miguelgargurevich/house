import type { Ambitos } from '../medios/tipos';

export type { Ambitos };

/** Cuántos envíos (correo y WhatsApp) tuvo un comunicado, por estado. Sólo viene en el listado. */
export interface Envios {
  total: number;
  pendiente: number;
  enviada: number;
  error: number;
  omitida: number;
}

/** Un comunicado en la gestión (`/api/comunicados`). */
export interface Comunicado {
  id: number;
  complejo_id: number;
  /** null = todo el condominio. */
  estructura_id: number | null;
  titulo: string;
  cuerpo: string;
  fijado: boolean;
  enviar_correo: boolean;
  enviar_whatsapp: boolean;
  archivado_at: string | null;
  created_at: string;
  complejo: { id: number; nombre: string } | null;
  estructura: { id: number; nombre: string | null } | null;
  autor: { id: number; nombre: string } | null;
  origen: 'administracion' | 'junta';
  /** Sólo en la respuesta de crear: cuántos correos/WhatsApp quedaron en cola. */
  avisos_encolados?: number;
  /** Sólo en el listado: sus envíos dentro de tu alcance. */
  envios?: Envios;
}

export const TOPE_TITULO = 120;
export const TOPE_CUERPO = 4000;

export const alcanceLabel = (c: Pick<Comunicado, 'estructura'>) => (c.estructura ? (c.estructura.nombre?.trim() || `Torre ${c.estructura.id}`) : 'Todo el condominio');

/** «3 enviados · 1 con error», o «Sin envíos» si sólo se publicó en pantalla. */
export function textoEnvios(e: Envios | undefined): string {
  if (!e || e.total === 0) return 'Sin envíos';
  const partes = [`${e.enviada} ${e.enviada === 1 ? 'enviado' : 'enviados'}`];
  if (e.pendiente > 0) partes.push(`${e.pendiente} en cola`);
  if (e.error > 0) partes.push(`${e.error} con error`);
  return partes.join(' · ');
}

/** `/junta` o `/admin`, según la ruta actual: la misma página se monta bajo las dos. */
export const baseDe = (pathname: string) => (pathname.startsWith('/junta/') ? '/junta' : '/admin');

/** La pestaña «Envíos» filtrada por un comunicado. */
export const enviosDeComunicado = (base: string, id: number) => `${base}/avisos?comunicado=${id}`;

/** Lo que dice el aviso tras publicar: cuántos correos/WhatsApp quedaron en cola, o por qué ninguno. */
export function textoPublicado(c: Pick<Comunicado, 'avisos_encolados' | 'enviar_correo' | 'enviar_whatsapp'>): string {
  const n = c.avisos_encolados ?? 0;
  if (n > 0) return `Comunicado publicado. Se encolaron ${n} ${n === 1 ? 'aviso' : 'avisos'} por ${c.enviar_correo && c.enviar_whatsapp ? 'correo y WhatsApp' : c.enviar_correo ? 'correo' : 'WhatsApp'}.`;
  if (c.enviar_correo || c.enviar_whatsapp) return 'Comunicado publicado. Ningún vecino tiene activado ese canal, así que no se envió ningún aviso.';
  return 'Comunicado publicado';
}
