import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../ui';

/** Paginación simple para las listas de tarjetas (móvil). */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
      <Button variant="secondary" icon={<ChevronLeftIcon className="h-4 w-4" />} disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
      <span className="num">{page} / {pages}</span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Siguiente <ChevronRightIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
