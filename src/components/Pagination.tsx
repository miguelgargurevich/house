import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

export default function Pagination({
  page, totalPages, onPageChange
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="flex items-center justify-center gap-2 mt-4" aria-label="Paginación">
      <button
        className="p-2 rounded hover:bg-accent/20 disabled:opacity-50"
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        aria-label="Página anterior"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <span className="text-sm font-medium">
        Página {page} de {totalPages}
      </span>
      <button
        className="p-2 rounded hover:bg-accent/20 disabled:opacity-50"
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
        aria-label="Página siguiente"
      >
        <ChevronRightIcon className="h-5 w-5" />
      </button>
    </nav>
  );
}
