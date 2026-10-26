import { useResource } from '../../../../api';

export type TipoMedio = 'banco' | 'yape' | 'plin';

export interface Medio {
  id: number;
  complejo_id: number;
  estructura_id: number | null;
  tipo: TipoMedio;
  banco: string | null;
  tipo_cuenta: 'ahorros' | 'corriente' | null;
  numero_cuenta: string | null;
  cci: string | null;
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
];
export const tipoLabel = (t: TipoMedio) => TIPOS.find(x => x.value === t)?.label ?? t;

export const BANCOS = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación', 'Mibanco', 'BanBif', 'Pichincha', 'Otro'] as const;

export const nombreTorre = (e: { id: number; nombre: string | null }) => e.nombre?.trim() || `Torre ${e.id}`;
export const ambitoLabel = (m: Pick<Medio, 'estructura'>) => (m.estructura ? nombreTorre(m.estructura) : 'Todo el condominio');

/** Dato con el que se paga: el número de cuenta o el celular. */
export const datoPrincipal = (m: Pick<Medio, 'tipo' | 'numero_cuenta' | 'celular'>) => (m.tipo === 'banco' ? m.numero_cuenta : m.celular) ?? '—';

/** Dirección de la imagen del QR (la sesión viaja en la cookie; el parámetro `v` evita ver una imagen vieja tras reemplazarla). */
export const urlQr = (id: number, version?: string) => `/api/medios-pago/${id}/qr${version ? `?v=${encodeURIComponent(version)}` : ''}`;
