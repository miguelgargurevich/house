import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { Button, Input, Select, soles, useToast } from '../../../../ui';
import { ACCEPT_COMPROBANTE, errorDeArchivo, registrarPagoConVoucher, tamanoLegible } from '../../../shared/comprobantes';
import type { ResultadoPagoMantenimiento } from '../../../shared/mantenimiento/tipos';
import { METODOS, hoyISO } from '../cobranza/comun';
import { SeguimientoVoucher } from './SeguimientoVoucher';

interface Form { metodo_pago: string; referencia: string; fecha_pago: string }

/**
 * Registra el pago del mantenimiento completo: método, referencia y fecha; el monto lo calcula el servidor.
 * Sin voucher queda validado de inmediato. Con voucher (imagen o PDF) nace «por validar» y la IA lo revisa: si coincide y el condominio
 * tiene la validación automática queda pagado; si no, queda en revisión. Con voucher la pantalla se queda mostrando el resultado hasta «Listo»
 * (`onRegistrado` se llama entonces; `onPagoCreado` avisa al instante que ya hay un pago, para refrescar listas sin cerrar nada).
 */
export function FormPagoMantenimiento({ reciboId, unidadId, saldo, onRegistrado, onPagoCreado }: { reciboId: number; unidadId: number; saldo: string; onRegistrado: () => void; onPagoCreado?: () => void }) {
  const toast = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ defaultValues: { metodo_pago: 'transferencia', referencia: '', fecha_pago: hoyISO() } });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>();
  const [resultado, setResultado] = useState<ResultadoPagoMantenimiento | null>(null);

  function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    const err = f ? errorDeArchivo(f) : null;
    if (err) e.target.value = '';
    setErrorArchivo(err ?? undefined);
    setArchivo(f && !err ? f : null);
  }

  async function enviar(v: Form) {
    const ruta = `/api/recibos/${reciboId}/mantenimientos/${unidadId}/pagos`;
    const referencia = v.referencia.trim();
    try {
      if (archivo) {
        // Una sola petición: el servidor verifica el archivo antes de crear el pago, así que si falla no queda nada a medias y se puede reintentar.
        const r = await registrarPagoConVoucher<ResultadoPagoMantenimiento>(ruta, { metodo_pago: v.metodo_pago, ...(referencia ? { referencia } : {}), ...(v.fecha_pago ? { fecha_pago: v.fecha_pago } : {}) }, archivo);
        setResultado(r);
        onPagoCreado?.();
        return;
      }
      await api(ruta, { method: 'POST', json: { metodo_pago: v.metodo_pago, ...(referencia ? { referencia } : {}), ...(v.fecha_pago ? { fecha_pago: v.fecha_pago } : {}) } });
      toast.ok('Pago registrado: el mantenimiento quedó pagado.');
      onRegistrado();
    } catch (e) { toast.error(`${errorText(e)}${archivo ? ' No se registró ningún pago: corrige y vuelve a intentar.' : ''}`); }
  }

  if (resultado) return <SeguimientoVoucher reciboId={reciboId} unidadId={unidadId} pagoId={resultado.pago_id} inicial={resultado.mantenimiento} onListo={onRegistrado} />;

  return (
    <form onSubmit={handleSubmit(enviar)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <p className="text-sm sm:col-span-2">Se registrará el pago del saldo completo: <span className="num font-semibold">{soles(saldo)}</span>.</p>
      <Select label="Método de pago" {...register('metodo_pago', { required: true })}>
        {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
      <Input label="Fecha del pago" type="date" max={hoyISO()} error={errors.fecha_pago && 'Elige la fecha en que se pagó'} {...register('fecha_pago', { required: true })} />
      <Input label="Referencia (opcional)" className="sm:col-span-2" placeholder="N.º de operación o comprobante" autoComplete="off" {...register('referencia')} />
      <div className="sm:col-span-2">
        <Input
          label="Adjuntar voucher (opcional)"
          type="file"
          accept={ACCEPT_COMPROBANTE}
          hint={archivo
            ? 'Con voucher, el pago queda por validar y la IA lo revisa: si coincide con el recibo y el condominio tiene la validación automática, queda pagado; si no, queda en revisión para que lo valides.'
            : 'Foto o PDF del voucher, hasta 2 MB. Sin voucher, el pago queda validado de inmediato.'}
          error={errorArchivo}
          onChange={elegirArchivo}
          className="[&_input]:h-auto [&_input]:py-2"
        />
        {archivo && <p className="mt-2 truncate rounded bg-surface2 px-3 py-2 text-sm">{archivo.name} · <span className="num text-muted">{tamanoLegible(archivo.size)}</span></p>}
      </div>
      <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting}>{archivo ? 'Registrar pago y revisar voucher' : 'Registrar pago del mantenimiento'}</Button></div>
    </form>
  );
}
