import { useResource } from '../../../../api';
import type { Reapertura } from './reabrir';

/** ¿Se puede volver a revisar este pago? Sólo consulta si `activo` (pago rechazado y quien lo ve puede reabrir); mientras carga no se ofrece ni se explica nada. */
export function useReapertura(pagoId: number | null, activo: boolean) {
  const r = useResource<Reapertura>(activo && pagoId != null ? `/api/pagos/${pagoId}/reapertura` : null);
  return { reapertura: activo ? r.data : null, cargando: activo && r.loading, error: activo ? r.error : null };
}
