import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ReceiptPercentIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../api';
import { Button, Card, DataTable, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge, Tabs, fechaCorta, soles } from '../../../ui';
import type { Column } from '../../../ui';
import { sePuedePagar } from '../../shared/mantenimiento/tipos';
import type { Mantenimiento } from '../../shared/mantenimiento/tipos';
import { DetalleMantenimientoModal } from './DetalleMantenimientoModal';
import { MantenimientoItem } from './MantenimientoItem';
import { PagarModal } from './PagarModal';
import { Pager } from './Pager';

type Pestana = 'por_pagar' | 'vencido' | 'en_revision' | 'pagado';

const TABS: { id: Pestana; label: string; estados: string }[] = [
  { id: 'por_pagar', label: 'Por pagar', estados: 'pendiente,parcial' },
  { id: 'vencido', label: 'Vencidos', estados: 'vencido' },
  { id: 'en_revision', label: 'En revisión', estados: 'en_revision' },
  { id: 'pagado', label: 'Pagados', estados: 'pagado' },
];

const VACIO: Record<Pestana, { title: string; description: string }> = {
  por_pagar: { title: 'No tienes mantenimientos por pagar', description: 'Cuando se emita el mantenimiento de un mes, aparecerá aquí para que lo pagues.' },
  vencido: { title: 'No tienes mantenimientos vencidos', description: 'Vas bien: todo lo emitido está dentro de plazo.' },
  en_revision: { title: 'No tienes pagos en revisión', description: 'Cuando registres un pago, aparecerá aquí hasta que se valide.' },
  pagado: { title: 'Aún no hay mantenimientos pagados', description: 'Los mantenimientos que pagues quedarán guardados aquí.' },
};

const nombreMes = (m: Mantenimiento) => m.titulo.split(' · ')[0]!;

export function CargosResidente() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('estado');
  // `?estado=vencido` (enlaces del Inicio) o el nombre de la pestaña; «pendiente» antiguo equivale a «por pagar».
  const tab: Pestana = TABS.some(t => t.id === q) ? (q as Pestana) : 'por_pagar';
  const estados = TABS.find(t => t.id === tab)!.estados;
  const list = useList<Mantenimiento>('/api/me/mantenimientos', { pageSize: 10, params: { estado: estados } });
  const [pagando, setPagando] = useState<Mantenimiento | null>(null);
  const [viendo, setViendo] = useState<Mantenimiento | null>(null);
  const vacio = VACIO[tab];

  const columns: Column<Mantenimiento>[] = [
    { key: 'mant', header: 'Mantenimiento', cell: m => (
      <button type="button" onClick={() => setViendo(m)} className="text-left font-medium hover:text-brand">{nombreMes(m)}</button>
    ) },
    { key: 'unidad', header: 'Departamento', cell: m => <span className="num">{m.unidad.codigo}</span> },
    { key: 'vence', header: 'Vence', cell: m => <span className={m.estado === 'vencido' ? 'text-bad' : ''}>{fechaCorta(m.fecha_vencimiento)}</span> },
    { key: 'total', header: 'Total', align: 'right', cell: m => (
      <span className="block">
        <span className="num font-medium">{soles(m.total)}</span>
        {m.estado === 'parcial' && <span className="block text-xs text-muted">Saldo {soles(m.saldo)}</span>}
      </span>
    ) },
    { key: 'estado', header: 'Estado', cell: m => <StatusBadge estado={m.estado} /> },
    { key: 'acciones', header: '', align: 'right', cell: m => (
      <span className="inline-flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setViendo(m)}>Ver detalle</Button>
        {sePuedePagar(m) && <Button size="sm" onClick={() => setPagando(m)}>Pagar mantenimiento</Button>}
      </span>
    ) },
  ];

  return (
    <>
      <PageHeader title="Mis recibos" description="El mantenimiento de cada mes de tu departamento, con todos sus conceptos." />
      <div className="mb-4 overflow-x-auto">
        <Tabs value={tab} onChange={t => setSp(t === 'por_pagar' ? {} : { estado: t }, { replace: true })} items={TABS} />
      </div>

      {/* Móvil: una tarjeta por mantenimiento */}
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
              {list.items.map(m => <li key={`${m.recibo_id}-${m.unidad_id}`}><Card><MantenimientoItem mant={m} onPagar={setPagando} onVer={setViendo} /></Card></li>)}
            </ul>
            <Pager page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
          </>
        )}
      </div>

      {/* Escritorio: tabla */}
      <Card className="hidden md:block">
        <DataTable
          caption="Mis mantenimientos"
          columns={columns}
          rows={list.items}
          rowKey={m => `${m.recibo_id}-${m.unidad_id}`}
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

      <DetalleMantenimientoModal mant={viendo} onClose={() => setViendo(null)} onPagar={setPagando} />
      <PagarModal mant={pagando} onClose={() => setPagando(null)} onPagado={() => void list.reload()} />
    </>
  );
}
