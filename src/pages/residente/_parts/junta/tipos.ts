import type { CargoJunta } from '../../../../auth/AuthContext';
import type { Medio } from '../../../admin/_parts/medios/tipos';

/** Una cuenta donde paga el vecino: los mismos campos de «cómo pagar» (sin documento del titular ni quién la creó). */
export type CuentaVecino = Pick<Medio, 'id' | 'tipo' | 'banco' | 'tipo_cuenta' | 'numero_cuenta' | 'cci' | 'titular' | 'celular' | 'tiene_qr' | 'orden' | 'entidad' | 'servicio' | 'moneda'> & { moneda_nombre: string; instruccion: string | null };

/** De cada miembro sólo se ve el cargo, el nombre y su departamento: nunca su correo ni su celular. */
export interface MiembroVecino { cargo: CargoJunta; nombre: string; departamentos: string[] }

/** Un ámbito del vecino: su block o la Junta central (`estructura` null). `junta` null = aún no hay una vigente. */
export interface JuntaVecino {
  ambito: { complejo: { id: number; nombre: string }; estructura: { id: number; nombre: string | null; tipo: string } | null };
  junta: { desde: string; correo: string | null; miembros: MiembroVecino[]; cuentas: CuentaVecino[] } | null;
}

/** «Block 1», o «Junta central» si es la de todo el condominio. */
export const nombreJunta = (a: JuntaVecino['ambito']) => (a.estructura ? a.estructura.nombre?.trim() || `Torre ${a.estructura.id}` : 'Junta central');

/** «la junta de Block 1» o «la Junta central»: para frases. */
export const laJunta = (a: JuntaVecino['ambito']) => (a.estructura ? `la junta de ${nombreJunta(a)}` : 'la Junta central');

/** Enlace para escribirle a la junta. El correo lo cargó la administración o la propia junta, pero igual se codifica: nada se pega crudo en el `href`. */
export const mailtoJunta = (correo: string) => `mailto:${encodeURIComponent(correo).replace(/%40/g, '@')}`;
