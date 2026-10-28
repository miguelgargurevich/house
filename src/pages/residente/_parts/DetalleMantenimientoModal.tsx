import { useState } from 'react';
import { PrinterIcon } from '@heroicons/react/24/outline';
import { ErrorState, Alert, Button, DefinitionList, Modal, Skeleton, StatusBadge, fechaCorta, soles } from '../../../ui';
import { useResource } from '../../../api';
import { ConceptosTabla, HistorialPagos } from '../../shared/mantenimiento/Desglose';
import { ConsumoAgua } from '../../shared/mantenimiento/ConsumoAgua';
import { ReciboImprimible } from '../../shared/mantenimiento/ReciboImprimible';
import { motivoRechazoMant, sePuedePagar } from '../../shared/mantenimiento/tipos';
import type { DetalleMantenimiento, Mantenimiento } from '../../shared/mantenimiento/tipos';

interface Props { mant: Mantenimiento | null; onClose: () => void; onPagar: (m: Mantenimiento) => void }

/** Detalle del mantenimiento: el desglose por concepto y el historial de pagos. Desde aquí se paga o se imprime el recibo. */
export function DetalleMantenimientoModal({ mant, onClose, onPagar }: Props) {
  const { data, loading, error, reload } = useResource<DetalleMantenimiento>(mant ? `/api/me/mantenimientos/${mant.recibo_id}/${mant.unidad_id}` : null);
  const [imprimiendo, setImprimiendo] = useState(false);
  const d = mant && data && data.recibo_id === mant.recibo_id && data.unidad_id === mant.unidad_id ? data : null;
  const rechazo = d ? motivoRechazoMant(d.pagos, d.estado) : null;

  return (
    <>
      <Modal
        open={mant !== null && !imprimiendo}
        onClose={() => { if (!imprimiendo) onClose(); /* al pasar al recibo, el diálogo se cierra solo: no es salir */ }}
        size="lg"
        title={mant ? mant.titulo.split(' · ')[0]! : 'Mantenimiento'}
        description={mant ? `Departamento ${mant.unidad.codigo}${mant.unidad.estructura?.nombre ? ` · ${mant.unidad.estructura.nombre}` : ''}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            <Button variant="secondary" icon={<PrinterIcon className="h-4 w-4" />} disabled={!d} onClick={() => setImprimiendo(true)}>Ver / imprimir recibo</Button>
            {d && sePuedePagar(d) && <Button onClick={() => { onClose(); onPagar(d); }}>Pagar mantenimiento</Button>}
          </>
        }
      >
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !d || loading ? (
          <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
        ) : (
          <div className="space-y-6">
            <div className="rounded bg-surface2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted">{Number(d.deuda_acumulada) > 0 ? 'Total (incluye deuda anterior)' : 'Total del mantenimiento'}</p>
                  <p className="num text-2xl font-semibold">{soles(d.total_general)}</p>
                </div>
                <StatusBadge estado={d.estado} />
              </div>
              <div className="mt-4">
                <DefinitionList
                  items={[
                    { label: 'N.º de recibo', value: <span className="num">{d.numero}</span> },
                    { label: 'Vencimiento', value: <span className={d.estado === 'vencido' ? 'text-bad' : ''}>{fechaCorta(d.fecha_vencimiento)}</span> },
                    ...(d.fecha_corte_agua ? [{ label: 'Corte de agua', value: fechaCorta(d.fecha_corte_agua) }] : []),
                    ...(Number(d.deuda_acumulada) > 0 ? [{ label: 'Mantenimiento de este mes', value: <span className="num">{soles(d.total)}</span> }, { label: 'Deuda acumulada', value: <span className="num text-bad">{soles(d.deuda_acumulada)}</span> }] : []),
                    ...(Number(d.cobrado) > 0 ? [{ label: 'Pagado', value: <span className="num text-ok">{soles(d.cobrado)}</span> }] : []),
                    ...(Number(d.en_revision) > 0 ? [{ label: 'En revisión', value: <span className="num">{soles(d.en_revision)}</span> }] : []),
                    { label: 'Saldo por pagar', value: <span className="num font-medium">{soles(d.saldo)}</span> },
                  ]}
                />
              </div>
            </div>
            {rechazo && <Alert tone="bad">Tu último pago fue rechazado: {rechazo}. Puedes volver a pagar el mantenimiento.</Alert>}
            <section aria-labelledby="conceptos-mant">
              <h3 id="conceptos-mant" className="mb-2 text-sm font-semibold">Detalle por concepto</h3>
              <ConceptosTabla conceptos={d.conceptos} total={d.total} />
            </section>
            {Number(d.deuda_acumulada) > 0 && <Alert tone="warn">Tienes <strong>{soles(d.deuda_acumulada)}</strong> de meses anteriores sin pagar. Se pagan desde cada mes; este total es sólo para que veas todo lo que debes.</Alert>}
            {d.agua && (
              <section aria-labelledby="agua-mant">
                <h3 id="agua-mant" className="mb-2 text-sm font-semibold">Consumo de agua</h3>
                <ConsumoAgua agua={d.agua} codigo={d.unidad.codigo} />
              </section>
            )}
            {(d.condominio?.admin_nombre || d.condominio?.admin_celular || d.condominio?.admin_correo) && (
              <section aria-labelledby="adm-mant">
                <h3 id="adm-mant" className="mb-2 text-sm font-semibold">Contacto de la administración</h3>
                <DefinitionList
                  items={[
                    ...(d.condominio.admin_nombre ? [{ label: 'Administración', value: d.condominio.admin_nombre }] : []),
                    ...(d.condominio.admin_celular ? [{ label: 'Celular', value: <span className="num">{d.condominio.admin_celular}</span> }] : []),
                    ...(d.condominio.admin_correo ? [{ label: 'Correo', value: <span className="break-all">{d.condominio.admin_correo}</span> }] : []),
                  ]}
                />
              </section>
            )}
            <section aria-labelledby="pagos-mant">
              <h3 id="pagos-mant" className="mb-2 text-sm font-semibold">Pagos de este mantenimiento</h3>
              <HistorialPagos pagos={d.pagos} />
            </section>
          </div>
        )}
      </Modal>
      {imprimiendo && d && <ReciboImprimible detalle={d} onClose={() => setImprimiendo(false)} />}
    </>
  );
}
