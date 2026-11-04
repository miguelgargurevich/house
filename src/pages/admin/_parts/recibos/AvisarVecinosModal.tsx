import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, errorText, useResource } from '../../../../api';
import { Alert, Button, Modal, Skeleton, Textarea, useToast } from '../../../../ui';

/** Cómo va el grupo de WhatsApp del recibo (su block, o el del condominio). Sin nombre de grupo ni número. */
interface GrupoRecibo {
  destino: 'block' | 'condominio';
  ubicacion: string;
  situacion: 'sin_grupo' | 'ya_no_esta' | 'listo' | 'enviado';
  /** Lo que falta, con el nombre del block («El Block 9 no tiene grupo de WhatsApp…»). `null` si todo está bien. */
  aviso: string | null;
}

/** Vista previa del aviso: sólo conteos, nunca nombres ni datos de contacto. */
interface Vista {
  vecinos: number;
  por_correo: number;
  por_whatsapp: number;
  por_avisar: number;
  ya_avisados: number;
  sin_canal: number;
  espera_segundos: number;
  grupo: GrupoRecibo | null;
}

/** Lo que dejó el envío en cola. */
interface Resultado {
  encolados: number;
  ya_avisados: number;
  sin_canal: number;
  grupo: GrupoRecibo | null;
}

/** Una línea sobre el grupo del block: va sola (el aviso sale), o dice qué falta. */
function TextoGrupo({ grupo }: { grupo: GrupoRecibo | null }) {
  if (!grupo) return null;
  if (grupo.aviso) return <Alert tone="warn">{grupo.aviso}</Alert>;
  if (grupo.situacion === 'enviado') return <p className="text-sm text-muted">El grupo de WhatsApp de {grupo.ubicacion} ya recibió este recibo.</p>;
  return <p className="text-sm text-ink">Además, el aviso va al grupo de WhatsApp de {grupo.ubicacion}: un solo mensaje para todos.</p>;
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
  const location = useLocation();
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
              <TextoGrupo grupo={v.grupo} />
            </>
          ) : null}
          {espera > 0 && <Alert tone="warn">Ya avisaste de este recibo hace poco. Podrás volver a enviarlo en {espera} s.</Alert>}
          {error && <Alert tone="bad">{error}</Alert>}
          {resultado && (
            <Alert tone="ok">
              <p>Quedaron en cola {resultado.encolados} {resultado.encolados === 1 ? 'vecino' : 'vecinos'}. Se envían en unos minutos.</p>
              {resultado.grupo?.aviso ? <p className="mt-1">{resultado.grupo.aviso}</p> : resultado.grupo?.situacion === 'listo' && <p className="mt-1">El mensaje al grupo de WhatsApp de {resultado.grupo.ubicacion} sale en unos minutos.</p>}
              <Link to={`${location.pathname.startsWith('/junta') ? '/junta' : '/admin'}/avisos?tipo=recibo_emitido`} className="mt-1 inline-block font-medium underline">Ver en Comunicados › Notificaciones</Link>
            </Alert>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Mensaje para el grupo de WhatsApp</h3>
          <p className="text-sm text-muted">El aviso ya va solo al grupo de tu block. Copia este mensaje sólo si quieres repetirlo a mano. Va sin montos ni nombres.</p>
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
