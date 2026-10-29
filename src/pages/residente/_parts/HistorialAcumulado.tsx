import { Card, CardBody, CardHeader, LineChart, dineroCorto } from '../../../ui';
import { PesoConceptos } from './HistorialConceptos';
import { AvisoMonedas, REJILLA, SinMesesSuficientes } from './HistorialGraficos';
import { MIN_MESES_GRAFICO, cuentaMeses, resumenAcumulado, seriesAcumulado, textoAcumulado } from './historial';
import type { Historial } from './historial';

export function VistaAcumulado({ data }: { data: Historial }) {
  if (data.moneda === null) return <AvisoMonedas />;
  const acumulado = seriesAcumulado(data.meses);
  const resumen = resumenAcumulado(data.meses);
  return (
    <div className="grid gap-6" style={REJILLA}>
      <Card className="min-w-0 col-span-full">
        <CardHeader title="Lo acumulado" description="Lo que te cobraron y lo que pagaste, sumado mes a mes. La distancia entre las dos líneas es lo pendiente." />
        <CardBody>
          <p className={`mb-4 text-sm ${resumen.pendiente > 0 ? 'font-medium' : ''}`}>{textoAcumulado(resumen, data.moneda)}</p>
          {cuentaMeses(data.meses) >= MIN_MESES_GRAFICO
            ? <LineChart labels={acumulado.labels} series={acumulado.series} format={n => dineroCorto(n, data.moneda)} ariaLabel="Lo que te cobraron y lo que pagaste, acumulado mes a mes" />
            : <SinMesesSuficientes />}
        </CardBody>
      </Card>

      <PesoConceptos meses={data.meses} moneda={data.moneda} titulo="Total del periodo por concepto" descripcion="Lo que te cobraron en todo el periodo, concepto por concepto." className="col-span-full" />
    </div>
  );
}
