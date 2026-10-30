import { useId } from 'react';
import { BuildingStorefrontIcon } from '@heroicons/react/24/outline';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { cx } from '../ui';
import { useCondominio } from './condominio';
import type { CondominioOpcion } from './condominio';

/** Condominios por empresa, en el orden en que llegan (el servidor ya los ordena por empresa y nombre). */
function porEmpresa(condominios: CondominioOpcion[]): { empresa: string; items: CondominioOpcion[] }[] {
  const grupos: { empresa: string; items: CondominioOpcion[] }[] = [];
  for (const c of condominios) {
    const nombre = c.empresa?.nombre ?? 'Sin empresa';
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.empresa === nombre) ultimo.items.push(c); else grupos.push({ empresa: nombre, items: [c] });
  }
  return grupos;
}

/**
 * Condominio con el que trabaja la administración, arriba y para todas las pantallas que lo usan: cada condominio y «Todos los condominios».
 * Con uno solo muestra su nombre fijo (no hay nada que elegir). El superadmin ve los condominios agrupados por empresa.
 * Se recuerda por usuario y sólo aparece donde la pantalla se filtra por condominio.
 */
export function SelectorCondominio({ className }: { className?: string }) {
  const { aplica, condominios, cargando, elegido, elegir } = useCondominio();
  const id = useId(); // el selector se pinta dos veces (barra en escritorio, fila propia en el celular): cada uno con su id
  if (!aplica) return null;
  if (cargando && condominios.length === 0) return <div className={cx('h-9 w-full animate-pulse rounded bg-surface2 lg:w-60', className)} aria-hidden="true" />;
  if (condominios.length === 0) return null;

  if (condominios.length === 1) {
    return (
      <p className={cx('flex h-9 min-w-0 items-center gap-2 rounded border border-line bg-surface px-3 text-sm font-medium text-ink lg:max-w-xs', className)}>
        <BuildingStorefrontIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        <span className="sr-only">Condominio: </span>
        <span className="truncate">{condominios[0]!.nombre}</span>
      </p>
    );
  }

  const grupos = porEmpresa(condominios);
  const agrupar = grupos.length > 1;
  const opcion = (c: CondominioOpcion) => <option key={c.id} value={c.id}>{c.nombre}</option>;
  return (
    <span className={cx('relative block w-full lg:w-64', className)}>
      <label htmlFor={id} className="sr-only">Condominio</label>
      <BuildingStorefrontIcon className="pointer-events-none absolute left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
      <select
        id={id}
        value={elegido === null ? '' : String(elegido)}
        onChange={e => elegir(e.target.value === '' ? null : Number(e.target.value))}
        className="h-9 w-full appearance-none truncate rounded border border-line bg-surface pl-9 pr-9 text-sm font-medium text-ink transition-colors duration-150 hover:border-muted/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
      >
        <option value="">Todos los condominios</option>
        {agrupar ? grupos.map(g => <optgroup key={g.empresa} label={g.empresa}>{g.items.map(opcion)}</optgroup>) : condominios.map(opcion)}
      </select>
      <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
    </span>
  );
}
