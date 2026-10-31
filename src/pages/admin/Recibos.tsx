import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MegaphoneIcon, PlusIcon, ReceiptPercentIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { useCondominio, useTorreElegida } from '../../app/condominio';
import { useList } from '../../api';
import { Button, Card, DataTable, PageHeader, SearchBox, StatusBadge, Toolbar, fechaCorta, periodo } from '../../ui';
import type { Column } from '../../ui';
import { EmitirReciboModal } from './_parts/cobranza/EmitirReciboModal';
import { SubirExcelModal } from './_parts/cobranza/SubirExcelModal';
import { ProgresoCobro } from './_parts/cobranza/ProgresoCobro';
import { SelectoresUbicacion } from './_parts/cobranza/SelectoresUbicacion';
import { etiquetaRecibo, type ReciboFila } from './_parts/cobranza/comun';
import { AvisarVecinosModal } from './_parts/recibos/AvisarVecinosModal';
import { Bloqueable } from '../../app/Bloqueable';

interface Props {
  /** Condominio fijo (ficha del condominio): sólo sus recibos y sin filtro de condominio. */
  complejoId?: number;
  /** Muestra el encabezado de página con los botones de emitir y subir Excel. */
  conEncabezado?: boolean;
}

/** Lista de recibos. Se usa sola (pantalla Recibos) y dentro de la ficha del condominio. */
export function ListaDeRecibos({ complejoId, conEncabezado = true }: Props) {
  const { complejo } = useCondominio();
  const [torre, setTorre] = useTorreElegida();
  const [emitiendo, setEmitiendo] = useState(false);
  const [subiendoExcel, setSubiendoExcel] = useState(false);
  const [avisando, setAvisando] = useState<ReciboFila | null>(null);
  const navigate = useNavigate();
  const abrir = (r: ReciboFila) => navigate(`/admin/recibos/${r.id}`);
  const list = useList<ReciboFila>('/api/recibos', { params: { complejo_id: String(complejoId ?? complejo) || undefined, estructura_id: torre || undefined } });
  const filtrando = Boolean(list.q || torre);

  const columns: Column<ReciboFila>[] = [
    { key: 'periodo', header: 'Periodo', cell: r => (
      <Link to={`/admin/recibos/${r.id}`} className="block text-left font-medium hover:text-brand">
        {periodo(r.mes, r.anio)}
        {r.descripcion && <span className="block max-w-[10rem] truncate text-xs font-normal text-muted">{r.descripcion}</span>}
      </Link>
    ) },
    { key: 'torre', header: 'Block', cell: r => (r.estructura ? <span className="font-medium">{r.estructura.nombre ?? `Block ${r.estructura.id}`}</span> : <span className="text-muted">Todo el condominio</span>) },
    { key: 'complejo', header: 'Condominio', hideBelow: 'md', cell: r => r.complejo?.nombre ?? '—' },
    { key: 'emision', header: 'Emisión', hideBelow: 'lg', cell: r => fechaCorta(r.fecha_emision) },
    { key: 'vencimiento', header: 'Vence', hideBelow: 'sm', cell: r => fechaCorta(r.fecha_vencimiento) },
    { key: 'avance', header: 'Cobrado', hideBelow: 'sm', cell: r => (r.totales ? <ProgresoCobro cobrado={r.totales.cobrado} total={r.totales.monto} moneda={r.moneda} /> : '—') },
    { key: 'estado', header: 'Estado', cell: r => <StatusBadge estado={r.estado} /> },
    // El botón no abre el periodo: se detiene el clic de la fila.
    { key: 'avisar', header: 'Avisos', cell: r => (
      <Bloqueable>{b => (
        <Button size="sm" variant="secondary" icon={<MegaphoneIcon className="h-4 w-4" />} disabled={b} onClick={e => { e.stopPropagation(); setAvisando(r); }}>
          Avisar<span className="sr-only"> a los vecinos de {periodo(r.mes, r.anio)}</span>
        </Button>
      )}</Bloqueable>
    ) },
  ];

  return (
    <>
      {conEncabezado && (
        <PageHeader
          title="Recibos"
          description="Cada block tiene su propio recibo cada mes. Emítelo (o sube el Excel del block) y ábrelo para ver el mantenimiento de cada departamento."
          actions={<><Bloqueable>{b => <Button icon={<PlusIcon className="h-4 w-4" />} disabled={b} onClick={() => setEmitiendo(true)}>Emitir recibo</Button>}</Bloqueable><Bloqueable>{b => <Button icon={<PaperClipIcon className="h-4 w-4" />} disabled={b} onClick={() => setSubiendoExcel(true)}>Subir Excel</Button>}</Bloqueable></>}
        />
      )}
      <Card>
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por descripción" />
          <SelectoresUbicacion torre={torre} onTorre={setTorre} complejoFijo={complejoId} />
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
            action: filtrando ? undefined : <Bloqueable>{b => <Button disabled={b} onClick={() => setEmitiendo(true)}>Emitir recibo</Button>}</Bloqueable>,
          }}
        />
      </Card>

      {emitiendo && <EmitirReciboModal onClose={() => setEmitiendo(false)} onSaved={() => void list.reload()} />}
      {subiendoExcel && <SubirExcelModal onClose={() => setSubiendoExcel(false)} onSaved={() => void list.reload()} />}
      {avisando && <AvisarVecinosModal reciboId={avisando.id} titulo={etiquetaRecibo(avisando)} onClose={() => setAvisando(null)} />}
    </>
  );
}

export default function Recibos() {
  return <ListaDeRecibos conEncabezado />;
}
