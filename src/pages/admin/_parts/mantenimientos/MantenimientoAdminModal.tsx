import { useState } from 'react';
import { PrinterIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import { api, errorText, useResource } from '../../../../api';
import { useAuth } from '../../../../auth/AuthContext';
import { simboloDe } from '../../../../lib/paises';
import { Alert, Button, DefinitionList, ErrorState, Input, Modal, Select, Skeleton, StatusBadge, dinero, fechaCorta, useToast } from '../../../../ui';
import { ConceptosTabla, HistorialPagos } from '../../../shared/mantenimiento/Desglose';
import { ReciboImprimible } from '../../../shared/mantenimiento/ReciboImprimible';
import type { DetalleMantenimiento, PagoMantenimiento } from '../../../shared/mantenimiento/tipos';
import { METODOS } from '../cobranza/comun';
import { multaQuitable } from '../cobranza/morosos';
import { puedeValidar } from '../cobranza/conformidad';
import { QuitarMultaModal } from '../cobranza/QuitarMultaModal';
import { ValidarPagoModal } from '../cobranza/ValidarPagoModal';
import type { PagoRevisable } from '../cobranza/ValidarPagoModal';
import { FormPagoMantenimiento } from './FormPagoMantenimiento';
import { Bloqueable } from '../../../../app/Bloqueable';

interface Props { reciboId: number; unidadId: number; onClose: () => void; onCambio: () => void }

/** Oculto por ahora: ningún condominio cobra un concepto por partes (Miguel, 28-oct-2026). El endpoint sigue disponible. */
const PAGO_PARCIAL_CONCEPTO = false;

/** Pago parcial de UN concepto: opción avanzada, para el caso raro en que el vecino sólo paga una parte. */
function PagoParcialConcepto({ cargoId, saldo, moneda, onRegistrado }: { cargoId: number; saldo: string; moneda: string; onRegistrado: () => void }) {
  const toast = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ monto: string; metodo_pago: string }>({ defaultValues: { monto: '', metodo_pago: 'transferencia' } });
  async function enviar(v: { monto: string; metodo_pago: string }) {
    try {
      await api('/api/pagos', { method: 'POST', json: { recibo_concepto_unidad_id: cargoId, monto: Number(v.monto), metodo_pago: v.metodo_pago } });
      toast.ok('Pago parcial registrado.');
      onRegistrado();
    } catch (e) { toast.error(errorText(e)); }
  }
  return (
    <form onSubmit={handleSubmit(enviar)} className="flex flex-wrap items-end gap-3" noValidate>
      <Input label={`Monto (${simboloDe(moneda)})`} type="number" inputMode="decimal" step="0.01" min="0" className="w-32" error={errors.monto && `Hasta ${dinero(saldo, moneda)}`} {...register('monto', { required: true, validate: v => Number(v) > 0 && Number(v) <= Number(saldo) + 0.001 })} />
      <Select label="Método" className="w-40" {...register('metodo_pago', { required: true })}>{METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</Select>
      <Button type="submit" size="sm" variant="secondary" loading={isSubmitting}>Registrar parcial</Button>
    </form>
  );
}

/** Recibo de departamento visto por la administración: desglose por concepto, pagos, registrar el pago y recibo imprimible. */
export function MantenimientoAdminModal({ reciboId, unidadId, onClose, onCambio }: Props) {
  const { data, loading, error, reload } = useResource<DetalleMantenimiento>(`/api/recibos/${reciboId}/mantenimientos/${unidadId}`);
  const [registrando, setRegistrando] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [pago, setPago] = useState<PagoRevisable | null>(null);
  const [quitandoMulta, setQuitandoMulta] = useState(false);
  const { user } = useAuth();
  const d = data && data.recibo_id === reciboId && data.unidad_id === unidadId ? data : null;

  function tras() { setRegistrando(false); void reload(); onCambio(); }

  function abrirPago(p: PagoMantenimiento & Pick<PagoRevisable, 'conformidad' | 'tesorero_registrado' | 'conformidad_exencion'>) {
    if (!d) return;
    setPago({
      id: p.id, fecha_pago: p.fecha_pago, monto: p.monto, moneda: d.moneda, metodo_pago: p.metodo_pago, referencia: p.referencia, estado_validacion: p.estado_validacion,
      motivo_rechazo: p.motivo_rechazo, validado_at: null, comprobante: p.comprobante, unidad: { codigo: d.unidad.codigo }, concepto: { nombre: p.conceptos.join(', ') },
      usuario: p.registrado_por, evaluacion: p.evaluacion as PagoRevisable['evaluacion'], validado_por_ia: p.validado_por_ia,
      conformidad: p.conformidad, tesorero_registrado: p.tesorero_registrado, conformidad_exencion: p.conformidad_exencion, aviso_multa: p.aviso_multa, // sólo los trae la vista de la administración
      mantenimiento: p.suelto ? null : { titulo: d.titulo, total: p.monto, conceptos: p.conceptos.length },
    });
  }

  const puedeRegistrar = d !== null && Number(d.saldo) > 0 && d.estado !== 'en_revision';
  // Quitar la multa es de la administración (no de la junta) y sólo mientras nadie la haya pagado ni tenga un pago en revisión.
  const multa = d !== null && puedeValidar(user) ? multaQuitable(d.conceptos) : null;

  return (
    <>
      <Modal
        open={!imprimiendo && pago === null}
        onClose={() => { if (!imprimiendo && pago === null) onClose(); /* al pasar al recibo o al pago, el diálogo se cierra solo: no es salir */ }}
        size="lg"
        title={d ? d.titulo.split(' · ')[0]! : 'Recibo de departamento'}
        description={d ? `Departamento ${d.unidad.codigo}${d.unidad.estructura?.nombre ? ` · ${d.unidad.estructura.nombre}` : ''}${d.propietario ? ` · ${d.propietario.nombre}` : ''}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            <Button variant="secondary" icon={<PrinterIcon className="h-4 w-4" />} disabled={!d} onClick={() => setImprimiendo(true)}>Ver / imprimir recibo</Button>
            {puedeRegistrar && !registrando && <Bloqueable>{b => <Button disabled={b} onClick={() => setRegistrando(true)}>Registrar pago</Button>}</Bloqueable>}
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
                  <p className="text-sm text-muted">Total del mantenimiento</p>
                  <p className="num text-2xl font-semibold">{dinero(d.total, d.moneda)}</p>
                </div>
                <StatusBadge estado={d.estado} />
              </div>
              <div className="mt-4">
                <DefinitionList
                  items={[
                    { label: 'N.º de recibo', value: <span className="num">{d.numero}</span> },
                    { label: 'Vencimiento', value: <span className={d.estado === 'vencido' ? 'text-bad' : ''}>{fechaCorta(d.fecha_vencimiento)}</span> },
                    { label: 'Pagado', value: <span className="num text-ok">{dinero(d.cobrado, d.moneda)}</span> },
                    ...(Number(d.en_revision) > 0 ? [{ label: 'En revisión', value: <span className="num">{dinero(d.en_revision, d.moneda)}</span> }] : []),
                    { label: 'Saldo por pagar', value: <span className="num font-medium">{dinero(d.saldo, d.moneda)}</span> },
                  ]}
                />
              </div>
            </div>

            {registrando && d && (
              <section aria-labelledby="reg-pago" className="rounded border border-line p-4">
                <h3 id="reg-pago" className="mb-3 text-sm font-semibold">Registrar el pago del mantenimiento</h3>
                <FormPagoMantenimiento reciboId={reciboId} unidadId={unidadId} saldo={d.saldo} moneda={d.moneda} onRegistrado={tras} onPagoCreado={onCambio} />
              </section>
            )}
            {d.estado === 'en_revision' && <Alert tone="info">Hay un pago esperando validación: ábrelo en el historial para revisarlo.</Alert>}

            <section aria-labelledby="conceptos-adm">
              <h3 id="conceptos-adm" className="mb-2 text-sm font-semibold">Detalle por concepto</h3>
              <ConceptosTabla conceptos={d.conceptos} total={d.total} moneda={d.moneda} />
              {multa && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">Tiene una multa de <span className="num">{dinero(multa.monto, d.moneda)}</span> sin pagar.</p>
                  <Button size="sm" variant="secondary" onClick={() => setQuitandoMulta(true)}>Quitar la multa</Button>
                </div>
              )}
            </section>
            <section aria-labelledby="pagos-adm">
              <h3 id="pagos-adm" className="mb-2 text-sm font-semibold">Pagos de este mantenimiento</h3>
              <HistorialPagos pagos={d.pagos} onVer={abrirPago} moneda={d.moneda} />
            </section>

            {puedeRegistrar && PAGO_PARCIAL_CONCEPTO && (
              <details className="rounded border border-line px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium">Opciones avanzadas: pago parcial de un concepto</summary>
                <p className="mt-2 text-sm text-muted">Sólo para cuando el vecino paga una parte de un concepto. Lo normal es registrar el pago del mantenimiento completo.</p>
                <ul className="mt-3 space-y-3">
                  {d.conceptos.filter(c => Number(c.saldo) > 0).map(c => (
                    <li key={c.cargo_id} className="space-y-2">
                      <p className="text-sm font-medium">{c.concepto} <span className="num font-normal text-muted">· saldo {dinero(c.saldo, d.moneda)}</span></p>
                      <PagoParcialConcepto cargoId={c.cargo_id} saldo={c.saldo} moneda={d.moneda} onRegistrado={tras} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Modal>
      <ValidarPagoModal pago={pago} onClose={() => setPago(null)} onRevisado={tras} />
      {quitandoMulta && multa && d && <QuitarMultaModal reciboId={reciboId} unidadId={unidadId} codigo={d.unidad.codigo} monto={multa.monto} moneda={d.moneda} onClose={() => setQuitandoMulta(false)} onQuitada={tras} />}
      {imprimiendo && d && <ReciboImprimible detalle={d} onClose={() => setImprimiendo(false)} />}
    </>
  );
}
