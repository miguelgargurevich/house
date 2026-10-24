import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { Button, Input, Select, soles, useToast } from '../../../../ui';
import { METODOS, hoyISO } from '../cobranza/comun';

interface Form { metodo_pago: string; referencia: string; fecha_pago: string }

/** Registra el pago del mantenimiento completo (queda validado de inmediato): método, referencia y fecha; el monto lo calcula el servidor. */
export function FormPagoMantenimiento({ reciboId, unidadId, saldo, onRegistrado }: { reciboId: number; unidadId: number; saldo: string; onRegistrado: () => void }) {
  const toast = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ defaultValues: { metodo_pago: 'transferencia', referencia: '', fecha_pago: hoyISO() } });

  async function enviar(v: Form) {
    try {
      await api(`/api/recibos/${reciboId}/mantenimientos/${unidadId}/pagos`, {
        method: 'POST',
        json: { metodo_pago: v.metodo_pago, ...(v.referencia.trim() ? { referencia: v.referencia.trim() } : {}), ...(v.fecha_pago ? { fecha_pago: v.fecha_pago } : {}) },
      });
      toast.ok('Pago registrado: el mantenimiento quedó pagado.');
      onRegistrado();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <form onSubmit={handleSubmit(enviar)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <p className="text-sm sm:col-span-2">Se registrará el pago del saldo completo: <span className="num font-semibold">{soles(saldo)}</span>.</p>
      <Select label="Método de pago" {...register('metodo_pago', { required: true })}>
        {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
      <Input label="Fecha del pago" type="date" max={hoyISO()} error={errors.fecha_pago && 'Elige la fecha en que se pagó'} {...register('fecha_pago', { required: true })} />
      <Input label="Referencia (opcional)" className="sm:col-span-2" placeholder="N.º de operación o comprobante" autoComplete="off" {...register('referencia')} />
      <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting}>Registrar pago del mantenimiento</Button></div>
    </form>
  );
}
