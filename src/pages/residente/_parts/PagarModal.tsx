import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../api';
import { ACCEPT_COMPROBANTE, errorDeArchivo, subirComprobante, tamanoLegible } from '../../shared/comprobantes';
import { Alert, Button, DefinitionList, Input, Modal, Select, fechaCorta, periodo, soles, useToast } from '../../../ui';
import { METODOS } from './tipos';
import type { Cargo, Metodo } from './tipos';

interface Form { metodo_pago: Metodo; referencia: string }

interface Props { cargo: Cargo | null; onClose: () => void; onPagado: () => void }

export function PagarModal({ cargo, onClose, onPagado }: Props) {
  const toast = useToast();
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<Form>({ defaultValues: { metodo_pago: 'transferencia', referencia: '' } });

  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>();

  useEffect(() => {
    if (!cargo) return;
    reset({ metodo_pago: 'transferencia', referencia: '' });
    setArchivo(null);
    setErrorArchivo(undefined);
  }, [cargo, reset]);

  function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    const err = f ? errorDeArchivo(f) : null;
    if (err) e.target.value = '';
    setErrorArchivo(err ?? undefined);
    setArchivo(f && !err ? f : null);
  }

  async function confirmar(v: Form) {
    if (!cargo) return;
    try {
      const pago = await api<{ id: number }>(`/api/me/cargos/${cargo.id}/pagos`, {
        method: 'POST',
        json: { metodo_pago: v.metodo_pago, ...(v.referencia.trim() ? { referencia: v.referencia.trim() } : {}) },
      });
      // El pago ya está registrado: si el archivo falla no se repite el pago, se avisa y se puede adjuntar después.
      let subido = true;
      if (archivo) {
        try { await subirComprobante(pago.id, archivo); }
        catch (e) { subido = false; toast.error(`Tu pago quedó registrado, pero no se pudo subir el comprobante: ${errorText(e)} Puedes adjuntarlo desde Mis pagos.`); }
      }
      if (subido) toast.ok('Tu pago quedó en revisión; te avisaremos cuando se valide.');
      onClose();
      onPagado();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={cargo !== null}
      onClose={onClose}
      title="Pagar recibo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="form-pago" loading={isSubmitting}>Confirmar pago</Button>
        </>
      }
    >
      {cargo && (
        <form id="form-pago" onSubmit={handleSubmit(confirmar)} className="space-y-5" noValidate>
          <div className="rounded bg-surface2 p-4">
            <p className="text-sm text-muted">Monto a pagar</p>
            <p className="num mb-4 text-2xl font-semibold">{soles(cargo.monto)}</p>
            <DefinitionList
              items={[
                { label: 'Concepto', value: cargo.concepto.nombre },
                { label: 'Periodo', value: periodo(cargo.recibo.mes, cargo.recibo.anio) },
                { label: 'Unidad', value: cargo.unidad.codigo },
                { label: 'Vencimiento', value: fechaCorta(cargo.recibo.fecha_vencimiento) },
              ]}
            />
          </div>
          <Alert tone="info">Registra el pago que ya hiciste. Quedará en revisión hasta que el administrador lo valide.</Alert>
          <div className="grid gap-4">
            <Select label="¿Cómo pagaste?" {...register('metodo_pago', { required: true })}>
              {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Input label="Referencia (opcional)" hint="N.º de operación o de transferencia." autoComplete="off" {...register('referencia')} />
            <div>
              <Input
                label="Adjuntar comprobante (opcional)"
                type="file"
                accept={ACCEPT_COMPROBANTE}
                hint="Foto o PDF de tu voucher, hasta 2 MB."
                error={errorArchivo}
                onChange={elegirArchivo}
                className="[&_input]:h-auto [&_input]:py-2"
              />
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
