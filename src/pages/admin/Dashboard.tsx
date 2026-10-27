import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { BarChart, Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, StatStrip, nombreDelMes, soles } from '../../ui';
import { SelectoresUbicacion } from './_parts/cobranza/SelectoresUbicacion';

interface Resumen {
  recibos_emitidos: number;
  cargos_pendientes_monto: number | string;
  cobrado_mes: number | string;
  morosos: number;
  unidades_total: number;
  tareas_abiertas: number;
  cobrado_por_mes: { mes: string; emitido: number | string; cobrado: number | string }[];
  estados: { pagado: number; pendiente: number; vencido: number };
  /** Cada torre tiene su propio recibo: lo emitido, cobrado y por cobrar de cada una. */
  por_torre?: { estructura_id: number | null; nombre: string; complejo: { id: number; nombre: string } | null; emitido: string; cobrado: string; por_cobrar: string; morosos: number }[];
}

/** «2026-09» → «Set» (las tres primeras letras del nombre de `nombreDelMes`: en el Perú, setiembre). */
const mesCorto = (m: string) => {
  const s = nombreDelMes(Number(m.slice(5, 7))).slice(0, 3);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function Dashboard() {
  const [complejo, setComplejo] = useState('');
  const [torre, setTorre] = useState('');
  const filtros = new URLSearchParams();
  if (complejo) filtros.set('complejo_id', complejo);
  if (torre) filtros.set('estructura_id', torre);
  const { data, loading, error, reload } = useResource<Resumen>(`/api/dashboard/resumen${filtros.size ? `?${filtros}` : ''}`);

  return (
    <>
      <PageHeader title="Resumen" description="Cobranza, morosidad y operación de tus condominios. Cada torre tiene su propio recibo: míralas juntas o filtra por una." />
      <div className="mb-4 flex flex-wrap gap-3"><SelectoresUbicacion complejo={complejo} torre={torre} onComplejo={setComplejo} onTorre={setTorre} /></div>
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
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}>
            <Card>
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
            {(data.por_torre?.length ?? 0) > 1 && (
              <Card style={{ gridColumn: '1 / -1' }}>
                <CardHeader title="Por torre" description="Emitido, cobrado y por cobrar de cada torre (todos los recibos)." />
                <CardBody>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Cobranza por torre</caption>
                      <thead><tr className="border-b border-line text-left text-xs text-muted">
                        <th scope="col" className="py-2 font-medium">Torre</th><th scope="col" className="py-2 text-right font-medium">Emitido</th><th scope="col" className="py-2 text-right font-medium">Cobrado</th><th scope="col" className="py-2 text-right font-medium">Por cobrar</th><th scope="col" className="py-2 text-right font-medium">Morosos</th>
                      </tr></thead>
                      <tbody className="divide-y divide-line">
                        {data.por_torre!.map(t => (
                          <tr key={t.estructura_id ?? 'sin'}>
                            <th scope="row" className="py-2 text-left font-medium">{t.nombre}{t.complejo && <span className="block text-xs font-normal text-muted">{t.complejo.nombre}</span>}</th>
                            <td className="num py-2 text-right">{soles(t.emitido)}</td><td className="num py-2 text-right">{soles(t.cobrado)}</td><td className="num py-2 text-right">{soles(t.por_cobrar)}</td><td className="num py-2 text-right">{t.morosos}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            )}
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
