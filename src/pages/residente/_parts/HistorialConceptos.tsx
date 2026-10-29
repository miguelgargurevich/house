import { useState } from 'react';
import { ArrowTrendingUpIcon } from '@heroicons/react/24/outline';
import { Alert, Card, CardBody, CardHeader, LineChart, ProgressBar, Select, dinero, dineroCorto } from '../../../ui';
import { AvisoMonedas, REJILLA, SinMesesSuficientes } from './HistorialGraficos';
import { MIN_MESES_GRAFICO, conceptosDelPeriodo, cuentaMeses, masSubio, pesoPorConcepto, serieDeConcepto, tablaConceptos } from './historial';
import type { Historial, MesHistorial } from './historial';

const porcentaje = (n: number) => `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`;

/** Cuánto suma cada concepto en el periodo y qué parte del total es: una fila por concepto, con su barra. Se usa en «Por concepto» y en «Acumulado». */
export function PesoConceptos({ meses, moneda, titulo, descripcion, className = '' }: { meses: MesHistorial[]; moneda: string | null; titulo: string; descripcion: string; className?: string }) {
  const peso = pesoPorConcepto(meses);
  return (
    <Card className={`min-w-0 ${className}`}>
      <CardHeader title={titulo} description={descripcion} />
      <CardBody>
        {peso.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay montos que repartir.</p>
        ) : (
          <ul className="space-y-4">
            {peso.map(p => (
              <li key={p.concepto}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words font-medium">{p.concepto}</span>
                  <span className="shrink-0 text-muted num">{dinero(p.monto, moneda)} · {porcentaje(p.pct)}</span>
                </div>
                <ProgressBar value={p.pct} label={`${p.concepto}: ${porcentaje(p.pct)} del total`} valueText={`${porcentaje(p.pct)} del total del periodo`} tone="brand" />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function VistaPorConcepto({ data }: { data: Historial }) {
  const conceptos = conceptosDelPeriodo(data.meses);
  const [elegido, setElegido] = useState('');
  if (data.moneda === null) return <AvisoMonedas />;
  const concepto = conceptos.includes(elegido) ? elegido : conceptos[0] ?? '';
  const linea = serieDeConcepto(data.meses, concepto);
  const sube = masSubio(data.meses);
  const hayMeses = cuentaMeses(data.meses) >= MIN_MESES_GRAFICO;
  const tabla = tablaConceptos(data.meses);
  return (
    <div className="space-y-6">
      {hayMeses && (
        sube
          ? <Alert tone="warn"><strong className="font-semibold">El que más subió: {sube.concepto}.</strong> Pasó de {dinero(sube.desde.monto, data.moneda)} en {sube.desde.mes} a {dinero(sube.hasta.monto, data.moneda)} en {sube.hasta.mes} (+{dinero(sube.diferencia, data.moneda)}, +{sube.pct} %).</Alert>
          : <Alert tone="ok">Ningún concepto subió entre tu primer y tu último mes.</Alert>
      )}

      <div className="grid gap-6" style={REJILLA}>
        <Card className="min-w-0">
          <CardHeader title="Un concepto mes a mes" description="Elige el concepto y mira cómo cambió su monto." />
          <CardBody>
            <Select label="Concepto" value={concepto} onChange={e => setElegido(e.target.value)} className="mb-4 w-full sm:w-72">
              {conceptos.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            {hayMeses
              ? <LineChart labels={linea.labels} series={linea.series} format={n => dineroCorto(n, data.moneda)} ariaLabel={`Cuánto pagaste de ${concepto} cada mes`} />
              : <SinMesesSuficientes icon={<ArrowTrendingUpIcon />} />}
          </CardBody>
        </Card>

        <PesoConceptos meses={data.meses} moneda={data.moneda} titulo="Cuánto pesa cada concepto" descripcion="Qué parte de tu total del periodo es cada concepto." />
      </div>

      <Card className="min-w-0">
        <CardHeader title="Concepto por mes" description="Lo que pagaste de cada concepto, mes a mes." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <caption className="sr-only">Monto de cada concepto en cada mes del periodo</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="sticky left-0 bg-surface px-5 py-3 font-medium">Concepto</th>
                {tabla.labels.map(l => <th key={l} scope="col" className="px-3 py-3 text-right font-medium">{l}</th>)}
                <th scope="col" className="px-5 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {tabla.filas.map(f => (
                <tr key={f.concepto} className="border-b border-line last:border-0">
                  <th scope="row" className="sticky left-0 bg-surface px-5 py-3 text-left font-medium">{f.concepto}</th>
                  {f.montos.map((m, i) => <td key={i} className="px-3 py-3 text-right num">{m === 0 ? <span className="text-muted">—</span> : dinero(m, data.moneda)}</td>)}
                  <td className="px-5 py-3 text-right font-semibold num">{dinero(f.total, data.moneda)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface2 font-semibold">
                <th scope="row" className="sticky left-0 bg-surface2 px-5 py-3 text-left">Total</th>
                {tabla.totales.map((m, i) => <td key={i} className="px-3 py-3 text-right num">{dinero(m, data.moneda)}</td>)}
                <td className="px-5 py-3 text-right num">{dinero(tabla.totalGeneral, data.moneda)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
