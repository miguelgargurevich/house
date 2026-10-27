import { useResource } from '../../../../api';
import type { Page } from '../../../../api';

export interface Opcion { id: number; nombre: string }

/** Carga hasta 100 registros para llenar un select. Con `path` nulo no pide nada. */
export function useOpciones(path: string | null) {
  const sep = path?.includes('?') ? '&' : '?';
  const r = useResource<Page<Opcion>>(path ? `${path}${sep}pageSize=100` : null);
  return { opciones: r.data?.items ?? [], loading: r.loading, error: r.error, reload: r.reload };
}

export const TIPOS_COMPLEJO = ['Edificio', 'Condominio', 'Conjunto residencial'] as const;
export const TIPOS_MONTO = [
  { value: 'fijo', label: 'Fijo' },
  { value: 'variable', label: 'Variable' },
  { value: 'prorrateo', label: 'Prorrateo' },
] as const;
