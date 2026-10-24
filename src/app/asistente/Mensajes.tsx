import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowPathIcon, CheckIcon, ClipboardDocumentIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { Alert, Button, cx } from '../../ui';
import { puedeRegenerar } from './acciones';
import { Markdown } from './Markdown';
import { PuntosPensando } from './PuntosPensando';
import type { MensajeChat } from './tipos';

const segundos = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

interface Props {
  mensajes: MensajeChat[];
  /** Sólo el superadmin ve bajo cada respuesta «modelo · 1,2 s». */
  verMetricas: boolean;
  onNavegar: (ruta: string) => void;
  onCopiar: (texto: string) => Promise<boolean>;
  onEditar: (id: string) => void;
  onRegenerar: () => void;
  onReintentarConAuto: () => void;
  onUsarAutoSiempre: () => void;
  /** El ajuste guardado ya es Auto: no tiene sentido ofrecer «Usar Auto siempre». */
  autoYaGuardado: boolean;
  ocupado: boolean;
}

/** Botón de acción de 44 px de objetivo táctil; los márgenes negativos lo dejan compacto en la fila. */
const ACCION = '-my-2 inline-flex h-11 w-11 items-center justify-center rounded transition-colors duration-150 hover:bg-surface2 hover:text-ink focus-visible:bg-surface2 disabled:opacity-50';

function Copiar({ texto, onCopiar, etiqueta }: { texto: string; onCopiar: (t: string) => Promise<boolean>; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(temporizador.current), []);
  const rotulo = copiado ? 'Copiado' : etiqueta;
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={() => { void onCopiar(texto).then((ok) => { if (ok) { setCopiado(true); clearTimeout(temporizador.current); temporizador.current = setTimeout(() => setCopiado(false), 2000); } }); }}
      className={cx(ACCION, '-ml-3')}
    >
      {copiado ? <CheckIcon className="h-4 w-4 text-ok" aria-hidden="true" /> : <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

function Fila({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mt-1 flex min-h-7 items-center gap-1 text-xs text-muted', className)}>{children}</div>;
}

export function Mensajes({ mensajes, verMetricas, onNavegar, onCopiar, onEditar, onRegenerar, onReintentarConAuto, onUsarAutoSiempre, autoYaGuardado, ocupado }: Props) {
  const ultimo = mensajes.length - 1;
  return (
    <ol className="mx-auto w-full max-w-2xl space-y-5 px-4" aria-label="Conversación">
      {mensajes.map((m, i) => {
        if (m.rol === 'user') {
          return (
            // Las acciones aparecen al pasar el ratón o al enfocar con el teclado; en pantallas táctiles (sin hover) se ven siempre.
            <li key={m.id} className="group ml-auto flex w-fit max-w-[85%] flex-col items-end">
              <div className="select-text whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-soft px-3.5 py-2 text-sm">{m.texto}</div>
              <Fila className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <Copiar texto={m.texto} onCopiar={onCopiar} etiqueta="Copiar mensaje" />
                <button type="button" aria-label="Editar mensaje" title="Editar mensaje" onClick={() => onEditar(m.id)} className={ACCION}>
                  <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </Fila>
            </li>
          );
        }
        const pensando = m.estado === 'transmitiendo' && !m.texto;
        return (
          <li key={m.id} aria-busy={m.estado === 'transmitiendo' || undefined}>
            {pensando && <PuntosPensando />}
            {m.texto && <Markdown texto={m.texto} onNavegar={onNavegar} onCopiar={onCopiar} />}
            {m.estado === 'error' && m.error && (
              <div className={cx('select-text', m.texto ? 'mt-2' : undefined)}>
                <Alert tone="bad">{m.error.mensaje}</Alert>
                {i === ultimo && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.error.causa === 'modelo' ? (
                      <>
                        <Button variant="secondary" size="sm" className="min-h-11" icon={<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />} disabled={ocupado} onClick={onReintentarConAuto}>Reintentar con Auto</Button>
                        {!autoYaGuardado && <Button variant="ghost" size="sm" className="min-h-11" disabled={ocupado} onClick={onUsarAutoSiempre}>Usar Auto siempre</Button>}
                      </>
                    ) : (
                      <Button variant="secondary" size="sm" className="min-h-11" icon={<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />} disabled={ocupado} onClick={onRegenerar}>Reintentar</Button>
                    )}
                  </div>
                )}
              </div>
            )}
            {m.estado !== 'transmitiendo' && m.texto && (
              <Fila>
                <Copiar texto={m.texto} onCopiar={onCopiar} etiqueta="Copiar respuesta" />
                {puedeRegenerar(mensajes, i, ocupado) && m.estado === 'ok' && (
                  <button type="button" aria-label="Regenerar respuesta" title="Regenerar respuesta" onClick={onRegenerar} className={ACCION}>
                    <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                {m.modo === 'contingencia' && <span>Respuesta sin IA</span>}
                {verMetricas && m.modelo && <span className="num">{m.modelo}{m.latencia_ms != null ? ` · ${segundos(m.latencia_ms)}` : ''}</span>}
              </Fila>
            )}
          </li>
        );
      })}
    </ol>
  );
}
