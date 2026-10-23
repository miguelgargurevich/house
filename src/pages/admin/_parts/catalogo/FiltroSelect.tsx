import type { ReactNode } from 'react';

/** Select compacto (36 px) para barras de filtros; el kit sólo trae el de formulario. */
export function FiltroSelect({ label, value, onChange, children, className = 'sm:w-48' }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`h-9 w-full rounded border border-line bg-surface px-3 pr-8 text-sm text-ink transition-colors duration-150 hover:border-muted/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 ${className}`}
    >
      {children}
    </select>
  );
}
