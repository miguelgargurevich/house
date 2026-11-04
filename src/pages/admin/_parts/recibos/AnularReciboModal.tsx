import { useState } from 'react';
import { api, errorText } from '../../../../api';
import { Bloqueable } from '../../../../app/Bloqueable';
import { Alert, Button, Modal, Skeleton, Textarea, dinero, useToast } from '../../../../ui';
import { MOTIVO_ANULAR_MAX, efectoAnulacion, errorMotivo, tambienSeLleva, type ResumenAnulacion } from './correccion';

interface Props {
  reciboId: number;
  /** Periodo y torre del recibo, para el encabezado. */
  titulo: string;
  /** Lo que haría la anulación (lo trae la pantalla del periodo, que ya lo pidió para el botón). */
  resumen: ResumenAnulacion | null;
  onClose: () => void;
  /** El recibo ya no existe: la pantalla vuelve a la lista de recibos. */
  onAnulado: (r: { periodo: string; avisados: number }) => void;
}

/**
 * «Anular recibo»: deja libre el mes de ese block para emitirlo otra vez. Pide el motivo (queda en la auditoría con la foto de lo que se quitó) y si se avisa a los
 * vecinos. Con pagos vigentes no se puede: el modal lo dice y el botón queda apagado.
 */
export function AnularReciboModal({ reciboId, titulo, resumen, onClose, onAnulado }: Props) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [avisar, setAvisar] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const puede = resumen?.puede === true;
  const extra = resumen ? tambienSeLleva(resumen) : [];

  async function anular() {
    const e = errorMotivo(motivo, MOTIVO_ANULAR_MAX);
    if (e) return void setError(e);
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const r = await api<{ periodo: string; avisados: number }>(`/api/recibos/${reciboId}/anular`, { method: 'POST', json: { motivo: motivo.trim(), avisar } });
      toast.ok(`Recibo anulado. Ya puedes emitir ${r.periodo} de nuevo.`);
      onAnulado(r);
    } catch (err) {
      setErrorEnvio(errorText(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => { if (!enviando) onClose(); }}
      title="Anular recibo"
      description={titulo}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Bloqueable>{b => <Button variant="danger" loading={enviando} disabled={!puede || b} onClick={() => void anular()}>Anular recibo</Button>}</Bloqueable>
        </>
      }
    >
      <div className="space-y-4">
        {!resumen ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <p className="text-sm text-ink">{efectoAnulacion(resumen)}</p>
            <p className="text-sm text-muted">Emitido: <span className="num">{dinero(resumen.total, resumen.moneda)}</span> en {resumen.cargos} {resumen.cargos === 1 ? 'cargo' : 'cargos'}. Se quita también la mora que la emisión agregó.</p>
            {extra.length > 0 && (
              <Alert tone="warn">
                <p>También se quitan:</p>
                <ul className="mt-1 list-disc pl-5">{extra.map(l => <li key={l}>{l}</li>)}</ul>
              </Alert>
            )}
            {!puede && <Alert tone="bad">{resumen.bloqueo ?? 'Este recibo tiene pagos: anúlalos o recházalos antes'}. Ve a Pagos, y vuelve cuando no quede ninguno vigente.</Alert>}
          </>
        )}
        <Textarea
          label="Motivo"
          hint={`Queda registrado en la auditoría con tu nombre y todo lo que se quitó (de 5 a ${MOTIVO_ANULAR_MAX} caracteres).`}
          error={error}
          value={motivo}
          maxLength={MOTIVO_ANULAR_MAX}
          disabled={!puede}
          onChange={e => { setMotivo(e.target.value); setError(undefined); }}
          autoFocus
        />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(var(--brand))]" checked={avisar} disabled={!puede} onChange={e => setAvisar(e.target.checked)} />
          <span>
            Avisar a los vecinos
            <span className="block text-muted">Les llega «Se anuló el recibo…» por correo y WhatsApp, según lo que tengan activo. Al grupo de WhatsApp no se envía nada.</span>
          </span>
        </label>
        {errorEnvio && <Alert tone="bad">{errorEnvio}</Alert>}
      </div>
    </Modal>
  );
}
