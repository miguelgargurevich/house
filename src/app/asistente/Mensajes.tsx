import { useState } from 'react';
import { ArrowPathIcon, CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { Alert, Button } from '../../ui';
import { Markdown } from './Markdown';
import { PuntosPensando } from './PuntosPensando';
import type { MensajeChat } from './tipos';

const segundos = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

interface Props {
  mensajes: MensajeChat[];
  /** Sólo el superadmin ve bajo cada respuesta «modelo · 1,2 s». */
  verMetricas: boolean;
  onReintentar: () => void;
  onNavegar: (ruta: string) => void;
  onCopiar: (texto: string) => Promise<boolean>;
  ocupado: boolean;
}

function Copiar({ texto, onCopiar }: { texto: string; onCopiar: (t: string) => Promise<boolean> }) {
  const [copiado, setCopiado] = useState(false);
  const etiqueta = copiado ? 'Copiado' : 'Copiar respuesta';
  // 44 px de objetivo táctil; los márgenes negativos lo dejan en 28 px de alto en la fila.
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={() => { void onCopiar(texto).then((ok) => { if (ok) { setCopiado(true); setTimeout(() => setCopiado(false), 1800); } }); }}
      className="-my-2 -ml-3 inline-flex h-11 w-11 items-center justify-center rounded transition-colors duration-150 hover:bg-surface2 hover:text-ink"
    >
      {copiado ? <CheckIcon className="h-4 w-4 text-ok" aria-hidden="true" /> : <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

export function Mensajes({ mensajes, verMetricas, onReintentar, onNavegar, onCopiar, ocupado }: Props) {
  const ultimo = mensajes.length - 1;
  return (
    <ol className="mx-auto w-full max-w-2xl space-y-5 px-4" aria-label="Conversación">
      {mensajes.map((m, i) => {
        if (m.rol === 'user') {
          return <li key={m.id} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-soft px-3.5 py-2 text-sm">{m.texto}</li>;
        }
        const pensando = m.estado === 'transmitiendo' && !m.texto;
        return (
          <li key={m.id} aria-busy={m.estado === 'transmitiendo' || undefined}>
            {pensando && <PuntosPensando />}
            {m.texto && <Markdown texto={m.texto} onNavegar={onNavegar} />}
            {m.estado === 'error' && m.error && (
              <div className={m.texto ? 'mt-2' : undefined}>
                <Alert tone="bad">{m.error.mensaje}</Alert>
                {i === ultimo && (
                  <Button variant="secondary" size="sm" className="mt-2" icon={<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />} disabled={ocupado} onClick={onReintentar}>Reintentar</Button>
                )}
              </div>
            )}
            {m.estado !== 'transmitiendo' && m.texto && (
              <div className="mt-1 flex min-h-7 items-center gap-1 text-xs text-muted">
                <Copiar texto={m.texto} onCopiar={onCopiar} />
                {m.modo === 'contingencia' && <span>Respuesta sin IA</span>}
                {verMetricas && m.modelo && <span className="num">{m.modelo}{m.latencia_ms != null ? ` · ${segundos(m.latencia_ms)}` : ''}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
