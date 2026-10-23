import { useState } from 'react';
import { PlusIcon, ReceiptPercentIcon } from '@heroicons/react/24/outline';
import { useList, useResource } from '../../api';
import { Button, Card, DataTable, PageHeader, SearchBox, Select, StatusBadge, Toolbar, fechaCorta, periodo } from '../../ui';
import type { Column } from '../../ui';
import { EmitirReciboModal } from './_parts/cobranza/EmitirReciboModal';
import { ReciboDetalleModal } from './_parts/cobranza/ReciboDetalleModal';
import type { ReciboFila } from './_parts/cobranza/ReciboDetalleModal';
import { ProgresoCobro } from './_parts/cobranza/ProgresoCobro';
import type { Complejo, Lista } from './_parts/cobranza/comun';

export default function Recibos() {
  const [complejo, setComplejo] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [detalle, setDetalle] = useState<ReciboFila | null>(null);
  const list = useList<ReciboFila>('/api/recibos', { params: { complejo_id: complejo || undefined } });
  const complejos = useResource<Lista<Complejo>>('/api/complejos?pageSize=100');

  const columns: Column<ReciboFila>[] = [
    { key: 'periodo', header: 'Periodo', cell: r => (
      <button type="button" onClick={() => setDetalle(r)} className="text-left font-medium hover:text-brand">
        {periodo(r.mes, r.anio)}
        {r.descripcion && <span className="block max-w-[16rem] truncate text-xs font-normal text-muted">{r.descripcion}</span>}
      </button>
    ) },
    { key: 'complejo', header: 'Condominio', hideBelow: 'md', cell: r => r.complejo?.nombre ?? '—' },
    { key: 'emision', header: 'Emisión', hideBelow: 'lg', cell: r => fechaCorta(r.fecha_emision) },
    { key: 'vencimiento', header: 'Vence', hideBelow: 'sm', cell: r => fechaCorta(r.fecha_vencimiento) },
    { key: 'avance', header: 'Cobrado', hideBelow: 'sm', cell: r => (r.totales ? <ProgresoCobro cobrado={r.totales.cobrado} total={r.totales.monto} /> : '—') },
    { key: 'estado', header: 'Estado', cell: r => <StatusBadge estado={r.estado} /> },
  ];

  return (
    <>
      <PageHeader
        title="Recibos"
        description="Emite los recibos del periodo y sigue cuánto se ha cobrado de cada uno."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEmitiendo(true)}>Emitir recibo</Button>}
      />
      <Card>
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por descripción" />
          <Select label="Condominio" className="w-full sm:w-56 [&_label]:sr-only" value={complejo} onChange={e => setComplejo(e.target.value)}>
            <option value="">Todos los condominios</option>
            {(complejos.data?.items ?? []).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        </Toolbar>
        <DataTable
          caption="Recibos emitidos"
          columns={columns}
          rows={list.items}
          rowKey={r => r.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          onRowClick={setDetalle}
          empty={{
            title: 'Aún no hay recibos',
            description: list.q || complejo ? 'Prueba con otro filtro.' : 'Emite el primero y se generará un cargo por cada unidad activa.',
            icon: <ReceiptPercentIcon />,
            action: list.q || complejo ? undefined : <Button onClick={() => setEmitiendo(true)}>Emitir recibo</Button>,
          }}
        />
      </Card>

      {emitiendo && <EmitirReciboModal onClose={() => setEmitiendo(false)} onSaved={() => void list.reload()} />}
      {detalle && <ReciboDetalleModal recibo={detalle} onClose={() => setDetalle(null)} />}
    </>
  );
}
