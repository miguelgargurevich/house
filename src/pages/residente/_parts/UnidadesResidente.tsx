import { BuildingStorefrontIcon, KeyIcon, UserIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../api';
import { Card, CardBody, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../../../ui';

interface Unidad {
  id: number;
  codigo: string;
  tipo: string;
  estado: string | null;
  complejo?: { id: number; nombre: string } | null;
  estructura?: { id: number; nombre: string | null } | null;
  inquilino?: { id: number; nombre: string } | null;
}

export function UnidadesResidente() {
  const { data, loading, error, reload } = useResource<Unidad[] | { items: Unidad[] }>('/api/me/unidades');
  const unidades = data ? (Array.isArray(data) ? data : data.items) : [];

  return (
    <>
      <PageHeader title="Mis unidades" description="Departamentos, estacionamientos y depósitos a tu nombre." />
      {error ? (
        <Card><ErrorState message={error} onRetry={reload} /></Card>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-36 w-full" />)}</div>
      ) : unidades.length === 0 ? (
        <Card>
          <EmptyState icon={<KeyIcon />} title="Aún no tienes unidades asociadas" description="Cuando tu administradora te asigne una unidad, la verás aquí con sus recibos." />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {unidades.map(u => (
            <li key={u.id}>
              <Card className="h-full">
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">{u.codigo}</p>
                      <p className="text-sm text-muted"><span className="capitalize">{u.tipo}</span>{u.estructura?.nombre ? ` · ${u.estructura.nombre}` : ''}</p>
                    </div>
                    <StatusBadge estado={u.estado} />
                  </div>
                  <p className="flex items-center gap-2 text-sm"><BuildingStorefrontIcon className="h-4 w-4 shrink-0 text-muted" /><span className="truncate">{u.complejo?.nombre ?? 'Sin condominio'}</span></p>
                  <p className="flex items-center gap-2 text-sm"><UserIcon className="h-4 w-4 shrink-0 text-muted" /><span className={`truncate ${u.inquilino ? '' : 'text-muted'}`}>{u.inquilino ? `Inquilino: ${u.inquilino.nombre}` : 'Sin inquilino'}</span></p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
