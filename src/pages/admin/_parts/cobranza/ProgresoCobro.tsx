import { soles } from '../../../../ui';

/** Barra de avance cobrado / total de un recibo. */
export function ProgresoCobro({ cobrado, total }: { cobrado: number | string; total: number | string }) {
  const c = Number(cobrado) || 0;
  const t = Number(total) || 0;
  const pct = t > 0 ? Math.min(100, Math.round((c / t) * 100)) : 0;
  return (
    <div className="min-w-36">
      <div
        role="progressbar"
        aria-label="Avance de cobranza"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 overflow-hidden rounded-full bg-surface2"
      >
        <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
      </div>
      <p className="num mt-1 text-xs text-muted">{pct} % · {soles(c)} de {soles(t)}</p>
    </div>
  );
}
