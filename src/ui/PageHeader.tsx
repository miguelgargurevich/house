import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export interface Stat { label: string; value: ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'bad' }

/** Franja de indicadores: una sola superficie dividida, no cuatro tarjetas iguales. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  const color = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };
  return (
    <dl className="mb-6 grid gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11.5rem), 1fr))' }}>
      {stats.map((s, i) => (
        <div key={i} className="min-w-0 bg-surface p-4 sm:p-5">
          <dt className="text-sm text-muted">{s.label}</dt>
          <dd className={`mt-1 break-words text-xl font-semibold num sm:text-2xl ${s.tone ? color[s.tone] : ''}`}>{s.value}</dd>
          {s.hint && <p className="mt-0.5 text-xs text-muted">{s.hint}</p>}
        </div>
      ))}
    </dl>
  );
}
