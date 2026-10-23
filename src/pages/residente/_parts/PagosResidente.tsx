import { useState } from 'react';
import { BanknotesIcon, DocumentTextIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../api';
import { Button, Card, DataTable, DefinitionList, EmptyState, ErrorState, IconButton, Modal, PageHeader, Skeleton, fechaCorta, soles } from '../../../ui';
import type { Column } from '../../../ui';
import { Pager } from './Pager';
import { metodoLabel } from './tipos';
import type { PagoResidente } from './tipos';

// Al imprimir sólo se ve el comprobante (el resto de la página se oculta).
const PRINT_CSS = '@media print{body *{visibility:hidden}#comprobante,#comprobante *{visibility:visible}#comprobante{position:fixed;left:0;top:0;width:100%;padding:24px}}';

const EMPTY = { title: 'Aún no has registrado pagos', description: 'Cuando pagues un recibo, el comprobante quedará guardado aquí.', icon: <BanknotesIcon /> };

export function PagosResidente() {
  const list = useList<PagoResidente>('/api/me/pagos', { pageSize: 10 });
  const [ver, setVer] = useState<PagoResidente | null>(null);

  const columns: Column<PagoResidente>[] = [
    { key: 'fecha', header: 'Fecha', cell: p => fechaCorta(p.fecha_pago) },
    { key: 'concepto', header: 'Concepto', cell: p => <span className="font-medium">{p.concepto?.nombre ?? '—'}</span> },
    { key: 'unidad', header: 'Unidad', hideBelow: 'lg', cell: p => p.unidad?.codigo ?? '—' },
    { key: 'metodo', header: 'Método', cell: p => metodoLabel(p.metodo_pago) },
    { key: 'referencia', header: 'Referencia', hideBelow: 'lg', cell: p => <span className="num">{p.referencia || '—'}</span> },
    { key: 'monto', header: 'Monto', align: 'right', cell: p => <span className="num font-medium">{soles(p.monto)}</span> },
    { key: 'acciones', header: '', align: 'right', cell: p => <IconButton label={`Ver comprobante del ${fechaCorta(p.fecha_pago)}`} onClick={() => setVer(p)}><DocumentTextIcon className="h-4 w-4" /></IconButton> },
  ];

  return (
    <>
      <PageHeader title="Mis pagos" description="Historial de los pagos que registraste." />

      <div className="md:hidden">
        {list.error ? (
          <Card><ErrorState message={list.error} onRetry={list.reload} /></Card>
        ) : list.loading ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : list.items.length === 0 ? (
          <Card><EmptyState {...EMPTY} /></Card>
        ) : (
          <>
            <Card>
              <ul className="divide-y divide-line">
                {list.items.map(p => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setVer(p)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface2/70">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.concepto?.nombre ?? 'Pago'}</span>
                        <span className="block text-sm text-muted">{fechaCorta(p.fecha_pago)} · {metodoLabel(p.metodo_pago)}</span>
                      </span>
                      <span className="num shrink-0 font-semibold">{soles(p.monto)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <Pager page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
          </>
        )}
      </div>

      <Card className="hidden md:block">
        <DataTable
          caption="Mis pagos"
          columns={columns}
          rows={list.items}
          rowKey={p => p.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          onRowClick={setVer}
          empty={EMPTY}
        />
      </Card>

      <Modal
        open={ver !== null}
        onClose={() => setVer(null)}
        title="Comprobante de pago"
        footer={
          <>
            <Button variant="secondary" onClick={() => setVer(null)}>Cerrar</Button>
            <Button icon={<PrinterIcon className="h-4 w-4" />} onClick={() => window.print()}>Imprimir</Button>
          </>
        }
      >
        {ver && (
          <div id="comprobante">
            <style>{PRINT_CSS}</style>
            <h2 className="mb-4 hidden text-lg font-semibold print:block">Comprobante de pago · House</h2>
            <p className="num mb-5 text-3xl font-semibold">{soles(ver.monto)}</p>
            <DefinitionList
              items={[
                { label: 'N.º de pago', value: <span className="num">{String(ver.id).padStart(6, '0')}</span> },
                { label: 'Fecha', value: fechaCorta(ver.fecha_pago) },
                { label: 'Concepto', value: ver.concepto?.nombre },
                { label: 'Unidad', value: ver.unidad?.codigo },
                { label: 'Método', value: metodoLabel(ver.metodo_pago) },
                { label: 'Referencia', value: ver.referencia && <span className="num">{ver.referencia}</span> },
                ...(ver.observaciones ? [{ label: 'Observaciones', value: ver.observaciones }] : []),
              ]}
            />
            <p className="mt-5 text-xs text-muted">Pago registrado por el residente; sujeto a validación del administrador.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
