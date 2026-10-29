import { MapPinIcon } from '@heroicons/react/24/solid';
import { Badge, fechaCorta } from '../../../../ui';
import { alcanceDe, origenLabel } from './tipos';
import type { ComunicadoResidente } from './tipos';

/**
 * Un comunicado: título, de quién, a quién y cuándo, y el texto. `compacto` (la tarjeta del Inicio) recorta el texto a unas líneas.
 * El cuerpo es TEXTO PLANO: se pinta como texto con sus saltos de línea (`whitespace-pre-line`), nunca como HTML.
 */
export function ComunicadoItem({ c, compacto = false }: { c: ComunicadoResidente; compacto?: boolean }) {
  return (
    <article className="px-4 py-4 sm:px-5" aria-label={c.titulo}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {c.fijado && <Badge tone="brand"><MapPinIcon className="mr-1 inline h-3 w-3" aria-hidden="true" />Fijado</Badge>}
        <Badge>{origenLabel(c.origen)}</Badge>
        <span className="text-xs text-muted">{alcanceDe(c)} · {fechaCorta(c.created_at)}</span>
      </div>
      <h3 className="mt-1.5 break-words text-base font-semibold">{c.titulo}</h3>
      <p className={`mt-1 whitespace-pre-line break-words text-sm text-ink/90 ${compacto ? 'line-clamp-3' : ''}`}>{c.cuerpo}</p>
    </article>
  );
}
