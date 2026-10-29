import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CameraIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import { api, errorText, useResource } from '../../../api';
import { ACCEPT_COMPROBANTE, errorDeArchivo, subirComprobante, tamanoLegible } from '../../shared/comprobantes';
import { Alert, Button, Input, Modal, Select, fechaCorta, soles, useToast } from '../../../ui';
import { EstadoEvaluacion, ValidadoPorIABadge, useEvaluacionResidente } from '../../shared/evaluacion';
import { ComoPagar } from './ComoPagar';
import { METODOS } from './tipos';
import type { Metodo } from './tipos';
import type { DetalleMantenimiento, Mantenimiento, ResultadoPagoMantenimiento } from '../../shared/mantenimiento/tipos';

interface Form { metodo_pago: Metodo; referencia: string }

/** Paga el MANTENIMIENTO completo del mes de un departamento: un formulario y un solo comprobante por el total. */
interface Props { mant: Mantenimiento | null; onClose: () => void; onPagado: () => void }

export function PagarModal({ mant, onClose, onPagado }: Props) {
  const toast = useToast();
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<Form>({ defaultValues: { metodo_pago: 'transferencia', referencia: '' } });

  const [paso, setPaso] = useState<'como' | 'registrar' | 'enviado'>('como');
  // Id del pago cuyo comprobante se acaba de subir: mientras tanto se muestra cómo va la revisión automática.
  const [pagoSubido, setPagoSubido] = useState<number | null>(null);
  const evaluacion = useEvaluacionResidente(pagoSubido);
  const inputCamara = useRef<HTMLInputElement>(null);
  const detalle = useResource<DetalleMantenimiento>(mant ? `/api/me/mantenimientos/${mant.recibo_id}/${mant.unidad_id}` : null);
  const d = mant && detalle.data && detalle.data.recibo_id === mant.recibo_id && detalle.data.unidad_id === mant.unidad_id ? detalle.data : null;

  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>();

  useEffect(() => {
    if (!mant) return;
    reset({ metodo_pago: 'transferencia', referencia: '' });
    setPaso('como');
    setPagoSubido(null);
    setArchivo(null);
    setErrorArchivo(undefined);
  }, [mant, reset]);

  function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    const err = f ? errorDeArchivo(f) : null;
    if (err) e.target.value = '';
    setErrorArchivo(err ?? undefined);
    setArchivo(f && !err ? f : null);
  }

  async function confirmar(v: Form) {
    if (!mant) return;
    try {
      const pago = await api<ResultadoPagoMantenimiento>(`/api/me/mantenimientos/${mant.recibo_id}/${mant.unidad_id}/pagos`, {
        method: 'POST',
        json: { metodo_pago: v.metodo_pago, ...(v.referencia.trim() ? { referencia: v.referencia.trim() } : {}) },
      });
      // El pago ya está registrado: si el archivo falla no se repite el pago, se avisa y se puede adjuntar después.
      let subido = true;
      if (archivo) {
        try { await subirComprobante(pago.pago_id, archivo); }
        catch (e) { subido = false; toast.error(`Tu pago quedó registrado, pero no se pudo subir el comprobante: ${errorText(e)} Puedes adjuntarlo desde Mi historial › Pagos.`); }
      }
      onPagado();
      if (archivo && subido) {
        // Se queda abierto un momento para mostrar la revisión automática de la captura.
        setPagoSubido(pago.pago_id);
        setPaso('enviado');
        return;
      }
      if (subido) toast.ok('Tu pago quedó en revisión; te avisaremos cuando se valide.');
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={mant !== null}
      onClose={onClose}
      title={paso === 'como' ? 'Cómo pagar' : paso === 'enviado' ? 'Pago registrado' : 'Registrar tu pago'}
      footer={paso === 'enviado' ? (
        <Button onClick={onClose}>Listo</Button>
      ) : paso === 'como' ? (
        <>
          <Button key="cancelar" variant="secondary" onClick={onClose}>Cancelar</Button>
          {/* `key` distinto al de «Confirmar pago»: si React reutilizara este botón y le cambiara el tipo a «submit» durante el clic, el formulario se enviaría solo. */}
          <Button key="ya-pague" onClick={() => setPaso('registrar')}>Ya pagué: registrar comprobante</Button>
        </>
      ) : (
        <>
          <Button key="ver-como" variant="secondary" onClick={() => setPaso('como')}>Ver cómo pagar</Button>
          <Button key="confirmar" type="submit" form="form-pago" loading={isSubmitting}>Confirmar pago</Button>
        </>
      )}
    >
      {mant && paso === 'como' && <ComoPagar mant={mant} saldo={d?.saldo ?? null} medios={d?.medios_pago ?? null} loading={detalle.loading} error={detalle.error} notas={d?.condominio?.notas_pago ?? null} correoVouchers={d?.correo_vouchers ?? null} />}
      {mant && paso === 'enviado' && (
        <div className="space-y-4">
          <Alert tone="ok">Tu pago del mantenimiento quedó registrado y en revisión; te avisaremos cuando se valide.</Alert>
          {evaluacion.estado && <EstadoEvaluacion estado={evaluacion.estado} />}
          {evaluacion.validadoPorIA && <ValidadoPorIABadge validado />}
        </div>
      )}
      {mant && paso === 'registrar' && (
        <form id="form-pago" onSubmit={handleSubmit(confirmar)} className="space-y-5" noValidate>
          {/* Sólo lo que hace falta para registrar: el monto y de qué mes es. El detalle por concepto está en el recibo. */}
          <div className="rounded border border-line bg-surface2 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-muted">Monto a pagar</p>
              <p className="num text-2xl font-semibold">{d ? soles(d.saldo) : '—'}</p>
            </div>
            <p className="mt-1 text-sm text-muted">
              {mant.titulo.split(' · ')[0]} · {mant.unidad.codigo}{mant.unidad.estructura?.nombre ? ` · ${mant.unidad.estructura.nombre}` : ''} · vence el {fechaCorta(mant.fecha_vencimiento)}
            </p>
          </div>
          <p className="text-sm text-muted">Registra el pago que ya hiciste por el total. Queda en revisión hasta que se valide.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="¿Cómo pagaste?" {...register('metodo_pago', { required: true })}>
              {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Input label="N.º de operación (opcional)" autoComplete="off" {...register('referencia')} />
          </div>
          <div className="grid gap-4">
            <div>
              <Input
                label="Adjuntar comprobante (opcional)"
                type="file"
                accept={ACCEPT_COMPROBANTE}
                hint="Foto o PDF del voucher, hasta 2 MB. La IA lo revisa para validarlo más rápido."
                error={errorArchivo}
                onChange={elegirArchivo}
                className="[&_input]:h-auto [&_input]:py-2"
              />
              <div className="mt-2">
                <Button size="sm" variant="secondary" icon={<CameraIcon className="h-4 w-4" />} onClick={() => inputCamara.current?.click()}>Tomar foto con la cámara</Button>
                <input ref={inputCamara} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={elegirArchivo} className="sr-only" tabIndex={-1} aria-label="Tomar una foto del comprobante" />
              </div>
              {archivo && (
                <p className="mt-2 flex items-center justify-between gap-3 rounded bg-surface2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{archivo.name} · <span className="num text-muted">{tamanoLegible(archivo.size)}</span></span>
                </p>
              )}
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
