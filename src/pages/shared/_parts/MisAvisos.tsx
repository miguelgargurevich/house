import { useResource } from '../../../api';
import { Skeleton } from '../../../ui';
import { ListaMisAvisos, type AvisoHistorial } from './MisAvisosLista';

/** «Últimos avisos» dentro de la tarjeta «Celular y avisos»: lo que le enviamos al propio usuario, con su estado y motivo. */
export function MisAvisos() {
  const { data, loading, error } = useResource<AvisoHistorial[]>('/api/me/avisos/historial');
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Últimos avisos</h3>
      {loading && !data ? <Skeleton className="h-24 w-full" /> : error ? <p className="text-sm text-bad">{error}</p> : <ListaMisAvisos avisos={data ?? []} />}
    </section>
  );
}
