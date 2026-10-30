import { useState } from 'react';
import { DocumentTextIcon, MagnifyingGlassPlusIcon } from '@heroicons/react/24/outline';
import { Alert, Skeleton } from '../../ui';
import { useComprobante } from './comprobantes';
import { VisorImagen } from './VisorImagen';

/** Muestra el comprobante de un pago: la imagen en línea (con «Ampliar» para leerla a pantalla completa), o un enlace «Abrir» si es PDF. */
export function ComprobanteVista({ pagoId, descripcion, nombre }: { pagoId: number; descripcion: string; nombre?: string }) {
  const c = useComprobante(pagoId);
  const [ampliada, setAmpliada] = useState(false);
  if (c.loading) return <Skeleton className="h-48 w-full" />;
  if (c.error) return <Alert tone="warn">{c.error}</Alert>;
  if (!c.data) return null;
  if (c.data.tipo.startsWith('image/')) {
    return (
      <>
        <button type="button" onClick={() => setAmpliada(true)} aria-label={`Ampliar: ${descripcion}`} className="group relative block w-full cursor-zoom-in rounded">
          <img src={c.data.url} alt={descripcion} className="max-h-80 w-full rounded border border-line bg-surface2 object-contain" />
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded border border-line bg-surface/95 px-2 py-1 text-xs font-medium text-ink shadow-sm group-hover:bg-surface">
            <MagnifyingGlassPlusIcon className="h-4 w-4" aria-hidden="true" />
            Ampliar
          </span>
        </button>
        <VisorImagen src={c.data.url} alt={descripcion} open={ampliada} onClose={() => setAmpliada(false)} />
      </>
    );
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
