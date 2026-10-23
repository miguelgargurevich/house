import { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

interface Props { labels: string[]; series: { label: string; data: number[]; token: 'brand' | 'muted' }[]; format?: (n: number) => string }

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();
const color = (n: string, a = 1) => `oklch(${css(n)} / ${a})`;

/** Barras agrupadas con los colores del tema (se redibuja al cambiar claro/oscuro). */
export function BarChart({ labels, series, format = n => String(n) }: Props) {
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
            backgroundColor: s.token === 'brand' ? color('brand') : color('line'),
            borderRadius: 4,
            maxBarThickness: 28,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
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

  return <div className="h-64"><canvas ref={ref} role="img" aria-label="Gráfico de barras" /></div>;
}
