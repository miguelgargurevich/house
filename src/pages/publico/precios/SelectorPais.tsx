import { useId } from 'react';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { monedaDe } from '../../../lib/paises';
import type { Catalogo } from '../catalogo';
import { elegirPais } from '../paisElegido';

/**
 * Para qué país se muestran los precios: cambia la moneda, los precios y el impuesto (IGV, IVA…). La elección se recuerda en este navegador.
 * Sólo ofrece los países que el superadmin dejó abiertos; lo que dice cada uno (moneda, impuesto) viene del servidor.
 */
export function SelectorPais({ cat, className = '' }: { cat: Catalogo; className?: string }) {
  const id = useId();
  const actual = cat.paises.find(p => p.codigo === cat.pais);
  const moneda = monedaDe(cat.moneda);
  const conImpuesto = Number(cat.impuesto.tasa) > 0;
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium">Precios para</label>
      <span className="relative mt-1.5 block max-w-xs">
        <select
          id={id} value={cat.pais} onChange={e => elegirPais(e.target.value)} aria-describedby={`${id}-msg`}
          className="h-12 w-full appearance-none rounded bg-surface px-3 pr-10 text-base font-medium text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        >
          {cat.paises.map(p => <option key={p.codigo} value={p.codigo}>{p.bandera} {p.nombre}</option>)}
        </select>
        <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
      </span>
      <p id={`${id}-msg`} aria-live="polite" className="mt-1.5 text-sm text-muted">
        {actual ? `${actual.nombre}: ` : ''}se cobra en {moneda?.plural ?? cat.moneda}{conImpuesto ? `, más ${cat.impuesto.nombre}` : ', sin impuesto adicional'}.
      </p>
    </div>
  );
}
