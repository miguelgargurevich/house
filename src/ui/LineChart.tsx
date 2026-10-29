import { useEffect, useRef } from 'react';
import { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { color, colorCategoria, type TokenGrafico } from './chartTema';
import { TablaGrafico } from './TablaGrafico';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

interface Serie {
  label: string;
  /** `null` = sin dato ese mes: la línea se corta en vez de caer a cero. */
  data: (number | null)[];
  token?: TokenGrafico;
  /** Color de categoría (0…6; `CATEGORIA_OTROS` = gris). Manda sobre `token`. */
  categoria?: number;
  /** Línea de puntos: para una referencia (p. ej. el promedio del block) junto a la serie propia. */
  punteada?: boolean;
}
interface Props { labels: string[]; series: Serie[]; format?: (n: number) => string; ariaLabel?: string }

const colorDe = (s: Serie) => (s.categoria !== undefined ? colorCategoria(s.categoria) : color(s.token ?? 'muted'));

/** Líneas con los colores del tema (se redibuja al cambiar claro/oscuro). Con un solo mes se ven los puntos, no una línea vacía. */
export function LineChart({ labels, series, format = n => String(n), ariaLabel = 'Gráfico de líneas' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const draw = () => {
      chart?.destroy();
      chart = new Chart(ref.current!, {
        type: 'line',
        data: {
          labels,
          datasets: series.map(s => ({
            label: s.label,
            data: s.data,
            borderColor: colorDe(s),
            backgroundColor: colorDe(s),
            borderWidth: 2,
            borderDash: s.punteada ? [6, 4] : [],
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.25,
            spanGaps: false,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { color: color('muted'), boxWidth: 10, boxHeight: 10, usePointStyle: true } },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${format(Number(c.parsed.y))}` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: color('muted') }, border: { display: false } },
            y: { grid: { color: color('line', 0.6) }, ticks: { color: color('muted'), callback: v => format(Number(v)) }, border: { display: false }, beginAtZero: true },
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
  }, [JSON.stringify(labels), JSON.stringify(series)]);

  return (
    <>
      <div className="h-64"><canvas ref={ref} role="img" aria-label={ariaLabel} /></div>
      <TablaGrafico titulo={ariaLabel} labels={labels} series={series} format={format} />
    </>
  );
}
