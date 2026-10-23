import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cx } from '../../../../ui';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; hint?: string };

/** Casilla con apariencia de interruptor: es un checkbox nativo, accesible con teclado y lector de pantalla. */
export const Interruptor = forwardRef<HTMLInputElement, Props>(function Interruptor({ label, hint, className, ...rest }, ref) {
  return (
    <label className={cx('flex min-h-10 cursor-pointer items-start gap-3', className)}>
      <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0">
        <input ref={ref} type="checkbox" role="switch" className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full border border-line bg-surface2 transition-colors duration-150 checked:border-brand checked:bg-brand disabled:opacity-50" {...rest} />
        <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-card transition-transform duration-150 peer-checked:translate-x-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
});
