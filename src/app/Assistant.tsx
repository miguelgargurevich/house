import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ChatBubbleLeftRightIcon, PencilSquareIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { esJunta } from '../auth/junta';
import { useAuth } from '../auth/AuthContext';
import { IconButton, useToast } from '../ui';
import { Compositor } from './asistente/Compositor';
import { Conversaciones } from './asistente/Conversaciones';
import { Mensajes } from './asistente/Mensajes';
import { estaAlFinal } from './asistente/scroll';
import { SUGERENCIAS, SUGERENCIA_JUNTA } from './asistente/sugerencias';
import { useAsistente } from './asistente/useAsistente';

const MOVIL = '(max-width: 639px)';
const FOCALIZABLE = 'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

function useMovil(): boolean {
  const [movil, setMovil] = useState(() => window.matchMedia(MOVIL).matches);
  useEffect(() => {
    const q = window.matchMedia(MOVIL);
    const h = () => setMovil(q.matches);
    q.addEventListener('change', h);
    return () => q.removeEventListener('change', h);
  }, []);
  return movil;
}

/** Alto realmente visible (descuenta el teclado del celular): así el campo de texto nunca queda tapado. */
function useAltoVisible(activo: boolean): { height: number; top: number } | null {
  const [v, setV] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!activo || !vv) { setV(null); return; }
    const h = () => setV({ height: vv.height, top: vv.offsetTop });
    h();
    vv.addEventListener('resize', h);
    vv.addEventListener('scroll', h);
    return () => { vv.removeEventListener('resize', h); vv.removeEventListener('scroll', h); };
  }, [activo]);
  return v;
}

