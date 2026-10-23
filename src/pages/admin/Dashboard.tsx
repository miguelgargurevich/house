import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { BarChart, Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, StatStrip, soles } from '../../ui';

interface Resumen {
  recibos_emitidos: number;
  cargos_pendientes_monto: number | string;
  cobrado_mes: number | string;
  morosos: number;
  unidades_total: number;
  tareas_abiertas: number;
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
      <PageHeader title="Resumen" description="Cobranza, morosidad y operación de tus condominios." />
      {error ? (
        <Card><ErrorState message={error} onRetry={reload} /></Card>
      ) : loading || !data ? (
        <div className="space-y-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: 'Cobrado este mes', value: soles(data.cobrado_mes), tone: 'ok' },
              { label: 'Por cobrar', value: soles(data.cargos_pendientes_monto), hint: `${data.estados.pendiente} cargos pendientes` },
              { label: 'Unidades morosas', value: data.morosos, tone: data.morosos > 0 ? 'bad' : undefined, hint: `de ${data.unidades_total} unidades` },
              { label: 'Tareas abiertas', value: data.tareas_abiertas },
            ]}
          />
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Emitido vs. cobrado" description="Últimos 6 meses, en soles." />
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
              <CardHeader title="Estado de cargos" />
              <CardBody className="space-y-4">
                {([['Pagados', data.estados.pagado, 'bg-ok/80'], ['Pendientes', data.estados.pendiente, 'bg-warn/80'], ['Vencidos', data.estados.vencido, 'bg-bad/80']] as const).map(([l, n, c]) => {
                  const total = data.estados.pagado + data.estados.pendiente + data.estados.vencido || 1;
                  return (
                    <div key={l}>
                      <div className="mb-1.5 flex justify-between text-sm"><span>{l}</span><span className="num font-medium">{n}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface2"><div className={`h-full rounded-full ${c}`} style={{ width: `${(n / total) * 100}%` }} /></div>
                    </div>
                  );
                })}
                <Link to="/admin/morosidad" className="inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-brand hover:underline">
                  Ver morosidad <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
