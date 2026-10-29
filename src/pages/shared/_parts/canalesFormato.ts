import { formatearTelefono } from '../../../lib/telefono';

/** Lógica pura de «Vincular WhatsApp» (la pantalla sólo la pinta). */

export interface Destino { empresa: { id: number; nombre: string }; disponible: boolean; numero: string | null }
export interface VinculoCanal { id: number; canal: string; identificador: string; verificado_at: string; empresa: { id: number; nombre: string } }
export interface TelegramMe { disponible: boolean; bot_usuario: string | null }
export interface CanalesMe { vinculos: VinculoCanal[]; codigo_vigente: { canal: string; expira_at: string } | null; destinos: Destino[]; telegram?: TelegramMe }
export interface CodigoGenerado { canal: string; codigo: string; expira_at: string; vigencia_min: number; destinos: Destino[]; telegram?: { bot_usuario: string; enlace: string } }

/** `51987654321` → `+51 987 654 321`; `56961234567` → `+56 9 6123 4567`. Si no es un número válido se muestra sólo con «+». */
export function formatoNumero(digitos: string): string {
  return formatearTelefono(`+${digitos}`) ?? `+${digitos}`;
}

/** Segundos que faltan para que venza el código (0 si ya venció). */
export const segundosRestantes = (expiraAt: string, ahoraMs: number): number => Math.max(0, Math.ceil((new Date(expiraAt).getTime() - ahoraMs) / 1000));

/** `600` → `10:00`. */
export const reloj = (seg: number): string => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;

/** El código de 6 dígitos en dos grupos para leerlo y copiarlo mejor: `123456` → `123 456`. */
export const codigoEnGrupos = (codigo: string): string => (codigo.length === 6 ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : codigo);

/** Destinos a los que se le puede mandar el código: los que tienen WhatsApp activo (primero el que informa su número). */
export const destinosActivos = (d: Destino[]): Destino[] => d.filter((x) => x.disponible).sort((a, b) => Number(b.numero != null) - Number(a.numero != null));

/** Qué se muestra: sin ninguna empresa con la que tengas relación no hay nada que vincular (p. ej. superadmin). */
export type EstadoCanales = 'oculto' | 'vinculado' | 'sin_whatsapp' | 'listo';
export function estadoCanales(d: CanalesMe | null): EstadoCanales {
  if (!d) return 'oculto';
  if (d.vinculos.some((v) => v.canal === 'whatsapp')) return 'vinculado';
  if (d.destinos.length === 0) return 'oculto';
  return destinosActivos(d.destinos).length ? 'listo' : 'sin_whatsapp';
}

/** Qué se muestra de Telegram: nada si el bot no está activo (o la persona no tiene empresa), «vinculado» si ya tiene vínculo, o «listo» para vincular. */
export type EstadoTelegram = 'oculto' | 'vinculado' | 'listo';
export function estadoTelegram(d: CanalesMe | null): EstadoTelegram {
  if (!d) return 'oculto';
  if (d.vinculos.some((v) => v.canal === 'telegram')) return 'vinculado';
  return d.telegram?.disponible ? 'listo' : 'oculto';
}
