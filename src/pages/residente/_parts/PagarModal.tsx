import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../api';
import { Alert, Button, DefinitionList, Input, Modal, Select, fechaCorta, periodo, soles, useToast } from '../../../ui';
import { METODOS } from './tipos';
import type { Cargo, Metodo } from './tipos';

interface Form { metodo_pago: Metodo; referencia: string }

interface Props { cargo: Cargo | null; onClose: () => void; onPagado: () => void }

export function PagarModal({ cargo, onClose, onPagado }: Props) {
  const toast = useToast();
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<Form>({ defaultValues: { metodo_pago: 'transferencia', referencia: '' } });

  useEffect(() => { if (cargo) reset({ metodo_pago: 'transferencia', referencia: '' }); }, [cargo, reset]);

  async function confirmar(v: Form) {
    if (!cargo) return;
    try {
      await api(`/api/me/cargos/${cargo.id}/pagos`, {
        method: 'POST',
        json: { metodo_pago: v.metodo_pago, ...(v.referencia.trim() ? { referencia: v.referencia.trim() } : {}) },
      });
      toast.ok('Pago registrado. El administrador lo validará.');
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
          <Alert tone="info">Registra el pago que ya hiciste; el administrador lo validará.</Alert>
          <div className="grid gap-4">
            <Select label="¿Cómo pagaste?" {...register('metodo_pago', { required: true })}>
              {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Input label="Referencia (opcional)" hint="N.º de operación o de transferencia." autoComplete="off" {...register('referencia')} />
          </div>
        </form>
      )}
    </Modal>
  );
}
