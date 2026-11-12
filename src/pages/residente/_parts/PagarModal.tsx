import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { errorText, useResource } from '../../../api';
import { ErrorDeEnvio, errorDeArchivo, prepararComprobante, registrarPagoConVoucher } from '../../shared/comprobantes';
import { usePrepararArchivo } from '../../shared/usePrepararArchivo';
import { Alert, Button, Modal, useToast } from '../../../ui';
import { EstadoEvaluacion, ValidadoPorIABadge, useEvaluacionResidente } from '../../shared/evaluacion';
import { PanelPago } from './PagarPanel';
import { PiePago } from './PiePago';
import { esTactil, puedeEnviar } from './pago';
import type { Metodo } from './tipos';
import type { DetalleMantenimiento, Mantenimiento, ResultadoPagoMantenimiento } from '../../shared/mantenimiento/tipos';

/**
 * Paga el MANTENIMIENTO completo del mes de un departamento en UN solo panel: cuánto y el voucher (obligatorio). Las cuentas de pago están en el recibo.
 * Un solo envío (`multipart/form-data`): el servidor guarda el pago y el voucher juntos o no guarda nada.
 */
interface Props { mant: Mantenimiento | null; onClose: () => void; onPagado: () => void }

export function PagarModal({ mant, onClose, onPagado }: Props) {
  const toast = useToast();
  const [metodo, setMetodo] = useState<Metodo>('transferencia');
  const [referencia, setReferencia] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  const { preparando, preparar, cancelar } = usePrepararArchivo(prepararComprobante);
  // Id del pago recién enviado: mientras tanto se muestra cómo va la revisión automática del voucher.
  const [pagoEnviado, setPagoEnviado] = useState<number | null>(null);
  const evaluacion = useEvaluacionResidente(pagoEnviado);
  const [conCamara] = useState(esTactil);
  const detalle = useResource<DetalleMantenimiento>(mant ? `/api/me/mantenimientos/${mant.recibo_id}/${mant.unidad_id}` : null);
  const d = mant && detalle.data && detalle.data.recibo_id === mant.recibo_id && detalle.data.unidad_id === mant.unidad_id ? detalle.data : null;

  useEffect(() => {
    cancelar(); // una foto que aún se achica no llega al formulario de otro mantenimiento
    if (!mant) return;
    setMetodo('transferencia');
    setReferencia('');
    setArchivo(null);
    setErrorArchivo(undefined);
    setEnviando(false);
    setPagoEnviado(null);
  }, [mant, cancelar]);

  // La foto se achica antes de validarla: mientras tanto no se puede enviar. Un resultado viejo (otra elección o modal cerrado) se descarta.
  async function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const f = input.files?.[0] ?? null;
    setArchivo(null);
    setErrorArchivo(undefined);
    if (!f) { cancelar(); return; }
    const listo = await preparar(f);
    if (!listo) return;
    const err = errorDeArchivo(listo);
    if (err) input.value = '';
    setErrorArchivo(err ?? undefined);
    setArchivo(err ? null : listo);
  }

  async function enviar() {
    if (!mant || !archivo || !puedeEnviar(archivo, enviando)) return;
    setEnviando(true);
    try {
      const ref = referencia.trim();
      const pago = await registrarPagoConVoucher<ResultadoPagoMantenimiento>(`/api/me/mantenimientos/${mant.recibo_id}/${mant.unidad_id}/pagos`, { metodo_pago: metodo, ...(ref ? { referencia: ref } : {}) }, archivo);
      onPagado();
      // Se queda abierto un momento para mostrar la revisión automática del voucher.
      setPagoEnviado(pago.pago_id);
    } catch (e) {
      // Si el servidor no aceptó el archivo se dice en el campo; lo demás, en un aviso. No quedó ningún pago: se corrige y se vuelve a enviar.
      if (e instanceof ErrorDeEnvio && e.campos.voucher) setErrorArchivo(e.message);
      else toast.error(`${errorText(e)} No se registró ningún pago: corrige y vuelve a intentar.`);
    } finally { setEnviando(false); }
  }

  const enviado = pagoEnviado !== null;
  return (
    <Modal
      open={mant !== null}
      onClose={onClose}
      size="lg"
      title={enviado ? 'Pago enviado' : 'Pagar mantenimiento'}
      footer={enviado ? <Button onClick={onClose}>Listo</Button> : <PiePago archivo={archivo} enviando={enviando} onCancelar={onClose} />}
    >
      {mant && enviado && (
        <div className="space-y-4">
          <Alert tone="ok">Tu pago del mantenimiento quedó registrado y en revisión; te avisaremos cuando se valide.</Alert>
          {evaluacion.estado && <EstadoEvaluacion estado={evaluacion.estado} />}
          {evaluacion.validadoPorIA && <ValidadoPorIABadge validado />}
        </div>
      )}
      {mant && !enviado && (
        <PanelPago
          mant={mant}
          saldo={d?.saldo ?? null}
          correoVouchers={d?.correo_vouchers ?? null}
          metodo={metodo}
          onMetodo={setMetodo}
          referencia={referencia}
          onReferencia={setReferencia}
          archivo={archivo}
          preparando={preparando}
          errorArchivo={errorArchivo}
          onArchivo={elegirArchivo}
          conCamara={conCamara}
          onEnviar={() => void enviar()}
        />
      )}
    </Modal>
  );
}
