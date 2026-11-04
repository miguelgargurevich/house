import { useMemo, useState } from 'react';
import { useResource } from '../../../../api';
import { Alert, Button, SearchBox, Skeleton } from '../../../../ui';

export interface Departamento {
  id: number;
  codigo: string;
  estructura: { id: number; nombre: string | null } | null;
  titular: string | null;
}

interface Props {
  complejoId: string;
  /** '' = todo el condominio. */
  estructuraId: string;
  /** Ids marcados. */
  value: number[];
  onChange: (ids: number[]) => void;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * La lista para marcar los «departamentos elegidos» de un comunicado: código y titular, con buscador y «marcar todos / ninguno» (de los que se ven).
 * La API ya trae sólo los del condominio (o block) y del alcance de quien publica; la junta de un block ve sólo los de su block.
 */
export function ElegirDepartamentos({ complejoId, estructuraId, value, onChange }: Props) {
  const ruta = complejoId || estructuraId ? `/api/comunicados/departamentos?${new URLSearchParams({ ...(complejoId ? { complejo_id: complejoId } : {}), ...(estructuraId ? { estructura_id: estructuraId } : {}) }).toString()}` : null;
  const lista = useResource<{ items: Departamento[]; total: number; truncado: boolean }>(ruta);
  const [q, setQ] = useState('');
  const marcados = useMemo(() => new Set(value), [value]);
  const items = lista.data?.items ?? [];
  const visibles = useMemo(() => {
    const t = norm(q.trim());
    return t ? items.filter(x => norm(`${x.codigo} ${x.titular ?? ''}`).includes(t)) : items;
  }, [items, q]);
  const conBlock = !estructuraId; // con todo el condominio, cada fila dice su block

  const alternar = (id: number) => onChange(marcados.has(id) ? value.filter(x => x !== id) : [...value, id]);
  const marcarVisibles = () => onChange([...new Set([...value, ...visibles.map(x => x.id)])]);
  const quitarVisibles = () => { const fuera = new Set(visibles.map(x => x.id)); onChange(value.filter(x => !fuera.has(x))); };

  if (lista.error) return <Alert tone="bad">No se pudo cargar la lista de departamentos: {lista.error}</Alert>;
  if (lista.loading) return <Skeleton className="h-40 w-full" />;
  if (items.length === 0) return <p className="text-sm text-muted">No hay departamentos en este alcance.</p>;

  return (
    <div className="grid gap-2">
      <SearchBox value={q} onChange={setQ} placeholder="Buscar por código o titular" label="Buscar departamento" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={marcarVisibles} disabled={visibles.length === 0}>Marcar todos{q.trim() ? ' los que se ven' : ''}</Button>
        <Button type="button" variant="secondary" onClick={quitarVisibles} disabled={visibles.every(x => !marcados.has(x.id))}>Quitar marcas</Button>
        <span className="num text-sm text-muted" aria-live="polite">{value.length} {value.length === 1 ? 'marcado' : 'marcados'} de {items.length}</span>
      </div>
      {lista.data?.truncado && <Alert tone="warn">Se muestran los primeros {items.length} de {lista.data.total}. Filtra por block para ver el resto.</Alert>}
      {visibles.length === 0 ? (
        <p className="text-sm text-muted">Ningún departamento coincide con «{q}».</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto rounded border border-line" aria-label="Departamentos">
          {visibles.map(x => (
            <li key={x.id} className="border-b border-line last:border-b-0">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand" checked={marcados.has(x.id)} onChange={() => alternar(x.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">{x.codigo}{conBlock && x.estructura?.nombre ? <span className="font-normal text-muted"> · {x.estructura.nombre}</span> : null}</span>
                  <span className="block break-words text-xs text-muted">{x.titular ?? 'Sin titular cargado'}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
