import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { BarChart, Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, StatStrip, soles } from '../../ui';
import { EstadoCargos } from './_parts/EstadoCargos';

interface Resumen {
  empresas_total: number;
  usuarios_total: number;
  unidades_total: number;
  cobrado_mes: number | string;
  cobrado_por_mes: { mes: string; emitido: number | string; cobrado: number | string }[];
  estados: { pagado: number; pendiente: number; vencido: number };
}

const mesCorto = (m: string) => {
  const s = new Intl.DateTimeFormat('es-PE', { month: 'short' }).format(new Date(`${m}-01T12:00:00`));
  return s.charAt(0).toUpperCase() + s.slice(1).replace('.', '');
};

export default function Dashboard() {
  const { data, loading, error, reload } = useResource<Resumen>('/api/dashboard/resumen');

  return (
    <>
      <PageHeader title="Resumen de la plataforma" description="Empresas, usuarios y cobranza de todos los condominios en House." />
      {error ? (
        <Card><ErrorState message={error} onRetry={reload} /></Card>
      ) : loading || !data ? (
        <div className="space-y-6" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: 'Empresas', value: data.empresas_total },
              { label: 'Usuarios', value: data.usuarios_total },
              { label: 'Unidades', value: data.unidades_total },
              { label: 'Cobrado este mes', value: soles(data.cobrado_mes), tone: 'ok' },
            ]}
          />
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}>
            <Card>
              <CardHeader title="Emitido vs. cobrado" description="Últimos 6 meses, en soles, de toda la plataforma." />
              <CardBody>
                <BarChart
                  labels={data.cobrado_por_mes.map(m => mesCorto(m.mes))}
                  series={[
                    { label: 'Emitido', token: 'muted', data: data.cobrado_por_mes.map(m => Number(m.emitido)) },
                    { label: 'Cobrado', token: 'brand', data: data.cobrado_por_mes.map(m => Number(m.cobrado)) },
                  ]}
                  format={n => `S/ ${n.toLocaleString('es-PE')}`}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Estado de mantenimientos" description="Un mantenimiento es un departamento en un mes. Todas las empresas." />
              <CardBody className="space-y-4">
                <EstadoCargos {...data.estados} />
                <Link to="/superadmin/empresas" className="inline-flex min-h-10 items-center gap-1.5 pt-2 text-sm font-medium text-brand hover:underline">
                  Ver empresas <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
