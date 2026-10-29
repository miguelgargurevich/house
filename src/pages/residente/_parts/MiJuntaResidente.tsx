import { UserGroupIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../api';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../ui';
import { JuntaVecinoCard } from './junta/JuntaVecinoCard';
import type { JuntaVecino } from './junta/tipos';

/** «Mi junta» del residente (propietario o inquilino): la junta de SU block y la Junta central, sólo lectura. La API ya no manda nada de otros blocks. */
export function MiJuntaResidente() {
  const r = useResource<{ items: JuntaVecino[] }>('/api/me/juntas');
  const items = r.data?.items ?? [];
  const mostrarCondominio = new Set(items.map(i => i.ambito.complejo.id)).size > 1;
  return (
    <>
      <PageHeader title="Mi junta" description="Quiénes forman la junta directiva de tu block y la Junta central, cómo escribirles y a qué cuenta pagas." />
      {r.error ? (
        <Card><ErrorState message={r.error} onRetry={r.reload} /></Card>
      ) : r.loading && !r.data ? (
        <div className="space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<UserGroupIcon />} title="Aún no hay una junta para mostrarte" description="Cuando tengas un departamento asignado, aquí verás la junta de tu block y la Junta central de tu condominio." /></Card>
      ) : (
        <div className="space-y-4">{items.map(i => <JuntaVecinoCard key={`${i.ambito.complejo.id}-${i.ambito.estructura?.id ?? 'central'}`} item={i} mostrarCondominio={mostrarCondominio} />)}</div>
      )}
    </>
  );
}
