import type { ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { cx } from './cx';
import { Skeleton, EmptyState, ErrorState } from './Feedback';
import { IconButton } from './Button';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  hideBelow?: 'sm' | 'md' | 'lg';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPage?: (p: number) => void;
  empty?: { title: string; description?: string; action?: ReactNode; icon?: ReactNode };
  caption: string;
  onRowClick?: (row: T) => void;
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, page = 1, pageSize = 20, total, onPage, empty, caption, onRowClick }: Props<T>) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  const count = total ?? rows.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-muted">
              {columns.map(c => (
                <th key={c.key} scope="col" className={cx('whitespace-nowrap px-5 py-3 font-medium', c.align === 'right' && 'text-right', c.hideBelow && hide[c.hideBelow])}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading
              ? Array.from({ length: Math.min(pageSize, 6) }).map((_, i) => (
                  <tr key={i}>
                    {columns.map(c => (
                      <td key={c.key} className={cx('px-5 py-3.5', c.hideBelow && hide[c.hideBelow])}><Skeleton className="h-4 w-full max-w-[10rem]" /></td>
                    ))}
                  </tr>
                ))
              : rows.map(r => (
                  <tr
                    key={rowKey(r)}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cx('transition-colors duration-150 hover:bg-surface2/70', onRowClick && 'cursor-pointer')}
                  >
                    {columns.map(c => (
                      <td key={c.key} className={cx('px-5 py-3.5 align-middle', c.align === 'right' && 'text-right', c.hideBelow && hide[c.hideBelow], c.className)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && (
        <EmptyState title={empty?.title ?? 'Sin resultados'} description={empty?.description} action={empty?.action} icon={empty?.icon} />
      )}
      {onPage && count > 0 && (
        <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3 text-sm text-muted">
          <span className="num">{from}–{to} de {count}</span>
          <div className="flex items-center gap-1">
            <IconButton label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeftIcon className="h-4 w-4" /></IconButton>
            <span className="num min-w-16 text-center">{page} / {pages}</span>
            <IconButton label="Página siguiente" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRightIcon className="h-4 w-4" /></IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
