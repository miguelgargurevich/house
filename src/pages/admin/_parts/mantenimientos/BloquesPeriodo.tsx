import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Badge, Card, ErrorState, Skeleton, dinero } from '../../../../ui';
import { ProgresoCobro } from '../cobranza/ProgresoCobro';
import { MantenimientosLista } from './MantenimientosLista';
import type { Mantenimiento } from '../../../shared/mantenimiento/tipos';

export interface BlockResumen {
  estructura_id: number | null;
  nombre: string;
  unidades: number;
  emitido: string;
  cobrado: string;
  en_revision: string;
  saldo: string;
  porcentaje: number;
  morosos: number;
}

interface Props {
  reciboId: number;
  /** Moneda del recibo: lo emitido y cobrado de cada torre va en ella. */
  moneda?: string;
  blocks: BlockResumen[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  recargar: number;
  onVer: (m: Mantenimiento) => void;
}

/** El periodo agrupado por torre: una fila por torre con su avance; al abrirla se lista (paginada) la de sus departamentos. */
export function BloquesPeriodo({ reciboId, moneda, blocks, loading, error, onRetry, recargar, onVer }: Props) {
  const [abierto, setAbierto] = useState<number | 'sin' | null>(null);
  if (error) return <Card><ErrorState message={error} onRetry={onRetry} /></Card>;
  if (loading || !blocks) return <Card><div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div></Card>;

  return (
    <Card>
      <ul className="divide-y divide-line" aria-label="Torres del periodo">
        {blocks.map(b => {
          const clave = b.estructura_id ?? 'sin';
          const abierta = abierto === clave;
          const panel = `block-${reciboId}-${clave}`;
          return (
            <li key={clave}>
              <button
                type="button"
                aria-expanded={abierta}
                aria-controls={panel}
                onClick={() => setAbierto(abierta ? null : clave)}
                className="grid w-full grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-surface2/60 md:grid-cols-[1.25rem_minmax(8rem,1fr)_5rem_8rem_12rem_6rem]"
              >
                {abierta ? <ChevronDownIcon className="h-4 w-4 text-muted" aria-hidden="true" /> : <ChevronRightIcon className="h-4 w-4 text-muted" aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="block font-medium">{b.nombre}</span>
                  <span className="block text-xs text-muted md:hidden">{b.unidades} departamentos · {b.porcentaje} % cobrado</span>
                </span>
                <span className="num hidden text-right text-sm md:block"><span className="block text-xs text-muted">Departamentos</span>{b.unidades}</span>
                <span className="num hidden text-right text-sm md:block"><span className="block text-xs text-muted">Emitido</span>{dinero(b.emitido, moneda)}</span>
                <span className="hidden md:block"><ProgresoCobro cobrado={b.cobrado} total={b.emitido} moneda={moneda} /></span>
                <span className="justify-self-end">
                  {b.morosos > 0 ? <Badge tone="bad">{b.morosos} {b.morosos === 1 ? 'moroso' : 'morosos'}</Badge> : <Badge tone="ok">Al día</Badge>}
                </span>
              </button>
              {abierta && (
                <div id={panel} className="border-t border-line bg-surface2/30">
                  <MantenimientosLista reciboId={reciboId} estructuraId={b.estructura_id ?? undefined} sinBlock={b.estructura_id === null} recargar={recargar} onVer={onVer} pageSize={10} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
