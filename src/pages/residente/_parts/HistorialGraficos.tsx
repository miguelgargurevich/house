import type { ReactNode } from 'react';
import { ChartBarIcon, ScaleIcon } from '@heroicons/react/24/outline';
import { Alert, BarChart, Card, CardBody, CardHeader, EmptyState, LineChart, StatStrip, dineroCorto } from '../../../ui';
import { MIN_MESES_GRAFICO, cifras, cifrasPorMoneda, comparacionUltimoMes, cuentaMeses, seriesComparacionBlock, seriesPorConcepto, textoComparacion } from './historial';
import type { Historial } from './historial';

/** Las pestañas se acomodan en columnas de al menos 24 rem; cada tarjeta puede ocupar todo el ancho con `col-span-full`. */
export const REJILLA = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' } as const;

/** Con unidades de monedas distintas no hay un solo gráfico de dinero: se pide elegir una unidad (el servidor ya separa las cifras por moneda). */
export function AvisoMonedas() {
  return <Alert tone="info">Tus unidades están en condominios con monedas distintas: las cifras van separadas por moneda y no se suman. Elige una unidad para ver sus gráficos de dinero.</Alert>;
}

/** Lo que se muestra en lugar de una línea de evolución cuando el periodo tiene un solo mes (producción empieza con uno). */
export function SinMesesSuficientes({ icon = <ChartBarIcon /> }: { icon?: ReactNode }) {
  return <EmptyState icon={icon} title="Aún no hay meses suficientes" description="Con un solo mes no hay evolución que mostrar. Aparecerá con tu próximo recibo." />;
}

export function VistaResumen({ data }: { data: Historial }) {
  const conceptos = seriesPorConcepto(data.meses);
  return (
    <>
      <StatStrip stats={data.moneda !== null ? cifras(data.resumen, data.anio, data.moneda) : cifrasPorMoneda(data.resumen, data.anio)} />
      {data.moneda === null && <div className="mb-6"><AvisoMonedas /></div>}
      {data.resumen.meses_en_periodo === 1 && (
        <div className="mb-6"><Alert tone="info">Este es tu primer mes en Torre. Con cada recibo nuevo, estos gráficos te mostrarán cómo se mueve tu mantenimiento mes a mes.</Alert></div>
      )}

      {data.moneda !== null && (
        <div className="grid gap-6" style={REJILLA}>
          <Card className="min-w-0 col-span-full">
            <CardHeader title="Cuánto pagas cada mes" description="El total de tu mantenimiento, por concepto. Pasa el cursor sobre una barra para ver el detalle." />
            <CardBody>
              <BarChart stacked className="h-80" labels={conceptos.labels} series={conceptos.series} format={n => dineroCorto(n, data.moneda)} ariaLabel="Cuánto pagas cada mes, por concepto" tablaAccesible />
            </CardBody>
          </Card>
          <CompararConBlock data={data} />
        </div>
      )}
    </>
  );
}

/** Tu total contra el PROMEDIO del block: sólo el promedio, nunca el monto de un vecino (el servidor ni lo manda). */
function CompararConBlock({ data }: { data: Historial }) {
  const serie = seriesComparacionBlock(data.meses);
  const ultimo = comparacionUltimoMes(data.meses);
  return (
    <Card className="min-w-0 col-span-full">
      <CardHeader title="Tú contra tu block" description="Tu total de cada mes contra el promedio de las unidades de tu block en el mismo recibo." />
      <CardBody>
        {serie.variasUnidades ? (
          <EmptyState icon={<ScaleIcon />} title="Elige una unidad para comparar" description="El promedio es por unidad: con varias unidades juntas no se pueden comparar." />
        ) : !serie.hayPromedio || !ultimo ? (
          <EmptyState icon={<ScaleIcon />} title="Aún no hay un promedio para comparar" description="Aparece cuando hay suficientes recibos de otros vecinos en tu block como para que no se pueda adivinar el monto de ninguno." />
        ) : (
          <>
            <p className="mb-4 text-sm">{textoComparacion(ultimo, data.moneda)}</p>
            {cuentaMeses(data.meses) >= MIN_MESES_GRAFICO && (
              <LineChart labels={serie.labels} series={serie.series} format={n => dineroCorto(n, data.moneda)} ariaLabel="Tu total de cada mes contra el promedio del block" />
            )}
            <p className="mt-3 text-xs text-muted">Es un promedio de todas las unidades del recibo: nunca se muestra el monto de un vecino. Aparece sólo cuando hay suficientes unidades.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
