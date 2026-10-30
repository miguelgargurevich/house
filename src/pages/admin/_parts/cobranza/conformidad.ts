/** Conformidad del tesorero («el dinero llegó a la cuenta») vista por quien valida: qué se dice y cuándo avisar. Lógica pura, sin React. */
import type { Rol } from '../../../../auth/AuthContext';

export interface ConformidadPago { at: string; por: { nombre: string } }

export interface DatosConformidad {
  estado_validacion: 'por_validar' | 'validado' | 'rechazado';
  /** `undefined` = el servidor no la trajo (no se sabe); `null` = el tesorero aún no la da. */
  conformidad?: ConformidadPago | null;
  /** ¿El block del pago tiene un tesorero que pueda darla? */
  tesorero_registrado?: boolean;
}

export type VistaConformidad = { tipo: 'dada'; nombre: string; at: string } | { tipo: 'falta' } | { tipo: 'sin_tesorero' };

/** Sin dato → null (nada que decir). Dada → siempre se muestra como constancia; si falta, sólo mientras el pago sigue por validar. */
export function vistaConformidad(p: DatosConformidad): VistaConformidad | null {
  if (p.conformidad === undefined) return null;
  if (p.conformidad) return { tipo: 'dada', nombre: p.conformidad.por.nombre, at: p.conformidad.at };
  if (p.estado_validacion !== 'por_validar') return null;
  return p.tesorero_registrado === false ? { tipo: 'sin_tesorero' } : { tipo: 'falta' };
}

/** `comoTesorero`: el propio tesorero no lee «el tesorero aún no confirma», sino lo que le toca hacer. */
export function textoConformidad(v: VistaConformidad, fecha: (iso: string) => string, comoTesorero = false): string {
  switch (v.tipo) {
    case 'dada': return `Confirmado por el tesorero: ${v.nombre} · ${fecha(v.at)}`;
    case 'sin_tesorero': return 'El block no tiene tesorero registrado: nadie confirmará que el dinero llegó a la cuenta.';
    case 'falta': return comoTesorero ? 'Aún no confirmaste que el dinero llegó a la cuenta. Revisa la cuenta o el Yape de la junta y confirma abajo.' : 'El tesorero aún no confirma que el dinero llegó a la cuenta.';
  }
}

/** Antes de validar sin conformidad se repite el aviso (no bloquea: la administradora puede validar igual). */
export const TEXTO_VALIDAR_SIN_CONFORMIDAD = 'Vas a validar sin que el tesorero haya confirmado que el dinero llegó a la cuenta. ¿Validas de todos modos?';

/** Insignia de la lista: sólo en pagos por validar o con conformidad dada. */
export function insigniaConformidad(p: DatosConformidad): { tone: 'ok' | 'warn'; label: string } | null {
  const v = vistaConformidad(p);
  if (!v) return null;
  return v.tipo === 'dada' ? { tone: 'ok', label: 'Con conformidad' } : { tone: 'warn', label: 'Sin conformidad' };
}

type Usuario = { rol?: Rol | null; cargo_junta?: string | null } | null | undefined;
/** Validan y rechazan sólo la administración (admin y superadmin); la junta revisa y el tesorero da la conformidad. */
export const puedeValidar = (u: Usuario) => u?.rol === 'admin' || u?.rol === 'superadmin';
export const esTesorero = (u: Usuario) => u?.rol === 'propietario' && u.cargo_junta === 'tesorero';
