import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ReceiptPercentIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../api';
import { Button, Card, DataTable, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge, Tabs, fechaCorta, periodo, soles } from '../../../ui';
import type { Column } from '../../../ui';
import { CargoItem } from './CargoItem';
import { PagarModal } from './PagarModal';
import { Pager } from './Pager';
import { motivoRechazo } from './tipos';
import type { Cargo, EstadoCargo } from './tipos';

const TABS: { id: EstadoCargo; label: string }[] = [
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'vencido', label: 'Vencidos' },
  { id: 'en_revision', label: 'En revisión' },
  { id: 'pagado', label: 'Pagados' },
];

const VACIO: Record<EstadoCargo, { title: string; description: string }> = {
  pendiente: { title: 'No tienes recibos pendientes', description: 'Cuando se emita un recibo nuevo, aparecerá aquí para que lo pagues.' },
  vencido: { title: 'No tienes recibos vencidos', description: 'Vas bien: todo lo emitido está dentro de plazo.' },
  en_revision: { title: 'No tienes pagos en revisión', description: 'Cuando registres un pago, aparecerá aquí hasta que el administrador lo valide.' },
  pagado: { title: 'Aún no hay recibos pagados', description: 'Los recibos que pagues quedarán guardados aquí.' },
};

export function CargosResidente() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('estado');
  const tab: EstadoCargo = TABS.some(t => t.id === q) ? (q as EstadoCargo) : 'pendiente';
  const list = useList<Cargo>('/api/me/cargos', { pageSize: 10, params: { estado: tab } });
  const [pagando, setPagando] = useState<Cargo | null>(null);
  const vacio = VACIO[tab];

  const columns: Column<Cargo>[] = [
    { key: 'concepto', header: 'Concepto', cell: c => (
      <>
        <span className="font-medium">{c.concepto.nombre}</span>
        {motivoRechazo(c) && <span className="block text-xs text-bad">Pago rechazado: {motivoRechazo(c)}</span>}
      </>
    ) },
    { key: 'periodo', header: 'Periodo', cell: c => periodo(c.recibo.mes, c.recibo.anio) },
    { key: 'unidad', header: 'Unidad', cell: c => c.unidad.codigo },
    { key: 'vence', header: 'Vence', cell: c => <span className={c.estado === 'vencido' ? 'text-bad' : ''}>{fechaCorta(c.recibo.fecha_vencimiento)}</span> },
    { key: 'monto', header: 'Monto', align: 'right', cell: c => <span className="num font-medium">{soles(c.monto)}</span> },
    { key: 'estado', header: 'Estado', cell: c => <StatusBadge estado={c.estado} /> },
    { key: 'acciones', header: '', align: 'right', cell: c => (c.estado !== 'pagado' && c.estado !== 'en_revision' ? <Button size="sm" onClick={() => setPagando(c)}>{motivoRechazo(c) ? 'Pagar de nuevo' : 'Pagar'}</Button> : null) },
  ];

  return (
    <>
      <PageHeader title="Mis recibos" description="Lo que debes y lo que ya pagaste, por unidad." />
      <div className="mb-4 overflow-x-auto">
        <Tabs value={tab} onChange={t => setSp(t === 'pendiente' ? {} : { estado: t }, { replace: true })} items={TABS} />
      </div>

      {/* Móvil: una tarjeta por recibo */}
      <div className="md:hidden">
        {list.error ? (
          <Card><ErrorState message={list.error} onRetry={list.reload} /></Card>
        ) : list.loading ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>
        ) : list.items.length === 0 ? (
          <Card><EmptyState icon={<ReceiptPercentIcon />} title={vacio.title} description={vacio.description} /></Card>
        ) : (
          <>
            <ul className="space-y-3">
              {list.items.map(c => <li key={c.id}><Card><CargoItem cargo={c} onPagar={setPagando} /></Card></li>)}
            </ul>
            <Pager page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
          </>
        )}
      </div>

      {/* Escritorio: tabla */}
      <Card className="hidden md:block">
        <DataTable
          caption="Mis recibos"
          columns={columns}
          rows={list.items}
          rowKey={c => c.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{ ...vacio, icon: <ReceiptPercentIcon /> }}
        />
      </Card>

      <PagarModal cargo={pagando} onClose={() => setPagando(null)} onPagado={() => void list.reload()} />
    </>
  );
}
