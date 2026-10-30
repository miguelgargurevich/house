import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText, useResource } from '../../../../api';
import { Alert, Button, Modal, Skeleton, Textarea, useToast } from '../../../../ui';

/** Vista previa del aviso: sólo conteos, nunca nombres ni datos de contacto. */
interface Vista {
  vecinos: number;
  por_correo: number;
  por_whatsapp: number;
  por_avisar: number;
  ya_avisados: number;
  sin_canal: number;
  espera_segundos: number;
}

/** Lo que dejó el envío en cola. */
interface Resultado {
  encolados: number;
  ya_avisados: number;
  sin_canal: number;
}

interface Props {
  reciboId: number;
  /** Periodo y torre del recibo, para el encabezado. */
  titulo: string;
  onClose: () => void;
}

/**
 * «Avisar a los vecinos»: el recibo ya está. Dos cosas: el aviso a cada vecino (correo y WhatsApp, sin duplicar) y el mensaje listo para el
 * grupo de WhatsApp del block, que no lleva montos ni nombres.
 */
export function AvisarVecinosModal({ reciboId, titulo, onClose }: Props) {
  const toast = useToast();
  const vista = useResource<Vista>(`/api/recibos/${reciboId}/avisar`);
  const grupo = useResource<{ texto: string }>(`/api/recibos/${reciboId}/mensaje-grupo`);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const v = vista.data;
  const espera = v?.espera_segundos ?? 0;
  const puedeEnviar = !!v && v.por_avisar > 0 && espera === 0 && !enviando;

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await api<Resultado>(`/api/recibos/${reciboId}/avisar`, { method: 'POST' });
      setResultado(r);
      toast.ok(`Quedaron en cola ${r.encolados} ${r.encolados === 1 ? 'vecino' : 'vecinos'}.`);
      void vista.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setEnviando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(grupo.data?.texto ?? '');
      toast.ok('Mensaje copiado. Pégalo en el grupo de WhatsApp.');
    } catch {
      // Sin permiso del portapapeles (p. ej. una conexión sin HTTPS): el texto queda seleccionado para copiarlo a mano.
      textoRef.current?.focus();
      textoRef.current?.select();
      toast.error('No pudimos copiarlo solo. El texto quedó seleccionado: cópialo con Ctrl+C o ⌘C.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Avisar a los vecinos"
      description={titulo}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button loading={enviando} disabled={!puedeEnviar} onClick={() => void enviar()}>Enviar aviso</Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Aviso a cada vecino</h3>
          {vista.loading && !v ? (
            <Skeleton className="h-12 w-full" />
          ) : vista.error ? (
            <Alert tone="bad">{vista.error}</Alert>
          ) : v ? (
            <>
              <p className="text-sm text-ink">
                Le llegará a <strong>{v.por_correo}</strong> por correo y <strong>{v.por_whatsapp}</strong> por WhatsApp; <strong>{v.sin_canal}</strong> no tienen correo ni celular.
              </p>
              {v.ya_avisados > 0 && <p className="text-sm text-muted">{v.ya_avisados} ya lo tienen en cola o ya se les envió.</p>}
              {v.por_avisar === 0 && espera === 0 && <p className="text-sm text-muted">No hay nadie nuevo a quien avisar.</p>}
            </>
          ) : null}
          {espera > 0 && <Alert tone="warn">Ya avisaste de este recibo hace poco. Podrás volver a enviarlo en {espera} s.</Alert>}
          {error && <Alert tone="bad">{error}</Alert>}
          {resultado && (
            <Alert tone="ok">
              <p>Quedaron en cola {resultado.encolados} {resultado.encolados === 1 ? 'vecino' : 'vecinos'}. Se envían en unos minutos.</p>
              <Link to="/admin/avisos" className="mt-1 inline-block font-medium underline">Ver en Comunicados › Envíos</Link>
            </Alert>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Mensaje para el grupo de WhatsApp</h3>
          <p className="text-sm text-muted">Va sin montos ni nombres: es para el grupo del block.</p>
          {grupo.error ? (
            <Alert tone="bad">{grupo.error}</Alert>
          ) : (
            <Textarea ref={textoRef} label="Mensaje para el grupo de WhatsApp" ocultarEtiqueta readOnly rows={4} value={grupo.data?.texto ?? ''} />
          )}
          <Button variant="secondary" size="sm" disabled={!grupo.data} onClick={() => void copiar()}>Copiar mensaje para el grupo de WhatsApp</Button>
        </section>
      </div>
    </Modal>
  );
}
