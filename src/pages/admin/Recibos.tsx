import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PlusIcon, ReceiptPercentIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { useList } from '../../api';
import { Button, Card, DataTable, PageHeader, SearchBox, StatusBadge, Toolbar, fechaCorta, periodo } from '../../ui';
import type { Column } from '../../ui';
import { EmitirReciboModal } from './_parts/cobranza/EmitirReciboModal';
import { SubirExcelModal } from './_parts/cobranza/SubirExcelModal';
import { ProgresoCobro } from './_parts/cobranza/ProgresoCobro';
import { SelectoresUbicacion } from './_parts/cobranza/SelectoresUbicacion';
import type { ReciboFila } from './_parts/cobranza/comun';

interface Props {
  /** Condominio fijo (ficha del condominio): sólo sus recibos y sin filtro de condominio. */
  complejoId?: number;
  /** Muestra el encabezado de página con los botones de emitir y subir Excel. */
  conEncabezado?: boolean;
}

/** Lista de recibos. Se usa sola (pantalla Recibos) y dentro de la ficha del condominio. */
export function ListaDeRecibos({ complejoId, conEncabezado = true }: Props) {
  const [complejo, setComplejo] = useState('');
  const [torre, setTorre] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [subiendoExcel, setSubiendoExcel] = useState(false);
  const navigate = useNavigate();
  const abrir = (r: ReciboFila) => navigate(`/admin/recibos/${r.id}`);
  const list = useList<ReciboFila>('/api/recibos', { params: { complejo_id: String(complejoId ?? (complejo || '')) || undefined, estructura_id: torre || undefined } });
  const filtrando = Boolean(list.q || complejo || torre);

  const columns: Column<ReciboFila>[] = [
    { key: 'periodo', header: 'Periodo', cell: r => (
      <Link to={`/admin/recibos/${r.id}`} className="block text-left font-medium hover:text-brand">
        {periodo(r.mes, r.anio)}
        {r.descripcion && <span className="block max-w-[10rem] truncate text-xs font-normal text-muted sm:max-w-[16rem]">{r.descripcion}</span>}
      </Link>
    ) },
    { key: 'torre', header: 'Torre', cell: r => (r.estructura ? <span className="font-medium">{r.estructura.nombre ?? `Torre ${r.estructura.id}`}</span> : <span className="text-muted">Todo el condominio</span>) },
    { key: 'complejo', header: 'Condominio', hideBelow: 'md', cell: r => r.complejo?.nombre ?? '—' },
    { key: 'emision', header: 'Emisión', hideBelow: 'lg', cell: r => fechaCorta(r.fecha_emision) },
    { key: 'vencimiento', header: 'Vence', hideBelow: 'sm', cell: r => fechaCorta(r.fecha_vencimiento) },
    { key: 'avance', header: 'Cobrado', hideBelow: 'sm', cell: r => (r.totales ? <ProgresoCobro cobrado={r.totales.cobrado} total={r.totales.monto} moneda={r.moneda} /> : '—') },
    { key: 'estado', header: 'Estado', cell: r => <StatusBadge estado={r.estado} /> },
  ];

  return (
    <>
      {conEncabezado && (
        <PageHeader
          title="Recibos"
          description="Cada torre tiene su propio recibo cada mes. Emítelo (o sube el Excel de la torre) y ábrelo para ver el mantenimiento de cada departamento."
          actions={<><Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEmitiendo(true)}>Emitir recibo</Button><Button icon={<PaperClipIcon className="h-4 w-4" />} onClick={() => setSubiendoExcel(true)}>Subir Excel</Button></>}
        />
      )}
      <Card>
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por descripción" />
          <SelectoresUbicacion complejo={complejo} torre={torre} onComplejo={setComplejo} onTorre={setTorre} complejoFijo={complejoId} />
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
          onRowClick={abrir}
          empty={{
            title: 'Aún no hay recibos',
            description: filtrando ? 'Prueba con otro filtro.' : 'Emite el primero y cada departamento activo recibirá su mantenimiento con todos los conceptos.',
            icon: <ReceiptPercentIcon />,
            action: filtrando ? undefined : <Button onClick={() => setEmitiendo(true)}>Emitir recibo</Button>,
          }}
        />
      </Card>

      {emitiendo && <EmitirReciboModal onClose={() => setEmitiendo(false)} onSaved={() => void list.reload()} />}
      {subiendoExcel && <SubirExcelModal onClose={() => setSubiendoExcel(false)} onSaved={() => void list.reload()} />}
    </>
  );
}

export default function Recibos() {
  return <ListaDeRecibos conEncabezado />;
}
