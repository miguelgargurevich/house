export interface Persona { id: number; nombre: string }

export interface FilaUnidad {
  id: number;
  codigo: string;
  tipo: string;
  descripcion: string | null;
  estado: string | null;
  complejo_id: number | null;
  /** Torre de la unidad (modelo `Estructura`). */
  estructura_id: number | null;
  piso_id: number | null;
  propietario_id: number | null;
  inquilino_id: number | null;
  complejo?: Persona | null;
  estructura?: { id: number; nombre: string | null } | null;
  propietario?: Persona | null;
  inquilino?: Persona | null;
}

export interface FormUnidad {
  codigo: string;
  tipo: string;
  complejo_id: string;
  estructura_id: string;
  piso_id: string;
  descripcion: string;
  estado: string;
  propietario_id: string;
  inquilino_id: string;
}

export interface Torre { id: number; nombre: string | null }
export interface Piso { id: number; numero: number | null }

export const ESTADOS_UNIDAD = [{ value: 'activa', label: 'Activa' }, { value: 'inactiva', label: 'Inactiva' }];

/** Texto de la torre; si no tiene nombre, se muestra el id (las torres siempre se nombran al crearlas). */
export const nombreTorre = (t: { id: number; nombre: string | null }) => t.nombre?.trim() || `Torre ${t.id}`;

export const idONull = (v: string) => (v ? Number(v) : null);
