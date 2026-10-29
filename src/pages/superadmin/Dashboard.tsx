import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { monedaEnPlural } from '../../lib/paises';
import { Alert, BarChart, Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, StatStrip, dinero, dineroCorto } from '../../ui';
import { EstadoCargos } from './_parts/EstadoCargos';

/** Lo cobrado, en UNA moneda. */
interface DineroPlataforma {
  cobrado_mes: number | string;
  cobrado_por_mes: { mes: string; emitido: number | string; cobrado: number | string }[];
}

interface Resumen extends Partial<DineroPlataforma> {
  empresas_total: number;
  usuarios_total: number;
  unidades_total: number;
  /** `null` si hay condominios de monedas distintas: las cifras van por moneda en `por_moneda`, nunca sumadas. */
  moneda: string | null;
  por_moneda?: Record<string, DineroPlataforma>;
  estados: { pagado: number; pendiente: number; vencido: number };
}

const mesCorto = (m: string) => {
  const s = new Intl.DateTimeFormat('es-PE', { month: 'short' }).format(new Date(`${m}-01T12:00:00`));
  return s.charAt(0).toUpperCase() + s.slice(1).replace('.', '');
};

export default function Dashboard() {
  const { data, loading, error, reload } = useResource<Resumen>('/api/dashboard/resumen');
  const bloques: [string, DineroPlataforma][] = !data ? [] : data.moneda !== null ? [[data.moneda, data as DineroPlataforma]] : Object.entries(data.por_moneda ?? {});
  const variasMonedas = data?.moneda === null;

  return (
    <>
      <PageHeader title="Resumen de la plataforma" description="Empresas, usuarios y cobranza de todos los condominios en House." />
      {error ? (
        <Card><ErrorState message={error} onRetry={reload} /></Card>
      ) : loading || !data ? (
        <div className="space-y-6" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>
      ) : (
        <>
          {variasMonedas && <div className="mb-4"><Alert>Hay condominios que cobran en monedas distintas: las cifras van separadas por moneda y no se suman.</Alert></div>}
          <StatStrip
            stats={[
              { label: 'Empresas', value: data.empresas_total },
              { label: 'Usuarios', value: data.usuarios_total },
              { label: 'Unidades', value: data.unidades_total },
              ...bloques.map(([moneda, b]) => ({ label: variasMonedas ? `Cobrado este mes (${moneda})` : 'Cobrado este mes', value: dinero(b.cobrado_mes, moneda), tone: 'ok' as const })),
            ]}
          />
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}>
            {bloques.map(([moneda, b]) => (
              <Card key={moneda}>
                <CardHeader title="Emitido vs. cobrado" description={`Últimos 6 meses, en ${monedaEnPlural(moneda)}, de toda la plataforma.`} />
                <CardBody>
                  <BarChart
                    labels={b.cobrado_por_mes.map(m => mesCorto(m.mes))}
                    series={[
                      { label: 'Emitido', token: 'muted', data: b.cobrado_por_mes.map(m => Number(m.emitido)) },
                      { label: 'Cobrado', token: 'brand', data: b.cobrado_por_mes.map(m => Number(m.cobrado)) },
                    ]}
                    format={n => dineroCorto(n, moneda)}
                  />
                </CardBody>
              </Card>
            ))}
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
