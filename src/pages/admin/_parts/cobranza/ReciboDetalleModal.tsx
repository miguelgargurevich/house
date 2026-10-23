import { ErrorState, DataTable, DefinitionList, Modal, Skeleton, StatusBadge, fechaCorta, periodo, soles } from '../../../../ui';
import type { Column } from '../../../../ui';
import { useResource } from '../../../../api';

export interface ReciboFila {
  id: number;
  mes: number;
  anio: number;
  descripcion: string | null;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: string | null;
  complejo?: { id: number; nombre: string } | null;
  totales?: { monto: number | string; cobrado: number | string; pendiente: number | string };
}

interface Cargo {
  id: number;
  unidad?: { id: number; codigo: string } | null;
  concepto?: { nombre: string } | null;
  monto: number | string;
  estado: string;
}

interface ReciboDetalle extends Partial<ReciboFila> {
  conceptos?: { id: number; monto: number | string; es_recargo?: boolean; concepto?: { nombre: string } | null }[];
  cargos?: Cargo[];
}

const columnas: Column<Cargo>[] = [
  { key: 'unidad', header: 'Unidad', cell: c => <span className="font-medium">{c.unidad?.codigo ?? '—'}</span> },
  { key: 'concepto', header: 'Concepto', hideBelow: 'sm', cell: c => c.concepto?.nombre ?? '—' },
  { key: 'monto', header: 'Monto', align: 'right', cell: c => <span className="num">{soles(c.monto)}</span> },
  { key: 'estado', header: 'Estado', cell: c => <StatusBadge estado={c.estado} /> },
];

export function ReciboDetalleModal({ recibo, onClose }: { recibo: ReciboFila; onClose: () => void }) {
  const { data, loading, error, reload } = useResource<ReciboDetalle>(`/api/recibos/${recibo.id}`);
  const cargos = data?.cargos ?? [];
  // Si el detalle no trae totales, se derivan de los cargos.
  const totales = data?.totales ?? recibo.totales ?? (data ? {
    monto: cargos.reduce((s, c) => s + Number(c.monto), 0),
    cobrado: cargos.filter(c => c.estado === 'pagado').reduce((s, c) => s + Number(c.monto), 0),
    pendiente: cargos.filter(c => c.estado !== 'pagado').reduce((s, c) => s + Number(c.monto), 0),
  } : undefined);

  return (
    <Modal open onClose={onClose} size="lg" title={`Recibo de ${periodo(recibo.mes, recibo.anio)}`} description={recibo.complejo?.nombre}>
      <div className="space-y-6">
        <DefinitionList
          items={[
            { label: 'Estado', value: <StatusBadge estado={data?.estado ?? recibo.estado} /> },
            { label: 'Descripción', value: recibo.descripcion },
            { label: 'Emisión', value: fechaCorta(recibo.fecha_emision) },
            { label: 'Vencimiento', value: fechaCorta(recibo.fecha_vencimiento) },
            { label: 'Total emitido', value: totales ? <span className="num">{soles(totales.monto)}</span> : <Skeleton className="h-4 w-24" /> },
            { label: 'Cobrado', value: totales ? <span className="num text-ok">{soles(totales.cobrado)}</span> : <Skeleton className="h-4 w-24" /> },
            { label: 'Pendiente', value: totales ? <span className="num">{soles(totales.pendiente)}</span> : <Skeleton className="h-4 w-24" /> },
          ]}
        />
        <section aria-labelledby="cargos-titulo" className="-mx-5 border-t border-line pt-4">
          <h3 id="cargos-titulo" className="px-5 pb-2 text-sm font-semibold">Cargos por unidad</h3>
          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : (
            <DataTable
              caption={`Cargos del recibo de ${periodo(recibo.mes, recibo.anio)}`}
              columns={columnas}
              rows={cargos}
              rowKey={c => c.id}
              loading={loading}
              empty={{ title: 'Este recibo no tiene cargos', description: 'Los cargos aparecen cuando el condominio tiene unidades activas.' }}
            />
          )}
        </section>
      </div>
    </Modal>
  );
}
