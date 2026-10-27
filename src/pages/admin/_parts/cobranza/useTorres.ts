import { useResource } from '../../../../api';
import type { Page } from '../../../../api';
import type { Torre } from './torres';

/** Torres del condominio elegido (o de todos los del alcance si no se da ninguno). Lista vacía = condominio sin torres. */
export function useTorres(complejoId?: string | number | null, habilitado = true) {
  return useResource<Page<Torre>>(habilitado ? `/api/estructuras?pageSize=100&orden=nombre:asc${complejoId ? `&complejo_id=${complejoId}` : ''}` : null);
}
