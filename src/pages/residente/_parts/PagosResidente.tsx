import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ArrowUpTrayIcon, BanknotesIcon, DocumentTextIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { errorText, useList } from '../../../api';
import { ComprobanteVista } from '../../shared/ComprobanteVista';
import { EstadoEvaluacion, ValidadoPorIABadge, useEvaluacionResidente } from '../../shared/evaluacion';
import { ACCEPT_COMPROBANTE, errorDeArchivo, subirComprobante, tamanoLegible } from '../../shared/comprobantes';
import { Alert, Button, Card, DataTable, DefinitionList, EmptyState, ErrorState, IconButton, Modal, Skeleton, StatusBadge, dinero, fechaCorta, useToast } from '../../../ui';
import type { Column } from '../../../ui';
import { ZonaImprimible } from '../../shared/mantenimiento/ZonaImprimible';
import { Pager } from './Pager';
import { estadoVisible, metodoLabel, montoPago, nombrePago } from './tipos';
import type { PagoResidente } from './tipos';

const EMPTY = { title: 'Aún no has registrado pagos', description: 'Cuando pagues un mantenimiento, el comprobante quedará guardado aquí.', icon: <BanknotesIcon /> };

export function PagosResidente() {
  const list = useList<PagoResidente>('/api/me/pagos', { pageSize: 10 });
  const [ver, setVer] = useState<PagoResidente | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const toast = useToast();
  const inputArchivo = useRef<HTMLInputElement>(null);
  // Si la captura aún se está evaluando, se sigue su estado mientras el detalle está abierto.
  const seguimiento = useEvaluacionResidente(ver?.estado_validacion === 'por_validar' && ver.evaluacion?.estado === 'evaluando' ? ver.id : null);
  const estadoIA = seguimiento.estado ?? (ver?.estado_validacion === 'por_validar' ? ver.evaluacion?.estado ?? null : null);

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

  // El mismo comprobante se muestra en el modal y se repite en la zona de impresión (ver ZonaImprimible).
  function comprobante(p: PagoResidente) {
    return (
      <>
        <p className="num mb-5 text-3xl font-semibold">{dinero(montoPago(p), p.moneda)}</p>
        <DefinitionList
          items={[
            { label: 'N.º de pago', value: <span className="num">{String(p.id).padStart(6, '0')}</span> },
            { label: 'Fecha', value: fechaCorta(p.fecha_pago) },
            { label: p.mantenimiento ? 'Mantenimiento' : 'Concepto', value: nombrePago(p) },
            ...(p.mantenimiento ? [{ label: 'Incluye', value: `${p.mantenimiento.conceptos} conceptos del mes` }] : []),
            { label: 'Unidad', value: p.unidad && `${p.unidad.codigo}${p.unidad.estructura?.nombre ? ` · ${p.unidad.estructura.nombre}` : ''}` },
            { label: 'Método', value: metodoLabel(p.metodo_pago) },
            { label: 'Referencia', value: p.referencia && <span className="num">{p.referencia}</span> },
            { label: 'Estado', value: <StatusBadge estado={estadoVisible(p.estado_validacion)} /> },
            ...(p.estado_validacion === 'validado' && p.validado_at ? [{ label: 'Validado el', value: fechaCorta(p.validado_at) }] : []),
            ...(p.comprobante ? [{ label: 'Comprobante adjunto', value: `${p.comprobante.nombre} · ${tamanoLegible(p.comprobante.tamano)}` }] : []),
            ...(p.observaciones ? [{ label: 'Observaciones', value: p.observaciones }] : []),
          ]}
        />
        <p className="mt-5 text-xs text-muted">
          {p.estado_validacion === 'validado'
            ? (p.validado_por_ia ? 'Pago validado automáticamente por la inteligencia artificial.' : 'Pago validado por la administración.')
            : p.estado_validacion === 'rechazado'
              ? `Pago rechazado: ${p.motivo_rechazo ?? 'sin motivo indicado'}.`
              : 'Pago registrado por el residente; está en revisión y queda sujeto a la validación del administrador.'}
        </p>
      </>
    );
  }

  const columns: Column<PagoResidente>[] = [
    { key: 'fecha', header: 'Fecha', cell: p => fechaCorta(p.fecha_pago) },
    { key: 'concepto', header: 'Mantenimiento', cell: p => <span className="block"><span className="font-medium">{nombrePago(p)}</span>{!p.mantenimiento && <span className="block text-xs text-muted">Pago de un solo concepto</span>}</span> },
    { key: 'unidad', header: 'Unidad', hideBelow: 'lg', cell: p => (p.unidad ? `${p.unidad.codigo}${p.unidad.estructura?.nombre ? ` · ${p.unidad.estructura.nombre}` : ''}` : '—') },
    { key: 'metodo', header: 'Método', cell: p => metodoLabel(p.metodo_pago) },
    { key: 'referencia', header: 'Referencia', hideBelow: 'lg', cell: p => <span className="num">{p.referencia || '—'}</span> },
    { key: 'monto', header: 'Monto', align: 'right', cell: p => <span className="num font-medium">{dinero(montoPago(p), p.moneda)}</span> },
    { key: 'estado', header: 'Estado', cell: p => <span className="flex flex-wrap items-center gap-1.5"><StatusBadge estado={estadoVisible(p.estado_validacion)} /><ValidadoPorIABadge validado={p.validado_por_ia} /></span> },
    { key: 'acciones', header: '', align: 'right', cell: p => <IconButton label={`Ver comprobante del ${fechaCorta(p.fecha_pago)}`} onClick={() => setVer(p)}><DocumentTextIcon className="h-4 w-4" /></IconButton> },
  ];

  return (
    <>
      <p className="mb-4 text-sm text-muted">Un pago por cada mantenimiento que pagaste.</p>

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
                        <span className="block truncate font-medium">{nombrePago(p)}</span>
                        <span className="block text-sm text-muted">{fechaCorta(p.fecha_pago)} · {metodoLabel(p.metodo_pago)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="num font-semibold">{dinero(montoPago(p), p.moneda)}</span>
                        <StatusBadge estado={estadoVisible(p.estado_validacion)} />
                        <ValidadoPorIABadge validado={p.validado_por_ia} />
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
        {ver && <div>{comprobante(ver)}</div>}
        {ver && <ZonaImprimible><h2 className="mb-4 text-lg font-semibold">Comprobante de pago · Torre</h2>{comprobante(ver)}</ZonaImprimible>}
        {estadoIA && <div className="mt-4 print:hidden"><EstadoEvaluacion estado={estadoIA} /></div>}
        {ver?.estado_validacion === 'rechazado' && <div className="mt-4 print:hidden"><Alert tone="bad">Tu pago fue rechazado: {ver.motivo_rechazo ?? 'sin motivo indicado'}. Vuelve a pagar el mantenimiento desde Mis recibos.</Alert></div>}
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
