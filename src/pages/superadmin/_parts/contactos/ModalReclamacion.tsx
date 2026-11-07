import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Badge, Button, Input, Modal, Textarea, fechaCorta, useToast } from '../../../../ui';
import { DOCUMENTO, textoPlazo, tonoPlazo, type Reclamacion } from './tipos';

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

/** Una hoja del Libro de Reclamaciones completa, el plazo que corre y el cierre: marcarla respondida con fecha y nota (o volverla a pendiente). */
export function ModalReclamacion({ reclamacion, onClose, onHecho }: { reclamacion: Reclamacion | null; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(hoy());
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFecha(hoy()); setNota(reclamacion?.respuesta_nota ?? ''); setError(null); }, [reclamacion]);
  if (!reclamacion) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const r = reclamacion;
  const respondida = r.estado === 'respondida';

  async function cambiar(estado: 'pendiente' | 'respondida') {
    setBusy(true); setError(null);
    try {
      await api(`/api/comercial/reclamaciones/${r.id}`, { method: 'PATCH', json: estado === 'respondida' ? { estado, fecha, nota } : { estado, nota } });
      toast.ok(estado === 'respondida' ? 'Marcada como respondida' : 'Vuelve a pendiente');
      onHecho();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Hoja ${r.correlativo}`} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        {respondida
          ? <Button variant="secondary" loading={busy} onClick={() => void cambiar('pendiente')}>Volver a pendiente</Button>
          : <Button loading={busy} onClick={() => void cambiar('respondida')}>Marcar como respondida</Button>}
      </>}>
      <div className="space-y-4 text-sm">
        {error && <Alert tone="bad">{error}</Alert>}
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={tonoPlazo(r)}>{textoPlazo(r)}</Badge>
          <span className="num text-muted">{respondida ? `Respondida el ${fechaCorta(r.respondida_at)}` : `Responder antes del ${fechaCorta(r.fecha_limite)}`}</span>
        </p>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted">Tipo</dt><dd>{r.tipo === 'queja' ? 'Queja' : 'Reclamo'}</dd>
          <dt className="text-muted">Registrada</dt><dd className="num">{fechaCorta(r.created_at)}</dd>
          <dt className="text-muted">Consumidor</dt><dd>{r.consumidor_nombre}</dd>
          <dt className="text-muted">Documento</dt><dd>{DOCUMENTO[r.consumidor_doc_tipo] ?? r.consumidor_doc_tipo} {r.consumidor_doc_numero}</dd>
          <dt className="text-muted">Domicilio</dt><dd>{r.consumidor_domicilio}</dd>
          <dt className="text-muted">Correo</dt><dd><a href={`mailto:${r.consumidor_correo}`} className="text-brand underline">{r.consumidor_correo}</a></dd>
          <dt className="text-muted">Teléfono</dt><dd>{r.consumidor_telefono ?? 'No indicó'}</dd>
          {r.menor_de_edad && <><dt className="text-muted">Padre, madre o apoderado</dt><dd>{r.apoderado_nombre} ({DOCUMENTO[r.apoderado_doc_tipo ?? ''] ?? ''} {r.apoderado_doc_numero})</dd></>}
          <dt className="text-muted">Bien contratado</dt><dd>{r.bien_tipo === 'producto' ? 'Producto' : 'Servicio'}: {r.bien_descripcion}</dd>
          <dt className="text-muted">Monto reclamado</dt><dd>{r.monto_reclamado ? `S/ ${r.monto_reclamado}` : 'No indicó'}</dd>
        </dl>
        <div><p className="text-muted">Detalle</p><p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface2 p-3">{r.detalle}</p></div>
        <div><p className="text-muted">Pedido del consumidor</p><p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface2 p-3">{r.pedido}</p></div>
        {!r.copia_consumidor_enviada && <p className="text-xs text-muted">La copia por correo al consumidor no salió: respóndele desde tu correo y menciona el número de hoja.</p>}
        {!respondida && <Input label="Fecha de la respuesta" type="date" max={hoy()} value={fecha} onChange={e => setFecha(e.target.value)} hint="Día en que le respondiste. Por defecto, hoy." />}
        <Textarea label="Nota de la respuesta (opcional)" rows={3} maxLength={2000} value={nota} onChange={e => setNota(e.target.value)} hint="Qué le respondiste y por qué medio." />
      </div>
    </Modal>
  );
}
