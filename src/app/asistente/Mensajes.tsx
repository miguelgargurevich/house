import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowPathIcon, ArrowUturnLeftIcon, CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
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

// Disposición como el chat de Agentes de My Workspace (24-oct, Miguel): en el mensaje propio, «Reescribir» a la IZQUIERDA de la burbuja y
// «Copiar» flotando en su esquina superior derecha; bajo la respuesta, UNA fila compacta. Sin filas extra entre mensajes.
// Se ven al pasar el ratón o al enfocar con el teclado; en pantallas táctiles (sin hover), siempre.
const AL_PASAR = 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';
/** Icono compacto (28 px) con objetivo táctil de 44 px: el `before` invisible agranda la zona que recibe el toque. */
const ACCION = 'relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted transition-colors duration-150 before:absolute before:-inset-2 before:content-[""] hover:bg-surface2 hover:text-ink focus-visible:bg-surface2 disabled:opacity-50';
/** Copiar flotante sobre la esquina de la burbuja (como MW). */
const FLOTANTE = 'absolute -right-2 -top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors duration-150 before:absolute before:-inset-2 before:content-[""] hover:text-ink';

function Copiar({ texto, onCopiar, etiqueta, className = ACCION }: { texto: string; onCopiar: (t: string) => Promise<boolean>; etiqueta: string; className?: string }) {
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
      className={className}
    >
      {copiado ? <CheckIcon className="h-3.5 w-3.5 text-ok" aria-hidden="true" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}

function Fila({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mt-1 flex h-7 items-center gap-1 text-xs text-muted', className)}>{children}</div>;
}

export function Mensajes({ mensajes, verMetricas, onNavegar, onCopiar, onEditar, onRegenerar, onReintentarConAuto, onUsarAutoSiempre, autoYaGuardado, ocupado }: Props) {
  const ultimo = mensajes.length - 1;
  return (
    <ol className="mx-auto w-full max-w-2xl space-y-4 px-4" aria-label="Conversación">
      {mensajes.map((m, i) => {
        if (m.rol === 'user') {
          return (
            <li key={m.id} className="group flex items-center justify-end gap-1.5">
              <button type="button" aria-label="Reescribir mensaje" title="Reescribir mensaje" onClick={() => onEditar(m.id)} className={cx(ACCION, AL_PASAR)}>
                <ArrowUturnLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <div className="relative max-w-[85%]">
                <div className="select-text whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-soft px-3.5 py-2 text-sm">{m.texto}</div>
                <Copiar texto={m.texto} onCopiar={onCopiar} etiqueta="Copiar mensaje" className={cx(FLOTANTE, AL_PASAR)} />
              </div>
            </li>
          );
        }
        const pensando = m.estado === 'transmitiendo' && !m.texto;
        return (
          <li key={m.id} className="group" aria-busy={m.estado === 'transmitiendo' || undefined}>
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
              <Fila className="justify-between">
                <span className="flex min-w-0 items-center gap-2 truncate">
                  {m.modo === 'contingencia' && <span>Respuesta sin IA</span>}
                  {verMetricas && m.modelo && <span className={cx('num truncate', AL_PASAR)}>{m.modelo}{m.latencia_ms != null ? ` · ${segundos(m.latencia_ms)}` : ''}</span>}
                </span>
                <span className={cx('flex items-center gap-0.5', AL_PASAR)}>
                  {puedeRegenerar(mensajes, i, ocupado) && m.estado === 'ok' && (
                    <button type="button" aria-label="Regenerar respuesta" title="Regenerar respuesta" onClick={onRegenerar} className={ACCION}>
                      <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <Copiar texto={m.texto} onCopiar={onCopiar} etiqueta="Copiar respuesta" />
                </span>
              </Fila>
            )}
          </li>
        );
      })}
    </ol>
  );
}
