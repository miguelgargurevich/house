import { useResource } from '../../../../api';

export type TipoMedio = 'banco' | 'yape' | 'plin' | 'recaudacion';
export type Moneda = 'PEN' | 'USD';
export type CodigoPago = 'departamento' | 'dni' | 'otro';

export interface Medio {
  id: number;
  complejo_id: number;
  estructura_id: number | null;
  tipo: TipoMedio;
  /** La entidad (en una recaudación también). «Otro» = el nombre está en `banco_otro`. */
  banco: string | null;
  banco_otro: string | null;
  /** Nombre real de la entidad, como lo ve el vecino. */
  entidad: string | null;
  tipo_cuenta: 'ahorros' | 'corriente' | null;
  numero_cuenta: string | null;
  cci: string | null;
  moneda: Moneda;
  /** Recaudación: el servicio como aparece en «Pago de servicios» y el código que escribe el vecino. */
  servicio: string | null;
  codigo_pago: CodigoPago | null;
  codigo_instruccion: string | null;
  titular: string;
  documento_titular: string | null;
  celular: string | null;
  tiene_qr: boolean;
  activo: boolean;
  orden: number;
  updated_at: string;
  complejo?: { id: number; nombre: string } | null;
  estructura?: { id: number; nombre: string | null } | null;
}

export interface Ambitos {
  complejos: { id: number; nombre: string; estructuras: { id: number; nombre: string | null }[] }[];
  /** La junta de una torre sólo gestiona esa torre (no puede elegir «todo el condominio»). */
  fijo: boolean;
}

export const useAmbitos = () => useResource<Ambitos>('/api/medios-pago/ambitos');

export const TIPOS: { value: TipoMedio; label: string }[] = [
  { value: 'banco', label: 'Cuenta bancaria' },
  { value: 'yape', label: 'Yape' },
  { value: 'plin', label: 'Plin' },
  { value: 'recaudacion', label: 'Cuenta recaudadora (Pago de servicios)' },
];
export const tipoLabel = (t: TipoMedio) => TIPOS.find(x => x.value === t)?.label ?? t;

/** Valor de `banco` cuando la entidad no está en la lista (el nombre va en `banco_otro`). */
export const ENTIDAD_OTRA = 'Otro';

/** Catálogo de entidades del servidor (`GET /api/medios-pago/catalogo`): la única fuente; aquí no se repite la lista. */
export interface EntidadCatalogo { nombre: string; grupo: string; largo_ahorros: number | null; largo_corriente: number | null; codigo_cci: string | null }
export interface Catalogo { grupos: { grupo: string; etiqueta: string; entidades: EntidadCatalogo[] }[] }
export const useCatalogo = () => useResource<Catalogo>('/api/medios-pago/catalogo');

/** Nombre corto de la moneda para las listas («Soles» / «Dólares»). */
export const monedaCorta = (m: Moneda) => (m === 'USD' ? 'Dólares' : 'Soles');

export const MONEDAS: { value: Moneda; label: string }[] = [
  { value: 'PEN', label: 'Soles (S/)' },
  { value: 'USD', label: 'Dólares (US$)' },
];

export const CODIGOS_PAGO: { value: CodigoPago; label: string }[] = [
  { value: 'departamento', label: 'El código del departamento (p. ej. B01-804)' },
  { value: 'dni', label: 'El DNI del vecino' },
  { value: 'otro', label: 'Otro código (lo explicas tú)' },
];

export const nombreTorre = (e: { id: number; nombre: string | null }) => e.nombre?.trim() || `Torre ${e.id}`;
export const ambitoLabel = (m: Pick<Medio, 'estructura'>) => (m.estructura ? nombreTorre(m.estructura) : 'Todo el condominio');

/** Dato con el que se paga: el número de cuenta, el celular o, en una recaudación, el servicio. */
export const datoPrincipal = (m: Pick<Medio, 'tipo' | 'numero_cuenta' | 'celular' | 'servicio'>) => (m.tipo === 'banco' ? m.numero_cuenta : m.tipo === 'recaudacion' ? m.servicio : m.celular) ?? '—';

/** Dirección de la imagen del QR (la sesión viaja en la cookie; el parámetro `v` evita ver una imagen vieja tras reemplazarla). */
export const urlQr = (id: number, version?: string) => `/api/medios-pago/${id}/qr${version ? `?v=${encodeURIComponent(version)}` : ''}`;
