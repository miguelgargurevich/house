import type { CargoJunta } from '../../../../auth/AuthContext';
import { fechaCorta } from '../../../../ui';
import type { Medio } from '../medios/tipos';

export interface MiembroJunta {
  id: number;
  usuario_id: number;
  cargo: CargoJunta;
  nombre: string;
  email: string;
  telefono: string | null;
  /** Los departamentos del miembro en el block de la junta. */
  departamentos: string[];
}

/** Una gestión de la junta (vigente o pasada). Las fechas son de calendario: «AAAA-MM-DD». */
export interface Junta {
  id: number;
  complejo_id: number;
  estructura_id: number | null;
  complejo: { id: number; nombre: string };
  estructura: { id: number; nombre: string | null; tipo?: string } | null;
  desde: string;
  hasta: string | null;
  vigente: boolean;
  correo: string | null;
  notas: string | null;
  miembros: MiembroJunta[];
  /** Su cuenta: los medios de pago de la junta. */
  medios: Medio[];
}

export interface FichaJunta {
  complejo: { id: number; nombre: string };
  estructura: { id: number; nombre: string | null; tipo?: string } | null;
  vigente: Junta | null;
  anteriores: number;
}

export interface ListaJuntas {
  items: FichaJunta[];
  complejos: { id: number; nombre: string }[];
  /** La administración gestiona todo; el presidente y el tesorero sólo su correo y su cuenta. */
  puede_gestionar: boolean;
}

export interface Candidato {
  id: number;
  nombre: string;
  email: string;
  telefono: string | null;
  departamentos: string[];
  /** La junta vigente donde ya está (una persona sólo puede estar en una). */
  junta_vigente_id: number | null;
}

export const CARGOS: { value: CargoJunta; label: string }[] = [
  { value: 'presidente', label: 'Presidente' },
  { value: 'tesorero', label: 'Tesorero' },
  { value: 'secretario', label: 'Secretario' },
  { value: 'vocal', label: 'Vocal' },
];
export const cargoLabel = (c: CargoJunta | null | undefined) => CARGOS.find(x => x.value === c)?.label ?? '—';

/** Cómo llama el condominio a sus edificios: «block» si todos son blocks, si no «torre» (la misma regla de `palabraEstructura` en Medios de pago; aquí sin importar la capa de red). */
export const palabraDe = (items: { estructura: { tipo?: string } | null }[]): string => {
  const tipos = items.flatMap(i => (i.estructura ? [i.estructura.tipo] : []));
  return tipos.length > 0 && tipos.every(t => t?.toLowerCase() === 'block') ? 'block' : 'torre';
};

/** «Block 1», o «Todo el condominio» si la junta no es de un block. */
export const nombreAmbito = (e: { id: number; nombre: string | null } | null) => (e ? e.nombre?.trim() || `Torre ${e.id}` : 'Todo el condominio');

/** «2026» de «2026-01-01». */
export const anioDe = (dia: string) => dia.slice(0, 4);

/** «2026» o «2024-2025»: cómo se llama la gestión. */
export const nombreGestion = (j: Pick<Junta, 'desde' | 'hasta'>) => (j.hasta && anioDe(j.hasta) !== anioDe(j.desde) ? `${anioDe(j.desde)}-${anioDe(j.hasta)}` : anioDe(j.desde));

/** «Cuenta de la junta 2026 (desde 1 ene 2026)»: el texto del formulario de un medio de pago de un block. */
export const textoCuentaJunta = (j: { desde: string; hasta?: string | null }) => `Cuenta de la junta ${nombreGestion({ desde: j.desde, hasta: j.hasta ?? null })} (desde ${fechaCorta(j.desde)})`;

/** Un día más (para el `min` del campo «desde» de una gestión nueva). */
export function diaSiguiente(dia: string): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** El medio de pago con el que se paga, en una línea: «BCP · Ahorros · 194…». */
export const lineaCuenta = (m: Pick<Medio, 'tipo' | 'entidad' | 'tipo_cuenta' | 'numero_cuenta' | 'celular' | 'servicio'>) =>
  m.tipo === 'banco' ? [m.entidad, m.tipo_cuenta === 'corriente' ? 'Corriente' : 'Ahorros'].filter(Boolean).join(' · ')
    : m.tipo === 'recaudacion' ? [m.entidad, m.servicio].filter(Boolean).join(' · ')
      : m.tipo === 'yape' ? 'Yape' : 'Plin';

/** Cuántos miembros de cada cargo único hay (para avisar antes de enviar). */
export function cargoRepetido(miembros: { cargo: string }[]): 'presidente' | 'tesorero' | null {
  for (const c of ['presidente', 'tesorero'] as const) if (miembros.filter(m => m.cargo === c).length > 1) return c;
  return null;
}

/** Una fila del editor de miembros: la persona elegida ('' = aún sin elegir) y su cargo. */
export interface FilaMiembro { usuario_id: string; cargo: CargoJunta }

/** Las filas elegidas, listas para la API (sin filas vacías). */
export const filasAApi = (v: FilaMiembro[]) => v.filter(f => f.usuario_id !== '').map(f => ({ usuario_id: Number(f.usuario_id), cargo: f.cargo }));
