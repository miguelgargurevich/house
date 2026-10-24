import { useState } from 'react';
import { ArrowPathIcon, CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { Alert, Button, IconButton, Spinner, cx } from '../../ui';
import { Markdown } from './Markdown';
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
  return (
    <IconButton
      label={copiado ? 'Copiado' : 'Copiar respuesta'}
      onClick={() => { void onCopiar(texto).then((ok) => { if (ok) { setCopiado(true); setTimeout(() => setCopiado(false), 1800); } }); }}
    >
      {copiado ? <CheckIcon className="h-4 w-4 text-ok" aria-hidden="true" /> : <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />}
    </IconButton>
  );
}

export function Mensajes({ mensajes, verMetricas, onReintentar, onNavegar, onCopiar, ocupado }: Props) {
  const ultimo = mensajes.length - 1;
  return (
    <ol className="space-y-3" aria-label="Conversación">
      {mensajes.map((m, i) => {
        if (m.rol === 'user') {
          return <li key={m.id} className="ml-10 whitespace-pre-wrap break-words rounded-lg bg-brand-soft px-3 py-2 text-sm">{m.texto}</li>;
        }
        const pensando = m.estado === 'transmitiendo' && !m.texto;
        return (
          <li key={m.id} className="mr-6" aria-busy={m.estado === 'transmitiendo' || undefined}>
            <div className={cx('rounded-lg border px-3 py-2', m.estado === 'error' ? 'border-bad/40' : 'border-line')}>
              {pensando && <div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner /> Pensando…</div>}
              {m.texto && <Markdown texto={m.texto} onNavegar={onNavegar} />}
              {m.estado === 'error' && m.error && (
                <div className={m.texto ? 'mt-2' : undefined}>
                  <Alert tone="bad">{m.error.mensaje}</Alert>
                  {i === ultimo && (
                    <Button variant="secondary" size="sm" className="mt-2" icon={<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />} disabled={ocupado} onClick={onReintentar}>Reintentar</Button>
                  )}
                </div>
              )}
            </div>
            {m.estado !== 'transmitiendo' && m.texto && (
              <div className="mt-0.5 flex items-center gap-1 pl-1 text-xs text-muted">
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
