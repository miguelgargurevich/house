import { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { color, colorCategoria, type TokenGrafico } from './chartTema';
import { TablaGrafico } from './TablaGrafico';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

interface Serie {
  label: string;
  /** `null` = sin dato ese mes (no se dibuja barra). */
  data: (number | null)[];
  token?: TokenGrafico;
  /** Color de categoría (0…6; `CATEGORIA_OTROS` = gris), p. ej. un color por concepto. Manda sobre `token`. */
  categoria?: number;
}
interface Props {
  labels: string[];
  series: Serie[];
  format?: (n: number) => string;
  /** Barras apiladas: un solo montón por mes, con el total en el tooltip. */
  stacked?: boolean;
  /** Alto del gráfico (clase de Tailwind). */
  className?: string;
  ariaLabel?: string;
  /** Marcas del eje sólo en números enteros (días, unidades): con un valor chico no salen «0.4 d». */
  enteros?: boolean;
  /** Repite los datos como tabla para lectores de pantalla. */
  tablaAccesible?: boolean;
}

/** Color de una barra: `brand` es el acento; `muted` sigue siendo el tono suave de `line` (el de las barras «emitido» de los resúmenes). */
const colorBarra = (s: Serie) => (s.categoria !== undefined ? colorCategoria(s.categoria) : s.token === 'brand' ? color('brand') : s.token === 'ok' || s.token === 'warn' || s.token === 'bad' ? color(s.token) : color('line'));

/** Barras agrupadas (o apiladas) con los colores del tema (se redibuja al cambiar claro/oscuro). */
export function BarChart({ labels, series, format = n => String(n), stacked = false, className = 'h-64', ariaLabel = 'Gráfico de barras', tablaAccesible = false, enteros = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const draw = () => {
      chart?.destroy();
      chart = new Chart(ref.current!, {
        type: 'bar',
        data: {
          labels,
          datasets: series.map(s => ({
            label: s.label,
            data: s.data,
            backgroundColor: colorBarra(s),
            // Apiladas: un filo del color de la superficie separa los tramos sin depender sólo del color.
            borderColor: stacked ? color('surface') : undefined,
            borderWidth: stacked ? 1.5 : 0,
            borderRadius: stacked ? 2 : 4,
            maxBarThickness: 28,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          ...(stacked ? { interaction: { mode: 'index' as const, intersect: false } } : {}),
          plugins: {
            legend: { position: 'bottom', labels: { color: color('muted'), boxWidth: 10, boxHeight: 10, usePointStyle: true } },
            tooltip: {
              callbacks: {
                label: c => `${c.dataset.label}: ${format(Number(c.parsed.y))}`,
                // Sólo si hay más de un tramo ese mes: el total del montón.
                footer: items => (stacked && items.length > 1 ? `Total: ${format(items.reduce((a, c) => a + Number(c.parsed.y), 0))}` : ''),
              },
            },
          },
          scales: {
            x: { stacked, grid: { display: false }, ticks: { color: color('muted') }, border: { display: false } },
            y: { stacked, grid: { color: color('line', 0.6) }, ticks: { color: color('muted'), callback: v => format(Number(v)), ...(enteros ? { precision: 0 } : {}) }, border: { display: false }, beginAtZero: true },
          },
        },
      });
    };
    let chart: Chart | undefined;
    draw();
    const obs = new MutationObserver(draw);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => { obs.disconnect(); chart?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(labels), JSON.stringify(series), stacked, enteros]);

  return (
    <>
      <div className={className}><canvas ref={ref} role="img" aria-label={ariaLabel} /></div>
      {tablaAccesible && <TablaGrafico titulo={ariaLabel} labels={labels} series={series} format={format} />}
    </>
  );
}
