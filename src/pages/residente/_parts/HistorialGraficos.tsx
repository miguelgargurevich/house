import { ArrowDownTrayIcon, ChartBarIcon, CloudIcon, ClockIcon } from '@heroicons/react/24/outline';
import { Alert, BarChart, Button, Card, CardBody, CardHeader, EmptyState, LineChart, Select, StatStrip, soles } from '../../../ui';
import { cifras, diasCorto, seriesAgua, seriesPorConcepto, seriesPuntualidad } from './historial';
import type { Historial } from './historial';

const monto = (n: number) => (Number.isInteger(n) ? `S/ ${n.toLocaleString('es-PE')}` : soles(n));
const metros = (n: number) => `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })} m³`;

export interface VistaResumenProps {
  data: Historial;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  unidad: string;
  anio: string;
  setUnidad: (v: string) => void;
  setAnio: (v: string) => void;
  consulta: string;
}

export function VistaResumen({ data, loading, error, onRetry, unidad, anio, setUnidad, setAnio, consulta }: VistaResumenProps) {
  const hayMeses = data.meses.length > 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {data.unidades.length > 1 && (
          <Select label="Unidad" value={unidad} onChange={e => setUnidad(e.target.value)} className="w-full sm:w-56">
            <option value="">Todas mis unidades</option>
            {data.unidades.map(u => <option key={u.id} value={u.id}>{u.codigo}{u.estructura?.nombre ? ` · ${u.estructura.nombre}` : ''}</option>)}
          </Select>
        )}
        {data.anios.length > 1 && (
          <Select label="Periodo" value={anio} onChange={e => setAnio(e.target.value)} className="w-full sm:w-56">
            <option value="">Últimos 12 meses</option>
            {data.anios.map(a => <option key={a} value={a}>{a}</option>)}
          </Select>
        )}
        {hayMeses && (
          <Button variant="secondary" icon={<ArrowDownTrayIcon className="h-4 w-4" />} onClick={() => window.location.assign(`/api/me/historial.xlsx${consulta}`)}>
            Descargar Excel
          </Button>
        )}
      </div>

      {error && <Alert tone="bad">{error} <button type="button" className="font-medium underline" onClick={onRetry}>Reintentar</button></Alert>}

      <div aria-busy={loading || undefined} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {!hayMeses ? (
          <Card>
            <EmptyState icon={<ChartBarIcon />} title="Aún no tienes recibos" description="Cuando la administración emita tu primer mantenimiento, aquí verás cuánto pagas cada mes." />
          </Card>
        ) : (
          <Graficos data={data} />
        )}
      </div>
    </div>
  );
}

export function Graficos({ data }: { data: Historial }) {
  const conceptos = seriesPorConcepto(data.meses);
  const agua = seriesAgua(data.meses);
  const puntualidad = seriesPuntualidad(data.meses);
  return (
    <>
      <StatStrip stats={cifras(data.resumen, data.anio)} />
      {data.resumen.meses_en_periodo === 1 && (
        <div className="mb-6"><Alert tone="info">Este es tu primer mes en House. Con cada recibo nuevo, estos gráficos te mostrarán cómo se mueve tu mantenimiento mes a mes.</Alert></div>
      )}

      <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}>
        <Card className="min-w-0 col-span-full">
          <CardHeader title="Cuánto pagas cada mes" description="El total de tu mantenimiento, por concepto. Pasa el cursor sobre una barra para ver el detalle." />
          <CardBody>
            <BarChart stacked className="h-80" labels={conceptos.labels} series={conceptos.series} format={monto} ariaLabel="Cuánto pagas cada mes, por concepto" tablaAccesible />
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Agua" description="Tu consumo en m³ contra el promedio de tu block." />
          <CardBody>
            {agua.hayLecturas ? (
              <>
                <LineChart labels={agua.labels} series={agua.series} format={metros} ariaLabel="Tu consumo de agua contra el promedio del block, en metros cúbicos" />
                <p className="mt-3 text-xs text-muted">El promedio del block aparece cuando hay al menos 3 lecturas en ese recibo.</p>
              </>
            ) : (
              <EmptyState icon={<CloudIcon />} title="Aún no hay lecturas de agua" description="Cuando la administración cargue la lectura de tu medidor, verás tu consumo mes a mes." />
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Puntualidad" description="Cuántos días antes o después del vencimiento pagaste cada mes." />
          <CardBody>
            {puntualidad.hayPagos ? (
              <>
                <BarChart stacked labels={puntualidad.labels} series={puntualidad.series} format={diasCorto} enteros ariaLabel="Días antes o después del vencimiento en que pagaste cada mes" tablaAccesible />
                <p className="mt-3 text-xs text-muted">Debajo del cero pagaste antes de que venciera; arriba, después. Con varias unidades se muestra la que pagó más tarde.</p>
              </>
            ) : (
              <EmptyState icon={<ClockIcon />} title="Aún no hay pagos para medir" description="Cuando pagues un mantenimiento verás si lo hiciste antes o después de su vencimiento." />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
