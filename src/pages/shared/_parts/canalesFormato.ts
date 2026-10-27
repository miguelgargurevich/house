/** Lógica pura de «Vincular WhatsApp» (la pantalla sólo la pinta). */

export interface Destino { empresa: { id: number; nombre: string }; disponible: boolean; numero: string | null }
export interface VinculoCanal { id: number; canal: string; identificador: string; verificado_at: string; empresa: { id: number; nombre: string } }
export interface CanalesMe { vinculos: VinculoCanal[]; codigo_vigente: { canal: string; expira_at: string } | null; destinos: Destino[] }
export interface CodigoGenerado { canal: string; codigo: string; expira_at: string; vigencia_min: number; destinos: Destino[] }

/** `51987654321` → `+51 987 654 321`; si no parece un celular peruano se muestra con «+». */
export function formatoNumero(digitos: string): string {
  const m = /^51(\d{3})(\d{3})(\d{3})$/.exec(digitos);
  return m ? `+51 ${m[1]} ${m[2]} ${m[3]}` : `+${digitos}`;
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
