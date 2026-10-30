import { useState } from 'react';
import { api, errorText } from '../../../../api';
import { Button, Modal, Textarea, dinero, useToast } from '../../../../ui';
import { errorMotivoMulta, MOTIVO_MULTA_MAX } from './morosos';

interface Props { reciboId: number; unidadId: number; codigo?: string; monto: string; moneda?: string; onClose: () => void; onQuitada: () => void }

/** Pide el motivo y quita la multa del departamento en ese recibo (sólo la administración; queda auditado con el motivo y el monto). */
export function QuitarMultaModal({ reciboId, unidadId, codigo, monto, moneda, onClose, onQuitada }: Props) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);

  async function quitar() {
    const e = errorMotivoMulta(motivo);
    if (e) return void setError(e);
    setEnviando(true);
    try {
      await api(`/api/recibos/${reciboId}/mantenimientos/${unidadId}/quitar-multa`, { method: 'POST', json: { motivo: motivo.trim() } });
      toast.ok('Multa quitada. El recibo del vecino ya no la cobra.');
      onQuitada();
      onClose();
    } catch (err) { toast.error(errorText(err)); }
    finally { setEnviando(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Quitar la multa"
      description={`${codigo ? `Departamento ${codigo} · ` : ''}multa de ${dinero(monto, moneda)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant="danger" loading={enviando} onClick={() => void quitar()}>Quitar la multa</Button>
        </>
      }
    >
      <Textarea
        label="Motivo"
        hint={`Queda registrado en la auditoría con tu nombre y el monto (de 5 a ${MOTIVO_MULTA_MAX} caracteres).`}
        error={error}
        value={motivo}
        maxLength={MOTIVO_MULTA_MAX}
        onChange={e => { setMotivo(e.target.value); setError(undefined); }}
        autoFocus
      />
    </Modal>
  );
}
