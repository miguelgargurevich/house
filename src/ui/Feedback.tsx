import type { ReactNode } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { cx } from './cx';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx('rounded bg-[linear-gradient(90deg,oklch(var(--surface-2))_25%,oklch(var(--line))_50%,oklch(var(--surface-2))_75%)] bg-[length:200%_100%] animate-[shimmer_1.4s_linear_infinite]', className)}
      aria-hidden="true"
    />
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-muted [&>svg]:h-8 [&>svg]:w-8">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <ExclamationTriangleIcon className="mb-3 h-8 w-8 text-bad" />
      <p className="text-sm font-medium">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  const t = { info: 'bg-info-soft text-info', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', ok: 'bg-ok-soft text-ok' }[tone];
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('rounded px-4 py-3 text-sm', t)}>{children}</div>;
}
