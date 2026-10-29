import { ClockIcon, CloudIcon } from '@heroicons/react/24/outline';
import { BarChart, Card, CardBody, CardHeader, EmptyState, LineChart, dinero, dineroCorto } from '../../../ui';
import { REJILLA } from './HistorialGraficos';
import { MIN_MESES_GRAFICO, costoPorM3, cuentaMeses, diasCorto, seriesAgua, seriesPuntualidad, textoPuntualidad } from './historial';
import type { Historial } from './historial';

const metros = (n: number) => `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })} m³`;

export function VistaAgua({ data }: { data: Historial }) {
  const agua = seriesAgua(data.meses);
  const costo = costoPorM3(data.meses);
  return (
    <div className="grid gap-6" style={REJILLA}>
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

      {agua.hayLecturas && data.moneda !== null && (
        <Card className="min-w-0">
          <CardHeader title="Costo por m³" description="Lo que te cobraron por el agua, dividido entre tus m³ de ese mes." />
          <CardBody>
            {costo.hayDatos ? (
              <>
                {costo.promedio !== null && <p className="mb-4 text-sm">En el periodo pagaste en promedio <strong className="font-semibold">{dinero(costo.promedio, data.moneda)}</strong> por cada m³.</p>}
                {cuentaMeses(data.meses) >= MIN_MESES_GRAFICO && (
                  <LineChart labels={costo.labels} series={costo.series} format={n => dineroCorto(n, data.moneda)} ariaLabel="Costo del agua por metro cúbico, mes a mes" />
                )}
                <p className="mt-3 text-xs text-muted">Sale del monto del concepto de agua de tu recibo; si ese concepto incluye un cargo fijo, también cuenta.</p>
              </>
            ) : (
              <EmptyState icon={<CloudIcon />} title="No se puede calcular todavía" description="Hace falta tu consumo y un solo concepto de agua en el mismo recibo." />
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export function VistaPuntualidad({ data }: { data: Historial }) {
  const puntualidad = seriesPuntualidad(data.meses);
  const texto = textoPuntualidad(data.resumen);
  return (
    <Card className="min-w-0">
      <CardHeader title="Puntualidad" description="Cuántos días antes o después del vencimiento pagaste cada mes." />
      <CardBody>
        {puntualidad.hayPagos ? (
          <>
            {texto && <p className="mb-4 text-sm font-medium">{texto}</p>}
            <BarChart stacked labels={puntualidad.labels} series={puntualidad.series} format={diasCorto} enteros ariaLabel="Días antes o después del vencimiento en que pagaste cada mes" tablaAccesible />
            <p className="mt-3 text-xs text-muted">Debajo del cero pagaste antes de que venciera; arriba, después. Con varias unidades se muestra la que pagó más tarde.</p>
          </>
        ) : (
          <EmptyState icon={<ClockIcon />} title="Aún no hay pagos para medir" description="Cuando pagues un mantenimiento verás si lo hiciste antes o después de su vencimiento." />
        )}
      </CardBody>
    </Card>
  );
}
