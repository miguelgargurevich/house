import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Button, Input, useToast } from '../../../../ui';
import type { AguaDelRecibo } from './tipos';

/** Lo que sale en el recibo impreso y es de ESTE recibo/torre: la fecha de corte del agua y el correo del block para enviar vouchers. */
export function DatosRecibo({ reciboId, recibo, onCambio }: { reciboId: number; recibo: AguaDelRecibo['recibo']; onCambio: () => void }) {
  const toast = useToast();
  const [corte, setCorte] = useState('');
  const [correo, setCorreo] = useState('');
  const [guardando, setGuardando] = useState<'corte' | 'correo' | null>(null);
  const [errorCorreo, setErrorCorreo] = useState<string | undefined>();
  useEffect(() => { setCorte(recibo.fecha_corte_agua?.slice(0, 10) ?? ''); setCorreo(recibo.estructura?.correo_vouchers ?? ''); }, [recibo]);

  async function guardarCorte() {
    setGuardando('corte');
    try {
      await api(`/api/recibos/${reciboId}/datos`, { method: 'PUT', json: { fecha_corte_agua: corte || null } });
      toast.ok(corte ? 'Fecha de corte guardada' : 'Fecha de corte quitada');
      onCambio();
    } catch (e) { toast.error(errorText(e)); } finally { setGuardando(null); }
  }

  async function guardarCorreo() {
    if (!recibo.estructura) return;
    setGuardando('correo');
    setErrorCorreo(undefined);
    try {
      await api(`/api/estructuras/${recibo.estructura.id}/correo-vouchers`, { method: 'PUT', json: { correo_vouchers: correo.trim() || null } });
      toast.ok(correo.trim() ? 'Correo del block guardado' : 'Correo del block quitado');
      onCambio();
    } catch (e) { setErrorCorreo(errorText(e)); } finally { setGuardando(null); }
  }

  const cambioCorte = (recibo.fecha_corte_agua?.slice(0, 10) ?? '') !== corte;
  const cambioCorreo = (recibo.estructura?.correo_vouchers ?? '') !== correo.trim();
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="flex items-end gap-2">
        <Input label="Fecha de corte del agua" type="date" className="min-w-0 flex-1" hint="Sale en el recibo impreso. Déjala vacía si no hay corte." value={corte} onChange={e => setCorte(e.target.value)} />
        <Button variant="secondary" className="mb-6" loading={guardando === 'corte'} disabled={!cambioCorte} onClick={() => void guardarCorte()}>Guardar</Button>
      </div>
      {recibo.estructura ? (
        <div className="flex items-end gap-2">
          <Input label={`Correo del block${recibo.estructura.nombre ? ` (${recibo.estructura.nombre})` : ''}`} type="email" className="min-w-0 flex-1" hint="Al que los vecinos envían su voucher; sale en el recibo. Es el correo de la junta del block." error={errorCorreo} value={correo} onChange={e => setCorreo(e.target.value)} />
          <Button variant="secondary" className="mb-6" loading={guardando === 'correo'} disabled={!cambioCorreo} onClick={() => void guardarCorreo()}>Guardar</Button>
        </div>
      ) : (
        <p className="self-center text-sm text-muted">Este recibo no es de un block: el correo para enviar vouchers se define en cada block.</p>
      )}
    </div>
  );
}
