import { Button } from '../../../ui';
import { FORM_PAGO, puedeEnviar } from './pago';

/** Pie del panel: «Enviar pago» queda apagado hasta que haya un voucher válido. */
export function PiePago({ archivo, enviando, onCancelar }: { archivo: File | null; enviando: boolean; onCancelar: () => void }) {
  return (
    <>
      <Button key="cancelar" variant="secondary" onClick={onCancelar}>Cancelar</Button>
      <Button key="enviar" type="submit" form={FORM_PAGO} loading={enviando} disabled={!puedeEnviar(archivo, enviando)}>Enviar pago</Button>
    </>
  );
}
