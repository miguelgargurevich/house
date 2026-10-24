import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './cx';
import { moverTab } from './a11y';
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

interface TabsProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string }[];
  /** Prefijo de los `id` de pestañas y paneles. Si lo pasas, cada pestaña enlaza su panel (`aria-controls`) y lo renderizas con `TabPanel` (mismo `idBase`). */
  idBase?: string;
  /** Nombre accesible del grupo de pestañas. */
  label?: string;
}

const tabId = (base: string, id: string) => `${base}-tab-${id}`;
const panelId = (base: string, id: string) => `${base}-panel-${id}`;

/** Pestañas WAI-ARIA: sólo la activa es tabulable; ← → Inicio Fin mueven el foco y activan. */
export function Tabs<T extends string>({ value, onChange, items, idBase, label }: TabsProps<T>) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activa = Math.max(0, items.findIndex(i => i.id === value));

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const destino = moverTab(e.key, index, items.length);
    if (destino === null) return;
    e.preventDefault();
    onChange(items[destino].id);
    refs.current[destino]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-lg bg-surface2 p-1">
      {items.map((i, n) => (
        <button
          key={i.id}
          ref={el => { refs.current[n] = el; }}
          type="button"
          role="tab"
          id={tabId(base, i.id)}
          aria-selected={value === i.id}
          aria-controls={idBase ? panelId(base, i.id) : undefined}
          tabIndex={n === activa ? 0 : -1}
          onClick={() => onChange(i.id)}
          onKeyDown={e => onKeyDown(e, n)}
          className={cx('rounded px-3 py-1.5 text-sm font-medium transition-colors duration-150', value === i.id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Panel de una pestaña: `idBase` debe ser el mismo que el de `Tabs`. Sólo se muestra el de la pestaña activa. */
export function TabPanel({ idBase, id, value, children, className }: { idBase: string; id: string; value: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={panelId(idBase, id)} aria-labelledby={tabId(idBase, id)} hidden={value !== id} tabIndex={0} className={className}>
      {value === id ? children : null}
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
