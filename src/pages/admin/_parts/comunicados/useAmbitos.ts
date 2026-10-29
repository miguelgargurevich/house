import { useResource } from '../../../../api';
import type { Ambitos } from './tipos';

/** Condominios y blocks donde quien llama puede publicar (la junta de un block, sólo ese block: `fijo`). */
export const useAmbitosComunicados = () => useResource<Ambitos>('/api/comunicados/ambitos');
