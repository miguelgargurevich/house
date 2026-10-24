import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { Alert, Skeleton } from '../../ui';
import { useComprobante } from './comprobantes';

/** Muestra el comprobante de un pago: la imagen en línea, o un enlace «Abrir» si es PDF. */
export function ComprobanteVista({ pagoId, descripcion, nombre }: { pagoId: number; descripcion: string; nombre?: string }) {
  const c = useComprobante(pagoId);
  if (c.loading) return <Skeleton className="h-48 w-full" />;
  if (c.error) return <Alert tone="warn">{c.error}</Alert>;
  if (!c.data) return null;
  if (c.data.tipo.startsWith('image/')) {
    return <img src={c.data.url} alt={descripcion} className="max-h-80 w-full rounded border border-line bg-surface2 object-contain" />;
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-line bg-surface2 p-4">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <DocumentTextIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <span className="truncate">{nombre ?? 'Comprobante en PDF'}</span>
      </span>
      <a
        href={c.data.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-8 shrink-0 items-center rounded border border-line bg-surface px-3 text-sm font-medium transition-colors duration-150 hover:bg-surface2"
      >
        Abrir
      </a>
    </div>
  );
}
