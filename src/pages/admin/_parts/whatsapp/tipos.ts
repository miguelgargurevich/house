import { ROTULO_DESTINO, type DestinoGrupo } from '../../../../server/services/canales/gruposTipos';

export type PorTipo = Record<'recibo_emitido' | 'por_vencer' | 'vence_hoy' | 'vencido' | 'comunicado' | 'cierre_pendiente' | 'grupo' | 'otros', number>;

/** `GET /api/whatsapp/uso`. */
export interface UsoWhatsapp {
  conectado: boolean;
  fecha: string;
  hoy: { enviados: number; tope: number | null; restantes: number | null };
  mes: { periodo: string; renueva: string; condominios: { complejo_id: number; nombre: string; usados: number; tope: number | null }[] };
  en_cola: { total: number; para_manana: number; por_tipo: PorTipo };
  fallidos_hoy: { total: number; motivos: { motivo: string; cantidad: number }[] };
  por_tipo: { hoy: PorTipo; mes: PorTipo };
}

/** Un grupo de «Mis grupos» (`GET /api/whatsapp/grupos`). Nunca trae el JID. */
export interface GrupoGuardado {
  id: number;
  nombre: string;
  miembros: number | null;
  en_uso: boolean;
  destino: DestinoGrupo | null;
  complejo_id: number | null;
  estructura_id: number | null;
  ya_no_esta: boolean;
  aviso: string | null;
  sincronizado_at: string | null;
}

export interface CondominioConBlocks { id: number; nombre: string; estructuras: { id: number; nombre: string | null }[] }

export interface MisGrupos {
  conectado: boolean;
  sincronizado_at: string | null;
  grupos: GrupoGuardado[];
  condominios: CondominioConBlocks[];
  /** Sólo en la respuesta de «Traer mis grupos». */
  resumen?: { nuevos: number; actualizados: number; ya_no_estan: number; quitados: number };
}

/** Cómo se llama cada tipo de mensaje en pantalla. */
export const ROTULO_TIPO: Record<keyof PorTipo, string> = {
  recibo_emitido: 'Recibo del mes',
  por_vencer: 'Recordatorio 2 días antes',
  vence_hoy: 'Vence hoy',
  vencido: 'Venció',
  comunicado: 'Comunicado a cada vecino',
  cierre_pendiente: 'Cierre del mes pendiente',
  grupo: 'Mensajes a grupos',
  otros: 'Otros',
};
export const ORDEN_TIPOS = Object.keys(ROTULO_TIPO) as (keyof PorTipo)[];

/** «12 de 200» o «12» si no hay tope. */
export const textoTope = (usados: number, tope: number | null): string => (tope == null ? `${usados}` : `${usados} de ${tope}`);

/** Cuánto del tope va usado, de 0 a 100 (sin tope = 0). */
export const porcentajeDeTope = (usados: number, tope: number | null): number => (tope == null || tope <= 0 ? 0 : Math.min(100, Math.round((usados / tope) * 100)));

/** Color de la barra: verde hasta el 70 %, ámbar hasta el 90 %, rojo desde ahí. */
export const tonoDeTope = (pct: number): 'ok' | 'warn' | 'bad' => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok');

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** El buscador de grupos: sin importar mayúsculas ni tildes, y por el nombre del grupo. */
export function filtrarGrupos(grupos: GrupoGuardado[], q: string, soloEnUso = false): GrupoGuardado[] {
  const t = sinTildes(q.trim());
  return grupos.filter(g => (!soloEnUso || g.en_uso) && (!t || sinTildes(g.nombre).includes(t)));
}

const nombreBlock = (e: { id: number; nombre: string | null }) => e.nombre?.trim() || `Block ${e.id}`;

/** «del Block 3», «de la Torre A», «de Los Pinos»: para frases como «Vecinos del Block 3». */
const delBlock = (nombre: string): string => (/^torre\b/i.test(nombre) ? `de la ${nombre}` : /^(block|edificio|bloque)\b/i.test(nombre) ? `del ${nombre}` : `de ${nombre}`);

/** «Vecinos del Block 3», «Junta del Block 3», «Todo el condominio Los Pinos»: a quién representa un grupo en uso. */
export function textoDestino(g: Pick<GrupoGuardado, 'destino' | 'complejo_id' | 'estructura_id'>, condominios: CondominioConBlocks[]): string {
  const complejo = condominios.find(c => c.id === g.complejo_id);
  if (g.destino === 'condominio') return complejo ? `Todo el condominio ${complejo.nombre}` : ROTULO_DESTINO.condominio;
  const bloque = complejo?.estructuras.find(e => e.id === g.estructura_id);
  if (!bloque) return ROTULO_DESTINO[g.destino ?? 'block'];
  return `${g.destino === 'junta_block' ? 'Junta' : 'Vecinos'} ${delBlock(nombreBlock(bloque))}`;
}

/** Cuándo se trajeron por última vez («3 nov, 10:42») o que aún no. */
export function textoSincronizado(iso: string | null): string {
  if (!iso) return 'Aún no has traído tus grupos';
  return `Traídos el ${new Date(iso).toLocaleString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' })}`;
}
