import { useState } from 'react';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Alert, Button, Modal, Textarea, dinero, useToast } from '../../../../ui';
import { errorMotivoReapertura, MOTIVO_REAPERTURA_MAX, textoReabrir } from './reabrir';

interface Props { pagoId: number; codigo?: string | null; monto: string | number; moneda?: string; onClose: () => void; onReabierto: () => void }

/** Pide el motivo y devuelve el pago rechazado a «Por validar» (todo el mantenimiento). Sólo la administración; queda auditado con el motivo y el rechazo anterior. */
export function ReabrirPagoModal({ pagoId, codigo, monto, moneda, onClose, onReabierto }: Props) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);

  async function reabrir() {
    const e = errorMotivoReapertura(motivo);
    if (e) return void setError(e);
    setEnviando(true);
    try {
      await api(`/api/pagos/${pagoId}/reabrir`, { method: 'POST', json: { motivo: motivo.trim() } });
      toast.ok('Pago devuelto a Por validar. El recibo quedó en revisión.');
      onReabierto();
      onClose();
    } catch (err) { toast.error(errorText(err)); }
    finally { setEnviando(false); }
  }

  return (
    <Modal
      open
      onClose={enviando ? () => undefined : onClose}
      title="Volver a revisar"
      description={`${codigo ? `Departamento ${codigo} · ` : ''}pago de ${dinero(monto, moneda)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button loading={enviando} icon={<ArrowUturnLeftIcon className="h-4 w-4" aria-hidden="true" />} onClick={() => void reabrir()}>Volver a revisar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info">{textoReabrir(codigo)}</Alert>
        <div>
          <Textarea
            label="Motivo"
            hint="Obligatorio. Ejemplo: Lo rechacé por error, el abono sí llegó."
            error={error}
            value={motivo}
            maxLength={MOTIVO_REAPERTURA_MAX}
            onChange={e => { setMotivo(e.target.value); setError(undefined); }}
            autoFocus
          />
          <p className="num mt-1 text-right text-xs text-muted" aria-hidden="true">{motivo.length}/{MOTIVO_REAPERTURA_MAX}</p>
        </div>
      </div>
    </Modal>
  );
}
