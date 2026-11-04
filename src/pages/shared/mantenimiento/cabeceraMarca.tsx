import { ImagenRecibo } from './ImagenRecibo';
import type { CabeceraDeDocumento } from './cabeceraDocumento';

/** Franja del color de marca con el logo y el nombre de la empresa, arriba del documento. Sin logo ni nombre no ocupa lugar. */
export function CabeceraMarca({ c }: { c: CabeceraDeDocumento }) {
  if (!c.nombre && !c.logoUrl) return null;
  return (
    <div className="break-inside-avoid">
      {c.color && <div aria-hidden="true" className="h-1.5 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]" style={{ backgroundColor: c.color }} />}
      <div className="flex items-center gap-2.5 py-2 print:py-1">
        {c.logoUrl && <ImagenRecibo src={c.logoUrl} alt={`Logo de ${c.nombre ?? 'la administración'}`} className="h-10 w-auto max-w-[9rem] shrink-0 object-contain object-left print:h-9" />}
        {c.nombre && <p className="min-w-0 break-words text-sm font-bold uppercase leading-tight">{c.nombre}</p>}
      </div>
    </div>
  );
}

/** Pie del documento: la plataforma, en pequeño. */
export const PieConTorre = () => <p className="text-[0.85em] text-neutral-500">con Torre</p>;
