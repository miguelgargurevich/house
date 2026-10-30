import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { useCondominio, useTorreElegida } from '../../app/condominio';
import { useResource } from '../../api';
import { monedaEnPlural } from '../../lib/paises';
import { Alert, BarChart, Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, StatStrip, dinero, dineroCorto, nombreDelMes, periodo } from '../../ui';
import { SelectoresUbicacion } from './_parts/cobranza/SelectoresUbicacion';

/** Mantenimientos (un departamento en un mes) por estado. Suman todos los mantenimientos del alcance. */
interface Estados { pagado: number; pendiente: number; parcial: number; vencido: number; en_revision: number }

/** Lo que se cobra y se debe, en UNA moneda. */
interface DineroPanel {
  cargos_pendientes_monto: number | string;
  cobrado_mes: number | string;
  cobrado_por_mes: { mes: string; emitido: number | string; cobrado: number | string }[];
}

interface Resumen extends Partial<DineroPanel> {
  recibos_emitidos: number;
  /** Moneda de las cifras; `null` si el alcance mezcla condominios de monedas distintas (entonces van por moneda en `por_moneda`, nunca sumadas). */
  moneda: string | null;
  por_moneda?: Record<string, DineroPanel>;
  morosos: number;
  unidades_total: number;
  tareas_abiertas: number;
  estados: Estados;
  /** Cómo llama el condominio a sus edificios: «block» si todos son blocks, si no «torre». */
  palabra_estructura: 'block' | 'torre';
  /** Cada torre tiene su propio recibo: lo emitido, cobrado y por cobrar de cada una. */
  por_torre?: { estructura_id: number | null; nombre: string; complejo: { id: number; nombre: string } | null; moneda: string; emitido: string; cobrado: string; por_cobrar: string; morosos: number; mes?: { anio: number; mes: number } | null; emitido_mes?: string; cobrado_mes?: string }[];
}

/** Los textos del panel según cómo se llama el edificio en el condominio. */
const PALABRA = {
  block: { una: 'block', titulo: 'Block', mira: 'míralos juntos o filtra por uno' },
  torre: { una: 'torre', titulo: 'Torre', mira: 'míralas juntas o filtra por una' },
};

/** Estado de mantenimientos: etiqueta y color de la barra. */
const ESTADOS: [keyof Estados, string, string][] = [
  ['pagado', 'Pagados', 'bg-ok/80'],
  ['pendiente', 'Pendientes', 'bg-warn/80'],
  ['parcial', 'Pago parcial', 'bg-warn/40'],
  ['vencido', 'Vencidos', 'bg-bad/80'],
  ['en_revision', 'En revisión', 'bg-brand/60'],
];

