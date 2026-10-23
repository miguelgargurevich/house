import { Link } from 'react-router-dom';
import { ArrowRightIcon, KeyIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, StatStrip } from '../../ui';

interface Resumen { unidades_complejo: number; complejo: string | { id?: number; nombre: string } | null }

export default function Inicio() {
  const { data, loading, error, reload } = useResource<Resumen>('/api/dashboard/resumen');
  const nombre = typeof data?.complejo === 'string' ? data.complejo : data?.complejo?.nombre;

  return (
    <>
      <PageHeader title="Inicio" description="Condominio asignado y consulta rápida de unidades." />
      {error ? (
        <Card><ErrorState message={error} onRetry={reload} /></Card>
      ) : loading || !data ? (
        <div className="space-y-6" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-32 w-full" /></div>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: 'Condominio asignado', value: nombre ?? 'Sin asignar' },
              { label: 'Unidades', value: data.unidades_complejo },
            ]}
          />
          <Card>
            <CardHeader title="Consultar unidades" description="Mira el propietario y el inquilino de cada unidad antes de autorizar una visita." />
            <CardBody>
              <Link to="/seguridad/unidades" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-brand hover:underline">
                <KeyIcon className="h-4 w-4" /> Ir a Unidades <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}
