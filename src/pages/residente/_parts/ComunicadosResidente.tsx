import { MegaphoneIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../api';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../ui';
import { ComunicadoItem } from './comunicados/ComunicadoItem';
import type { ComunicadoResidente } from './comunicados/tipos';
import { Pager } from './Pager';

/** Lista completa de comunicados de la administración y la junta para el residente (propietario o inquilino). */
export function ComunicadosResidente() {
  const list = useList<ComunicadoResidente>('/api/me/comunicados', { pageSize: 10 });
  return (
    <>
      <PageHeader title="Comunicados" description="Lo que la administración y la junta directiva anuncian a tu condominio: cortes, reuniones, trabajos y avisos importantes." />
      <Card>
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && list.items.length === 0 ? (
          <div className="space-y-3 p-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
        ) : list.items.length === 0 ? (
          <EmptyState icon={<MegaphoneIcon />} title="Aún no hay comunicados" description="Cuando la administración o la junta publique algo para tu condominio (un corte de agua, una asamblea, un mantenimiento), lo verás aquí." />
        ) : (
          <div className="divide-y divide-line">{list.items.map(c => <ComunicadoItem key={c.id} c={c} />)}</div>
        )}
      </Card>
      <Pager page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
    </>
  );
}
