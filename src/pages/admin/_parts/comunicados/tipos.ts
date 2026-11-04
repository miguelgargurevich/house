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

/** Cómo le fue al mensaje a un grupo de WhatsApp. `pendiente` con `motivo` = no salió (p. ej. el tope diario) y se puede reintentar; sin motivo = se está enviando. */
export interface ResultadoGrupo {
  grupo_id?: number;
  /** Sólo en los comunicados anteriores a «Mis grupos» (una fila por block). */
  estructura_id?: number;
  nombre: string;
  estado: 'pendiente' | 'enviado' | 'fallo';
  motivo?: string;
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
  /** «Por WhatsApp a cada vecino». */
  enviar_whatsapp: boolean;
  enviar_junta?: boolean;
  enviar_grupo?: boolean;
  grupos_resultado?: ResultadoGrupo[] | null;
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

export const alcanceLabel = (c: Pick<Comunicado, 'estructura'>) => (c.estructura ? (c.estructura.nombre?.trim() || `Block ${c.estructura.id}`) : 'Todo el condominio');

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

/** La pestaña «Notificaciones» filtrada por un comunicado. */
export const enviosDeComunicado = (base: string, id: number) => `${base}/avisos?comunicado=${id}`;

/** Los grupos que no salieron por el tope diario u otro motivo y siguen pendientes. */
export const gruposPendientes = (c: Pick<Comunicado, 'grupos_resultado'>): ResultadoGrupo[] => (c.grupos_resultado ?? []).filter(g => g.estado === 'pendiente' && !!g.motivo);

/** «2 grupos de WhatsApp · 1 pendiente · 1 con error», o null si no se pidió grupo. */
export function textoGrupos(c: Pick<Comunicado, 'grupos_resultado'>): string | null {
  const g = c.grupos_resultado;
  if (!g?.length) return null;
  const enviados = g.filter(x => x.estado === 'enviado').length;
  const fallos = g.filter(x => x.estado === 'fallo').length;
  const esperando = g.filter(x => x.estado === 'pendiente' && !x.motivo).length;
  const pendientes = g.filter(x => x.estado === 'pendiente' && !!x.motivo).length;
  const partes = [`${enviados} ${enviados === 1 ? 'grupo' : 'grupos'} de WhatsApp`];
  if (esperando > 0) partes.push('enviando…');
  if (pendientes > 0) partes.push(`${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'}`);
  if (fallos > 0) partes.push(`${fallos} con error`);
  return partes.join(' · ');
}

/** El texto de un grupo que no salió: su motivo, o una frase por defecto. */
export const motivoDeGrupo = (g: ResultadoGrupo): string => g.motivo ?? `No se envió al grupo «${g.nombre}»`;

/** Lo que dice el aviso tras publicar: cuántos correos/WhatsApp quedaron en cola, o por qué ninguno. */
export function textoPublicado(c: Pick<Comunicado, 'avisos_encolados' | 'enviar_correo' | 'enviar_whatsapp' | 'enviar_junta' | 'enviar_grupo' | 'grupos_resultado'>): string {
  const n = c.avisos_encolados ?? 0;
  const grupos = c.grupos_resultado?.length ?? 0;
  const partes: string[] = [];
  if (n > 0) partes.push(`se encolaron ${n} ${n === 1 ? 'aviso' : 'avisos'} por ${c.enviar_junta || (c.enviar_correo && c.enviar_whatsapp) ? 'correo y WhatsApp' : c.enviar_correo ? 'correo' : 'WhatsApp'}`);
  if (grupos > 0) partes.push(`se está enviando ${grupos === 1 ? 'al grupo de WhatsApp' : `a ${grupos} grupos de WhatsApp`}`);
  if (partes.length) return `Comunicado publicado. ${partes[0]![0]!.toUpperCase()}${partes.join(' y ').slice(1)}.`;
  if (c.enviar_correo || c.enviar_whatsapp || c.enviar_junta) return 'Comunicado publicado. Nadie tiene activado ese canal, así que no se envió ningún aviso.';
  return 'Comunicado publicado';
}
