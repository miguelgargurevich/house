import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../api';
import { Card, CardHeader, ErrorState, Skeleton } from '../../../ui';
import { ComunicadoItem } from './comunicados/ComunicadoItem';
import type { ComunicadoResidente } from './comunicados/tipos';

/** Tarjeta «Comunicados» del Inicio del residente: los 3 más recientes (los fijados primero) y el enlace a la lista completa. */
export function ComunicadosInicio({ base }: { base: '/propietario' | '/inquilino' }) {
  const list = useList<ComunicadoResidente>('/api/me/comunicados', { pageSize: 3 });
  return (
    <Card>
      <CardHeader
        title="Comunicados"
        action={<Link to={`${base}/comunicados`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">Ver todos <ArrowRightIcon className="h-4 w-4" /></Link>}
      />
      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.loading && list.items.length === 0 ? (
        <div className="space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : list.items.length === 0 ? (
        <p className="p-5 text-sm text-muted">Aún no hay comunicados. Cuando la administración o la junta anuncie algo, lo verás aquí.</p>
      ) : (
        <div className="divide-y divide-line">{list.items.map(c => <ComunicadoItem key={c.id} c={c} compacto />)}</div>
      )}
    </Card>
  );
}
