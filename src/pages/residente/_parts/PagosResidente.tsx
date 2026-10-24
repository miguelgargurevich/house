import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ArrowUpTrayIcon, BanknotesIcon, DocumentTextIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { errorText, useList } from '../../../api';
import { ComprobanteVista } from '../../shared/ComprobanteVista';
import { ACCEPT_COMPROBANTE, errorDeArchivo, subirComprobante, tamanoLegible } from '../../shared/comprobantes';
import { Alert, Button, Card, DataTable, DefinitionList, EmptyState, ErrorState, IconButton, Modal, PageHeader, Skeleton, StatusBadge, fechaCorta, soles, useToast } from '../../../ui';
import type { Column } from '../../../ui';
import { Pager } from './Pager';
import { estadoVisible, metodoLabel } from './tipos';
import type { PagoResidente } from './tipos';

// Al imprimir sólo se ve el comprobante (el resto de la página se oculta).
const PRINT_CSS = '@media print{body *{visibility:hidden}#comprobante,#comprobante *{visibility:visible}#comprobante{position:fixed;left:0;top:0;width:100%;padding:24px}}';

const EMPTY = { title: 'Aún no has registrado pagos', description: 'Cuando pagues un recibo, el comprobante quedará guardado aquí.', icon: <BanknotesIcon /> };

export function PagosResidente() {
  const list = useList<PagoResidente>('/api/me/pagos', { pageSize: 10 });
  const [ver, setVer] = useState<PagoResidente | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const toast = useToast();
  const inputArchivo = useRef<HTMLInputElement>(null);

  async function adjuntar(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !ver) return;
    const err = errorDeArchivo(f);
    if (err) return void toast.error(err);
    setSubiendo(true);
    try {
      const meta = await subirComprobante(ver.id, f);
      setVer({ ...ver, comprobante: meta });
      toast.ok('Comprobante adjuntado.');
      void list.reload();
    } catch (er) { toast.error(errorText(er)); }
    finally { setSubiendo(false); }
  }

  const columns: Column<PagoResidente>[] = [
    { key: 'fecha', header: 'Fecha', cell: p => fechaCorta(p.fecha_pago) },
    { key: 'concepto', header: 'Concepto', cell: p => <span className="font-medium">{p.concepto?.nombre ?? '—'}</span> },
    { key: 'unidad', header: 'Unidad', hideBelow: 'lg', cell: p => p.unidad?.codigo ?? '—' },
    { key: 'metodo', header: 'Método', cell: p => metodoLabel(p.metodo_pago) },
    { key: 'referencia', header: 'Referencia', hideBelow: 'lg', cell: p => <span className="num">{p.referencia || '—'}</span> },
    { key: 'monto', header: 'Monto', align: 'right', cell: p => <span className="num font-medium">{soles(p.monto)}</span> },
    { key: 'estado', header: 'Estado', cell: p => <StatusBadge estado={estadoVisible(p.estado_validacion)} /> },
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
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="num font-semibold">{soles(p.monto)}</span>
                        <StatusBadge estado={estadoVisible(p.estado_validacion)} />
                      </span>
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
            {ver?.estado_validacion === 'por_validar' && (
              <Button variant="secondary" icon={<ArrowUpTrayIcon className="h-4 w-4" />} loading={subiendo} onClick={() => inputArchivo.current?.click()}>
                {ver.comprobante ? 'Reemplazar comprobante' : 'Adjuntar comprobante'}
              </Button>
            )}
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
                { label: 'Estado', value: <StatusBadge estado={estadoVisible(ver.estado_validacion)} /> },
                ...(ver.estado_validacion === 'validado' && ver.validado_at ? [{ label: 'Validado el', value: fechaCorta(ver.validado_at) }] : []),
                ...(ver.comprobante ? [{ label: 'Comprobante adjunto', value: `${ver.comprobante.nombre} · ${tamanoLegible(ver.comprobante.tamano)}` }] : []),
                ...(ver.observaciones ? [{ label: 'Observaciones', value: ver.observaciones }] : []),
              ]}
            />
            <p className="mt-5 text-xs text-muted">
              {ver.estado_validacion === 'validado'
                ? 'Pago validado por la administración.'
                : ver.estado_validacion === 'rechazado'
                  ? `Pago rechazado: ${ver.motivo_rechazo ?? 'sin motivo indicado'}.`
                  : 'Pago registrado por el residente; está en revisión y queda sujeto a la validación del administrador.'}
            </p>
          </div>
        )}
        {ver?.estado_validacion === 'rechazado' && <div className="mt-4 print:hidden"><Alert tone="bad">Tu pago fue rechazado: {ver.motivo_rechazo ?? 'sin motivo indicado'}. Vuelve a pagar el recibo desde Mis recibos.</Alert></div>}
        {ver?.comprobante && (
          <div className="mt-5 print:hidden">
            <ComprobanteVista key={ver.comprobante.created_at} pagoId={ver.id} descripcion={`Comprobante adjunto al pago del ${fechaCorta(ver.fecha_pago)}`} nombre={ver.comprobante.nombre} />
          </div>
        )}
        <input ref={inputArchivo} type="file" accept={ACCEPT_COMPROBANTE} onChange={e => void adjuntar(e)} className="sr-only" tabIndex={-1} aria-label="Elegir archivo del comprobante" />
      </Modal>
    </>
  );
}
