import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

const control =
  'w-full rounded border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 transition-colors duration-150 hover:border-muted/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:bg-surface2 disabled:opacity-70 aria-[invalid=true]:border-bad aria-[invalid=true]:focus:ring-bad/25';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: (p: { id: string; 'aria-invalid': boolean | undefined; 'aria-describedby': string | undefined }) => ReactNode;
}

export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId();
  const msg = error ?? hint;
  const describedBy = msg ? `${id}-msg` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {msg && <p id={`${id}-msg`} className={cx('text-xs', error ? 'text-bad' : 'text-muted')}>{msg}</p>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, hint, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {p => <input ref={ref} className={cx(control, 'h-10')} {...p} {...rest} />}
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, hint, className, children, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {p => <select ref={ref} className={cx(control, 'h-10 pr-8')} {...p} {...rest}>{children}</select>}
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, hint, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {p => <textarea ref={ref} rows={3} className={cx(control, 'py-2')} {...p} {...rest} />}
    </Field>
  );
});

export function SearchBox({ value, onChange, placeholder = 'Buscar…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" /></svg>
      <input type="search" aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cx(control, 'h-9 pl-9')} />
    </div>
  );
}
