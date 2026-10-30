import { TruckIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../../api';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../../ui';
import { ProveedorVecinoCard } from './ProveedorVecinoCard';
import type { GrupoProveedores } from './enlaces';

/** «Proveedores» del residente (propietario o inquilino): los que la administración marcó como visibles para los vecinos de su condominio, por rubro. */
export function ProveedoresResidente() {
  const r = useResource<{ items: GrupoProveedores[] }>('/api/me/proveedores');
  const items = r.data?.items ?? [];
  return (
    <>
      <PageHeader title="Proveedores" description="Servicios de confianza que tu administración comparte contigo (ascensores, gasfitería, pintura…), con su teléfono y correo para contactarlos." />
      {r.error ? (
        <Card><ErrorState message={r.error} onRetry={r.reload} /></Card>
      ) : r.loading && !r.data ? (
        <div className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<TruckIcon />} title="Tu administración aún no comparte proveedores" description="Cuando la administración o tu junta marque proveedores para los vecinos, los verás aquí con sus datos de contacto." /></Card>
      ) : (
        <div className="space-y-4">{items.map(g => <ProveedorVecinoCard key={g.rubro} grupo={g} />)}</div>
      )}
    </>
  );
}
