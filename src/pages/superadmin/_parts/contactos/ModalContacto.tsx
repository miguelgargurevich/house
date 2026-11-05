import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Badge, Button, Modal, Textarea, fechaCorta, useToast } from '../../../../ui';
import type { Contacto } from './tipos';

/** Un mensaje de /contacto: los datos de quien escribió y el botón para marcarlo atendido (con nota) o volverlo a «nuevo». */
export function ModalContacto({ contacto, onClose, onHecho }: { contacto: Contacto | null; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNota(contacto?.nota ?? ''); setError(null); }, [contacto]);
  if (!contacto) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const atendido = contacto.estado === 'atendida';

  async function cambiar(estado: 'nueva' | 'atendida') {
    setBusy(true); setError(null);
    try {
      await api(`/api/comercial/contactos/${contacto!.id}`, { method: 'PATCH', json: { estado, nota } });
      toast.ok(estado === 'atendida' ? 'Marcado como atendido' : 'Vuelve a «nuevo»');
      onHecho();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Mensaje de ${contacto.nombre}`} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        {atendido
          ? <Button variant="secondary" loading={busy} onClick={() => void cambiar('nueva')}>Volver a «nuevo»</Button>
          : <Button loading={busy} onClick={() => void cambiar('atendida')}>Marcar como atendido</Button>}
      </>}>
      <div className="space-y-4 text-sm">
        {error && <Alert tone="bad">{error}</Alert>}
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="text-muted">Recibido</dt><dd className="num">{fechaCorta(contacto.created_at)} {contacto.tema === 'demo' && <Badge tone="brand">Pidió una demo</Badge>}</dd>
          <dt className="text-muted">Correo</dt><dd><a href={`mailto:${contacto.correo}`} className="text-brand underline">{contacto.correo}</a></dd>
          <dt className="text-muted">Celular</dt><dd>{contacto.celular ?? 'No indicó'}</dd>
          <dt className="text-muted">Condominio</dt><dd>{contacto.condominio ?? 'No indicó'}</dd>
          <dt className="text-muted">Departamentos</dt><dd>{contacto.unidades ?? 'No indicó'}</dd>
          <dt className="text-muted">¿Varios condominios?</dt><dd>{contacto.varios_condominios ? 'Sí' : 'No'}</dd>
          {atendido && <><dt className="text-muted">Atendido</dt><dd className="num">{fechaCorta(contacto.atendida_at)}</dd></>}
        </dl>
        <div><p className="text-muted">Mensaje</p><p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface2 p-3">{contacto.mensaje}</p></div>
        {!contacto.aviso_enviado && <p className="text-xs text-muted">El aviso por correo a Torre no salió; el mensaje está guardado aquí.</p>}
        <Textarea label="Nota (opcional)" rows={2} maxLength={1000} value={nota} onChange={e => setNota(e.target.value)} hint="Por ejemplo: «Le escribí por WhatsApp; la demo es el jueves»." />
      </div>
    </Modal>
  );
}
