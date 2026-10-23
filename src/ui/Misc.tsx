import type { ReactNode } from 'react';
import { cx } from './cx';
import { iniciales } from './format';

export function Avatar({ nombre, size = 'md' }: { nombre: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand', size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm')}
    >
      {iniciales(nombre)}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex gap-1 rounded-lg bg-surface2 p-1">
      {items.map(i => (
        <button
          key={i.id}
          role="tab"
          aria-selected={value === i.id}
          onClick={() => onChange(i.id)}
          className={cx('rounded px-3 py-1.5 text-sm font-medium transition-colors duration-150', value === i.id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">{children}</div>;
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map(i => (
        <div key={i.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="mt-1 text-sm">{i.value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
