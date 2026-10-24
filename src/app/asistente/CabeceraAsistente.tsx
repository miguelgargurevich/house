import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AdjustmentsHorizontalIcon, ArrowDownTrayIcon, ArrowLeftIcon, ChatBubbleLeftRightIcon, PencilSquareIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { cx } from '../../ui';
import { AjustesMenu } from './AjustesMenu';
import { NOMBRE_PRESET } from './ajustes';
import type { Ajustes, OpcionesChat } from './tipos';

/** Botón de icono de 44 px (el alto de la cabecera): objetivo táctil completo. */
function Boton({ label, onClick, children, className, ...rest }: { label: string; onClick: () => void; children: ReactNode; className?: string; 'aria-pressed'?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cx('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted lg:w-10 transition-colors duration-150 hover:bg-surface2 hover:text-ink', className)} {...rest}>
      {children}
    </button>
  );
}

interface Props {
  vista: 'chat' | 'conversaciones';
  opciones: OpcionesChat | null;
  ajustes: Ajustes;
  onAjustes: (a: Ajustes) => void;
  onNueva: () => void;
  onHistorial: () => void;
  onVolverAlChat: () => void;
  /** Descarga la conversación como Markdown; sin función, no hay nada que exportar. */
  onExportar?: () => void;
  onCerrar: () => void;
}

/**
 * Cabecera de 44 px, esmerilada (superficie al 70 % + `backdrop-blur`): el hilo pasa por detrás. Título, «Auto/modelo · creatividad» (abre
 * los ajustes), nueva conversación, historial y cerrar. En el celular el primer botón es «Volver» (es una vista propia, no un velo).
 */
export function CabeceraAsistente({ vista, opciones, ajustes, onAjustes, onNueva, onHistorial, onVolverAlChat, onExportar, onCerrar }: Props) {
  const [menu, setMenu] = useState(false);
  const idMenu = useId();
  const disparador = useRef<HTMLButtonElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const enChat = vista === 'chat';

  // El menú se cierra con Esc (sin cerrar el panel: se frena en captura), con un clic fuera o al cambiar de vista.
  useEffect(() => {
    if (!menu) return;
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(false); disparador.current?.focus(); } };
    const fuera = (e: globalThis.PointerEvent) => { const t = e.target as Node; if (!caja.current?.contains(t) && !disparador.current?.contains(t)) setMenu(false); };
    window.addEventListener('keydown', esc, true);
    document.addEventListener('pointerdown', fuera);
    return () => { window.removeEventListener('keydown', esc, true); document.removeEventListener('pointerdown', fuera); };
  }, [menu]);
  useEffect(() => { if (!enChat) setMenu(false); }, [enChat]);

  const modelo = ajustes.modelo === 'auto' ? 'Auto' : (opciones?.modelos.find((m) => m.id === ajustes.modelo)?.nombre ?? 'Auto');
  const rotulo = opciones?.puede_elegir_modelo ? `${modelo} · ${NOMBRE_PRESET[ajustes.preset]}` : NOMBRE_PRESET[ajustes.preset];

  return (
    <header className="relative z-20 flex h-11 shrink-0 items-center gap-0.5 bg-surface/70 px-1.5 backdrop-blur-md">
      {enChat ? (
        <>
          <button type="button" onClick={onCerrar} className="inline-flex h-11 shrink-0 items-center gap-1 rounded px-2 text-sm font-medium text-muted transition-colors duration-150 hover:bg-surface2 hover:text-ink lg:hidden">
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" /> Volver
          </button>
          <h2 className="flex min-w-0 shrink-0 items-center gap-1.5 px-1.5 text-sm font-semibold max-lg:hidden"><SparklesIcon className="h-4 w-4 text-brand" aria-hidden="true" /> Asistente</h2>
          {opciones && (
            <button
              ref={disparador}
              type="button"
              aria-expanded={menu}
              aria-controls={idMenu}
              onClick={() => setMenu((v) => !v)}
              title="Modelo, creatividad y esfuerzo"
              className={cx('inline-flex h-11 min-w-0 items-center gap-1.5 rounded px-1.5 text-xs font-medium transition-colors duration-150 hover:bg-surface2', menu ? 'text-brand' : 'text-muted')}
            >
              <AdjustmentsHorizontalIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{rotulo}</span>
            </button>
          )}
        </>
      ) : (
        <>
          <Boton label="Volver al chat" onClick={onVolverAlChat}><ArrowLeftIcon className="h-5 w-5" aria-hidden="true" /></Boton>
          <h2 className="min-w-0 truncate px-1 text-sm font-semibold">Tus conversaciones</h2>
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center">
        {enChat && onExportar && <Boton label="Exportar conversación (Markdown)" onClick={onExportar}><ArrowDownTrayIcon className="h-5 w-5" aria-hidden="true" /></Boton>}
        {enChat && <Boton label="Ver conversaciones anteriores" onClick={onHistorial}><ChatBubbleLeftRightIcon className="h-5 w-5" aria-hidden="true" /></Boton>}
        <Boton label="Nueva conversación" onClick={onNueva}><PencilSquareIcon className="h-5 w-5" aria-hidden="true" /></Boton>
        <Boton label="Cerrar asistente" onClick={onCerrar} className="max-lg:hidden"><XMarkIcon className="h-5 w-5" aria-hidden="true" /></Boton>
      </div>
      {menu && opciones && enChat && (
        <div ref={caja} id={idMenu} role="group" aria-label="Ajustes del asistente" className="absolute inset-x-2 top-full mt-1 max-h-[min(70dvh,32rem)] overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-pop">
          <AjustesMenu opciones={opciones} ajustes={ajustes} onChange={onAjustes} />
        </div>
      )}
    </header>
  );
}
