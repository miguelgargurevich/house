import { useState } from 'react';
import { errorText } from '../../../api';
import { entrarComo } from '../../../auth/impersonacion';
import { MOTIVO_MAX, errorDeMotivo } from '../../../auth/impersonacion-lib';
import { Button, Modal, Textarea } from '../../../ui';

export interface PersonaEntrable { id: number; nombre: string }

/** Pide el motivo (obligatorio; queda en la auditoría) y entra como la persona. Al entrar, la app se recarga en el inicio de su rol. */
export function EntrarComoModal({ persona, onClose }: { persona: PersonaEntrable | null; onClose: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cerrar = () => { if (enviando) return; setMotivo(''); setError(null); onClose(); };
  const enviar = async () => {
    if (!persona) return;
    const e = errorDeMotivo(motivo);
    if (e) { setError(e); return; }
    setEnviando(true);
    setError(null);
    try { await entrarComo(persona.id, motivo.trim()); } catch (err) { setError(errorText(err)); setEnviando(false); }
  };

  return (
    <Modal
      open={!!persona}
      onClose={cerrar}
      title={persona ? `Entrar como ${persona.nombre}` : 'Entrar como'}
      description="Verás Torre como esa persona hasta 30 minutos. Todo lo que hagas queda en la auditoría con su nombre y el tuyo."
      footer={(
        <>
          <Button variant="secondary" onClick={cerrar} disabled={enviando}>Cancelar</Button>
          <Button onClick={() => void enviar()} loading={enviando}>Entrar</Button>
        </>
      )}
    >
      <form onSubmit={e => { e.preventDefault(); void enviar(); }}>
        <Textarea
          label="Motivo"
          value={motivo}
          onChange={e => { setMotivo(e.target.value); setError(null); }}
          maxLength={MOTIVO_MAX + 50}
          error={error ?? undefined}
          hint={`Obligatorio, de 5 a ${MOTIVO_MAX} caracteres. Ejemplo: «Soporte: no ve su recibo de octubre».`}
          autoFocus
        />
        <p className="mt-1 text-right text-xs text-muted num" aria-hidden="true">{motivo.trim().length}/{MOTIVO_MAX}</p>
        <p className="mt-3 text-sm text-muted">Mientras estés dentro no podrás cambiar su contraseña, correo, celular ni sus accesos.</p>
      </form>
    </Modal>
  );
}
