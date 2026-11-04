import { useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Alert, Button, Modal, Textarea, dinero, useToast } from '../../../../ui';
import { errorMotivoAnulacion, MOTIVO_ANULACION_MAX, textoAnular } from './anular';

/** Lo que responde `POST /api/pagos/:id/anular` y que el detalle necesita para mostrarse ya anulado. */
export interface PagoAnuladoRespuesta {
  estado_validacion: 'anulado';
  anulado_at: string | null;
  motivo_anulacion: string | null;
  anulado_por?: { id: number; nombre: string } | null;
}

interface Props { pagoId: number; codigo?: string | null; monto: string | number; moneda?: string; onClose: () => void; onAnulado: (p: PagoAnuladoRespuesta) => void }

/** Pide el motivo y anula el pago validado (todo el mantenimiento). Sólo la administración; queda auditado con el motivo y el monto. */
export function AnularPagoModal({ pagoId, codigo, monto, moneda, onClose, onAnulado }: Props) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);

  async function anular() {
    const e = errorMotivoAnulacion(motivo);
    if (e) return void setError(e);
    setEnviando(true);
    try {
      const r = await api<PagoAnuladoRespuesta>(`/api/pagos/${pagoId}/anular`, { method: 'POST', json: { motivo: motivo.trim() } });
      toast.ok('Pago anulado. El recibo volvió a quedar pendiente y avisamos al vecino.');
      onAnulado(r);
      onClose();
    } catch (err) { toast.error(errorText(err)); }
    finally { setEnviando(false); }
  }

  return (
    <Modal
      open
      onClose={enviando ? () => undefined : onClose}
      title="Anular pago"
      description={`${codigo ? `Departamento ${codigo} · ` : ''}pago de ${dinero(monto, moneda)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant="danger" loading={enviando} onClick={() => void anular()}>Anular</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warn"><span className="flex items-start gap-2"><ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{textoAnular(codigo)}</span></span></Alert>
        <div>
          <Textarea
            label="Motivo"
            hint="Obligatorio. Ejemplo: Pago duplicado."
            error={error}
            value={motivo}
            maxLength={MOTIVO_ANULACION_MAX}
            onChange={e => { setMotivo(e.target.value); setError(undefined); }}
            autoFocus
          />
          <p className="num mt-1 text-right text-xs text-muted" aria-hidden="true">{motivo.length}/{MOTIVO_ANULACION_MAX}</p>
        </div>
      </div>
    </Modal>
  );
}