/** Panel del asistente: pantalla completa en el celular (diálogo modal), lateral en escritorio. */
export function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const movil = useMovil();
  const visible = useAltoVisible(open && movil);
  const a = useAsistente(user?.id ?? 0, pathname, open);
  const [vista, setVista] = useState<'chat' | 'conversaciones'>('chat');
  const [anuncio, setAnuncio] = useState('');

  const panel = useRef<HTMLElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const siguiendo = useRef(true);

  // Foco: al abrir va al campo de texto; al cerrar vuelve a quien abrió el panel.
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      siguiendo.current = true;
      input.current?.focus();
    } else if (opener.current) {
      const volver = opener.current;
      opener.current = null;
      if (volver.isConnected) volver.focus();
    }
  }, [open]);

  // Esc cierra (si hay un diálogo de confirmación abierto, Esc es para él; el menú de ajustes lo maneja el compositor).
  useEffect(() => {
    if (!open) return;
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  // El texto nuevo arrastra la vista sólo si la persona ya estaba al final: no se pelea con quien subió a leer.
  useEffect(() => {
    const el = area.current;
    if (el && siguiendo.current) el.scrollTop = el.scrollHeight;
  }, [a.mensajes, a.fase, vista]);

  // Lectores de pantalla: se anuncia una vez cuando termina la respuesta (no cada fragmento).
  const ocupadoAntes = useRef(false);
  useEffect(() => {
    if (ocupadoAntes.current && !a.ocupado) setAnuncio(a.mensajes.at(-1)?.estado === 'error' ? 'No se pudo completar la respuesta.' : 'El asistente respondió.');
    if (a.ocupado) setAnuncio('');
    ocupadoAntes.current = a.ocupado;
  }, [a.ocupado, a.mensajes]);

  const navegar = useCallback((ruta: string) => { nav(ruta); if (movil) onClose(); }, [nav, movil, onClose]);
  const copiar = useCallback(async (t: string) => {
    try { await navigator.clipboard.writeText(t); return true; }
    catch { toast.error('No se pudo copiar. Selecciona el texto y cópialo a mano.'); return false; }
  }, [toast]);

  // Foco atrapado sólo en el celular (ahí es un diálogo modal); en escritorio el panel convive con la página.
  const atrapar = (e: KeyboardEvent<HTMLElement>) => {
    if (!movil || e.key !== 'Tab' || !panel.current) return;
    const lista = [...panel.current.querySelectorAll<HTMLElement>(FOCALIZABLE)].filter((x) => x.offsetParent !== null);
    if (!lista.length) return;
    const primero = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };

  if (!open || !user) return null;
  const chips = [...(esJunta(user) ? [SUGERENCIA_JUNTA] : []), ...SUGERENCIAS[user.rol]].filter((t, i, l) => l.indexOf(t) === i).slice(0, 4);
  const enChat = vista === 'chat';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/30 sm:hidden" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panel}
        role="dialog"
        aria-modal={movil}
        aria-label="Asistente de House"
        onKeyDown={atrapar}
        style={movil && visible ? { height: visible.height, top: visible.top, bottom: 'auto' } : undefined}
        className="fixed inset-x-0 bottom-0 top-0 z-50 flex h-dvh flex-col bg-surface sm:inset-x-auto sm:right-0 sm:w-[26rem] sm:border-l sm:border-line sm:shadow-pop"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-1 border-b border-line px-3">
          {enChat ? (
            <h2 className="flex items-center gap-2 px-1 text-sm font-semibold"><SparklesIcon className="h-5 w-5 text-brand" aria-hidden="true" /> Asistente</h2>
          ) : (
            <div className="flex items-center gap-1">
              <IconButton label="Volver al chat" onClick={() => setVista('chat')}><ArrowLeftIcon className="h-5 w-5" aria-hidden="true" /></IconButton>
              <h2 className="text-sm font-semibold">Tus conversaciones</h2>
            </div>
          )}
          <div className="flex items-center">
            {enChat && <IconButton label="Ver conversaciones anteriores" onClick={() => { void a.cargarLista(); setVista('conversaciones'); }}><ChatBubbleLeftRightIcon className="h-5 w-5" aria-hidden="true" /></IconButton>}
            <IconButton label="Nueva conversación" onClick={() => { a.nueva(); setVista('chat'); siguiendo.current = true; input.current?.focus(); }}><PencilSquareIcon className="h-5 w-5" aria-hidden="true" /></IconButton>
            <IconButton label="Cerrar asistente" onClick={onClose}><XMarkIcon className="h-5 w-5" aria-hidden="true" /></IconButton>
          </div>
        </header>

        <div
          ref={area}
          onScroll={(e) => { siguiendo.current = estaAlFinal(e.currentTarget); }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {enChat ? (
            <div className="p-4">
              {a.mensajes.length === 0 ? (
                <div className="space-y-4">
                  <p className="rounded-lg bg-surface2 p-4 text-sm text-muted">Hola, {user.nombre.split(/\s+/)[0]}. Pregúntame cómo usar House o por tu cuenta: tus recibos, tus pagos o dónde hacer algo.</p>
                  <ul className="flex flex-wrap gap-2" aria-label="Preguntas sugeridas">
                    {chips.map((t) => (
                      <li key={t}>
                        <button type="button" onClick={() => { siguiendo.current = true; a.enviarTexto(t); }} disabled={a.ocupado} className="min-h-10 rounded-full border border-line bg-surface px-3.5 py-2 text-left text-sm font-medium transition-colors duration-150 hover:bg-surface2 disabled:opacity-50">{t}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Mensajes mensajes={a.mensajes} verMetricas={user.rol === 'superadmin'} ocupado={a.ocupado} onReintentar={a.reintentar} onNavegar={navegar} onCopiar={copiar} />
              )}
            </div>
          ) : (
            <Conversaciones
              lista={a.lista}
              activa={a.conversacionId}
              error={a.errorLista}
              onReintentar={() => void a.cargarLista()}
              onAbrir={(id) => { void a.abrir(id).then((ok) => { if (ok) { siguiendo.current = true; setVista('chat'); } else toast.error('No se pudo abrir la conversación.'); }); }}
              onBorrar={async (id) => { try { await a.borrar(id); toast.ok('Conversación borrada'); } catch { toast.error('No se pudo borrar la conversación.'); throw new Error('borrar'); } }}
            />
          )}
        </div>
        <p role="status" aria-live="polite" className="sr-only">{anuncio}</p>

        {enChat && (
          <Compositor
            valor={a.texto}
            onChange={a.setTexto}
            onEnviar={() => { siguiendo.current = true; a.enviar(); }}
            onDetener={a.detener}
            ocupado={a.ocupado}
            opciones={a.opciones}
            ajustes={a.ajustes}
            onAjustes={a.setAjustes}
            inputRef={input}
          />
        )}
      </aside>
    </>
  );
}
