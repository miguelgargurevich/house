import { ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import type { Proveedor } from './tipos';

/** El orden real de prioridad (`orden`) y la regla de rotación, en una frase. */
export function ComoSeUsan({ orden, proveedores }: { orden: string[]; proveedores: Proveedor[] }) {
  const nombres = orden.flatMap(id => proveedores.find(p => p.id === id)?.nombre ?? []);
  return (
    <div className="flex gap-3 border-b border-line px-5 py-4">
      <ArrowsRightLeftIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Cómo se usan</h2>
        {nombres.length > 0 && (
          <ol className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-label="Orden de proveedores">
            {nombres.map((n, i) => (
              <li key={n} className="flex items-center gap-2">
                <span><span className="num font-medium text-ink">{i + 1}</span> {n}</span>
                {i < nombres.length - 1 && <span aria-hidden="true">→</span>}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-1 text-sm text-muted">El asistente usa la primera clave disponible. Si una se agota o falla, pasa sola a la siguiente clave o al siguiente proveedor.</p>
      </div>
    </div>
  );
}
