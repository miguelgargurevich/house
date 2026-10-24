import type { ReactNode } from 'react';
import { ChevronDownIcon } from '@heroicons/react/20/solid';

/** Select compacto (36 px) para barras de filtros; el kit sólo trae el de formulario. La flecha es propia: la nativa queda pegada al borde. */
export function FiltroSelect({ label, value, onChange, children, className = 'sm:w-48' }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <span className={`relative block w-full ${className}`}>
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded border border-line bg-surface px-3 pr-9 text-sm text-ink transition-colors duration-150 hover:border-muted/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
      >
        {children}
      </select>
      <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
    </span>
  );
}