/** «2026-09» → «Set» (las tres primeras letras del nombre de `nombreDelMes`: en el Perú, setiembre). */
const mesCorto = (m: string) => {
  const s = nombreDelMes(Number(m.slice(5, 7))).slice(0, 3);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Los mantenimientos que todavía no se pagaron (incluye los que están en revisión, como «Por cobrar»). */
const sinPagar = (e: Estados) => e.pendiente + e.parcial + e.vencido + e.en_revision;

export default function Dashboard() {
  const { complejo } = useCondominio();
  const [torre, setTorre] = useTorreElegida();
  const filtros = new URLSearchParams();
  if (complejo) filtros.set('complejo_id', complejo);
  if (torre) filtros.set('estructura_id', torre);
  const { data, loading, error, reload } = useResource<Resumen>(`/api/dashboard/resumen${filtros.size ? `?${filtros}` : ''}`);
  const palabra = PALABRA[data?.palabra_estructura ?? 'torre'];
  // Una moneda: las cifras de siempre. Varias: un juego de cifras y un gráfico por moneda (nunca se suman).
  const bloques: [string, DineroPanel][] = !data ? [] : data.moneda !== null ? [[data.moneda, data as DineroPanel]] : Object.entries(data.por_moneda ?? {});
  const variasMonedas = data?.moneda === null;

  return (
    <>
      <PageHeader title="Resumen" description={`Cobranza, morosidad y operación de tus condominios. Cada ${palabra.una} tiene su propio recibo: ${palabra.mira}.`} />
      <SelectoresUbicacion torre={torre} onTorre={setTorre} envoltura="fila" />
      {error ? (
        <Card><ErrorState message={error} onRetry={reload} /></Card>
      ) : loading || !data ? (
        <div className="space-y-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>
      ) : (
        <>
          {variasMonedas && <div className="mb-4"><Alert>Tus condominios cobran en más de una moneda: las cifras van separadas por moneda y no se suman. Elige un condominio arriba para ver uno solo.</Alert></div>}
          <StatStrip
            stats={[
              ...bloques.flatMap(([moneda, b], i) => [
                { label: variasMonedas ? `Cobrado este mes (${moneda})` : 'Cobrado este mes', value: dinero(b.cobrado_mes, moneda), tone: 'ok' as const },
                { label: variasMonedas ? `Por cobrar (${moneda})` : 'Por cobrar', value: dinero(b.cargos_pendientes_monto, moneda), hint: i === 0 ? `${sinPagar(data.estados)} mantenimientos sin pagar` : undefined },
              ]),
              { label: 'Unidades morosas', value: data.morosos, tone: data.morosos > 0 ? 'bad' : undefined, hint: `de ${data.unidades_total} unidades` },
              { label: 'Tareas abiertas', value: data.tareas_abiertas },
            ]}
          />
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}>
            {bloques.map(([moneda, b]) => (
              <Card key={moneda}>
                <CardHeader title="Emitido vs. cobrado" description={`Últimos 6 meses, en ${monedaEnPlural(moneda)}.`} />
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
            {(data.por_torre?.length ?? 0) > 1 && <CobradoPorTorre torres={data.por_torre!} palabra={palabra.una} />}
            {(data.por_torre?.length ?? 0) > 1 && (
              <Card style={{ gridColumn: '1 / -1' }}>
                <CardHeader title={`Por ${palabra.una}`} description={`Emitido, cobrado y por cobrar de cada ${palabra.una} (todos los recibos).`} />
                <CardBody>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">{`Cobranza por ${palabra.una}`}</caption>
                      <thead><tr className="border-b border-line text-left text-xs text-muted">
                        <th scope="col" className="py-2 font-medium">{palabra.titulo}</th><th scope="col" className="py-2 text-right font-medium">Emitido</th><th scope="col" className="py-2 text-right font-medium">Cobrado</th><th scope="col" className="py-2 text-right font-medium">Por cobrar</th><th scope="col" className="py-2 text-right font-medium">Morosos</th>
                      </tr></thead>
                      <tbody className="divide-y divide-line">
                        {data.por_torre!.map(t => (
                          <tr key={t.estructura_id ?? 'sin'}>
                            <th scope="row" className="py-2 text-left font-medium">{t.nombre}{t.complejo && <span className="block text-xs font-normal text-muted">{t.complejo.nombre}</span>}</th>
                            <td className="num py-2 text-right">{dinero(t.emitido, t.moneda)}</td><td className="num py-2 text-right">{dinero(t.cobrado, t.moneda)}</td><td className="num py-2 text-right">{dinero(t.por_cobrar, t.moneda)}</td><td className="num py-2 text-right">{t.morosos}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader title="Estado de mantenimientos" description="Un mantenimiento es un departamento en un mes." />
              <CardBody className="space-y-4">
                {ESTADOS.map(([clave, l, c]) => {
                  const n = data.estados[clave];
                  const total = Object.values(data.estados).reduce((a, b) => a + b, 0) || 1;
                  return (
                    <div key={clave}>
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

/** «% cobrado de <mes> por block»: del último periodo emitido, qué parte de lo facturado a cada torre ya está pagado; de mayor a menor. */
function CobradoPorTorre({ torres, palabra }: { torres: NonNullable<Resumen['por_torre']>; palabra: string }) {
  const filas = torres
    .filter(t => Number(t.emitido_mes ?? 0) > 0)
    .map(t => ({ ...t, pct: Math.round((Number(t.cobrado_mes) / Number(t.emitido_mes)) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  const mes = torres.find(t => t.mes)?.mes;
  if (!filas.length || !mes) return null;
  const tono = (pct: number) => (pct >= 90 ? 'bg-ok' : pct >= 70 ? 'bg-brand' : pct >= 50 ? 'bg-warn' : 'bg-bad');
  return (
    <Card>
      <CardHeader title={`% cobrado por ${palabra}`} description={`${periodo(mes.mes, mes.anio)}: qué parte de lo emitido a cada ${palabra} ya está pagado.`} />
      <CardBody>
        <ul className="space-y-2.5" aria-label={`Porcentaje cobrado de ${periodo(mes.mes, mes.anio).toLowerCase()} por ${palabra}`}>
          {filas.map(t => (
            <li key={t.estructura_id ?? t.nombre} className="grid grid-cols-[minmax(4.5rem,auto)_1fr_3.25rem] items-center gap-3 text-sm">
              <span className="truncate font-medium" title={t.complejo ? `${t.nombre} · ${t.complejo.nombre}` : t.nombre}>{t.nombre}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-surface2" title={`${dinero(t.cobrado_mes ?? 0, t.moneda)} de ${dinero(t.emitido_mes ?? 0, t.moneda)}`}>
                <span className={`block h-full rounded-full ${tono(t.pct)}`} style={{ width: `${Math.min(100, t.pct)}%` }} />
              </span>
              <span className="num text-right font-medium">{t.pct.toLocaleString('es-PE', { maximumFractionDigits: 1 })} %</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
