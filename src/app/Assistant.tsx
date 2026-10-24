import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { esJunta } from '../auth/junta';
import { useAuth } from '../auth/AuthContext';
import { cx, useToast } from '../ui';
import { exportarMarkdown, nombreArchivoDe, ultimoEnviado } from './asistente/acciones';
import { AsaDeAncho } from './asistente/AsaDeAncho';
import { CabeceraAsistente } from './asistente/CabeceraAsistente';
import { Compositor } from './asistente/Compositor';
import { Conversaciones } from './asistente/Conversaciones';
import { Mensajes } from './asistente/Mensajes';
import { estaAlFinal } from './asistente/scroll';
import { SUGERENCIAS, SUGERENCIA_JUNTA } from './asistente/sugerencias';
import { useAnchoPanel } from './asistente/useDock';
import { useAsistente } from './asistente/useAsistente';

const FOCALIZABLE = 'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

/** El hilo sube POR DETRÁS de la cabecera (44 px) y se desvanece 1 rem bajo ella; abajo termina limpio, donde empieza el pie. */
const HILO = '-mt-11 pb-4 pt-[calc(44px_+_1rem)] scroll-pt-[calc(44px_+_1rem)] scroll-pb-4 [mask-image:linear-gradient(to_bottom,transparent_44px,#000_calc(44px_+_1rem))]';

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

/**
 * Panel del asistente. En escritorio (>= lg) es una COLUMNA del layout, a la derecha del contenido (que se reduce): ancho redimensionable
 * y se anima con el ancho. En el celular (< lg) es una vista propia a pantalla completa con «Volver». Siempre montado: la conversación
 * no se pierde al navegar ni al cerrar.
 */
export function Assistant({ open, onClose, escritorio, barra }: { open: boolean; onClose: () => void; escritorio: boolean; barra: number }) {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const visible = useAltoVisible(open && !escritorio);
  const { ancho, mover, confirmar, restablecer } = useAnchoPanel(user?.id ?? 0, barra);
  const a = useAsistente(user?.id ?? 0, pathname, open);
  const [vista, setVista] = useState<'chat' | 'conversaciones'>('chat');
  const [arrastrando, setArrastrando] = useState(false);

  const panel = useRef<HTMLElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const siguiendo = useRef(true);
  const abiertoAntes = useRef(open);

  // Foco: al abrir va al campo de texto; al cerrar vuelve a quien abrió el panel (si el foco se había quedado en el panel).
  // En el primer render (panel recordado como abierto) no se roba el foco de la página.
  useEffect(() => {
    if (abiertoAntes.current === open) return; // primer render (también el doble efecto de StrictMode): no hay transición
    abiertoAntes.current = open;
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement && !panel.current?.contains(document.activeElement) ? document.activeElement : null;
      siguiendo.current = true;
      input.current?.focus({ preventScroll: true });
    } else if (opener.current) {
      const volver = opener.current;
      opener.current = null;
      const ac = document.activeElement;
      if (volver.isConnected && (!ac || ac === document.body || panel.current?.contains(ac))) volver.focus();
    }
  }, [open]);

  // El texto nuevo arrastra la vista sólo si la persona ya estaba al final: no se pelea con quien subió a leer.
  useEffect(() => {
    const el = area.current;
    if (el && siguiendo.current) el.scrollTop = el.scrollHeight;
  }, [a.mensajes, a.fase, vista, open]);

  const navegar = useCallback((ruta: string) => { nav(ruta); if (!escritorio) onClose(); }, [nav, escritorio, onClose]);
  const copiar = useCallback(async (t: string) => {
    try { await navigator.clipboard.writeText(t); return true; }
    catch { toast.error('No se pudo copiar. Selecciona el texto y cópialo a mano.'); return false; }
  }, [toast]);

  /** Foco al campo con el cursor al final (tras editar, regenerar o reintentar). */
  const enfocarCampo = useCallback(() => {
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, []);
  const editar = (id: string) => {
    siguiendo.current = true;
    a.editar(id).then((ok) => { if (ok) enfocarCampo(); }).catch(() => toast.error('No se pudo volver a ese mensaje. Inténtalo de nuevo.'));
  };
  const regenerar = (opts?: { auto?: boolean }) => {
    siguiendo.current = true;
    a.regenerar(opts).then((ok) => { if (ok) enfocarCampo(); }).catch(() => toast.error('No se pudo regenerar la respuesta. Inténtalo de nuevo.'));
  };
  const exportar = () => {
    const ahora = new Date();
    const titulo = a.lista?.find((c) => c.id === a.conversacionId)?.titulo ?? a.mensajes.find((m) => m.rol === 'user')?.texto.slice(0, 60) ?? 'Conversación';
    const url = URL.createObjectURL(new Blob([exportarMarkdown(titulo, a.mensajes, ahora)], { type: 'text/markdown;charset=utf-8' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivoDe(titulo, ahora);
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.ok('Conversación exportada');
  };

  // Esc (con el foco dentro del panel): si hay una respuesta en curso la detiene; si no, cierra; si hay un diálogo de confirmación abierto, Esc es para él; el menú de ajustes lo frena antes.
  // El foco se atrapa sólo en el celular (ahí es una vista a pantalla completa); en escritorio el panel convive con la página.
  const teclas = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {
      if (a.ocupado) { e.preventDefault(); a.detener(); input.current?.focus(); } else onClose();
      return;
    }
    if (escritorio || e.key !== 'Tab' || !panel.current) return;
    const lista = [...panel.current.querySelectorAll<HTMLElement>(FOCALIZABLE)].filter((x) => x.offsetParent !== null);
    if (!lista.length) return;
    const primero = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };

  if (!user) return null;
  const chips = [...(esJunta(user) ? [SUGERENCIA_JUNTA] : []), ...SUGERENCIAS[user.rol]].filter((t, i, l) => l.indexOf(t) === i).slice(0, 4);
  const enChat = vista === 'chat';
  const estilo = {
    '--ancho': `${open ? ancho : 0}px`,
    '--ancho-fijo': `${ancho}px`,
    ...(!escritorio && visible ? { height: visible.height, top: visible.top, bottom: 'auto' } : {}),
  } as CSSProperties;

  return (
    <aside
      ref={panel}
      role="complementary"
      aria-label="Asistente de House"
      inert={!open}
      onKeyDown={teclas}
      style={estilo}
      className={cx(
        open ? 'fixed inset-0 z-50 h-dvh' : 'hidden',
        'lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-0 lg:z-20 lg:block lg:h-dvh lg:w-[var(--ancho)] lg:shrink-0 lg:overflow-hidden',
        !arrastrando && 'lg:transition-[width] lg:duration-200 lg:ease-out',
      )}
    >
      <div className="relative flex h-full w-full flex-col bg-surface lg:w-[var(--ancho-fijo)] lg:border-l lg:border-line">
        {open && <AsaDeAncho ancho={ancho} onMover={mover} onConfirmar={confirmar} onRestablecer={restablecer} onArrastrando={setArrastrando} />}

        <CabeceraAsistente
          vista={vista}
          opciones={a.opciones}
          ajustes={a.ajustes}
          onAjustes={a.setAjustes}
          onNueva={() => { a.nueva(); setVista('chat'); siguiendo.current = true; input.current?.focus(); }}
          onHistorial={() => { void a.cargarLista(); setVista('conversaciones'); }}
          onVolverAlChat={() => setVista('chat')}
          onExportar={a.mensajes.some((m) => m.texto.trim()) ? exportar : undefined}
          onCerrar={onClose}
        />

        <div
          ref={area}
          onScroll={(e) => { siguiendo.current = estaAlFinal(e.currentTarget); }}
          className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', HILO)}
        >
          {enChat ? (
            <div aria-live="polite" aria-busy={a.ocupado} aria-relevant="additions text">
              {a.mensajes.length === 0 ? (
                <div className="mx-auto w-full max-w-2xl px-4 pt-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand"><SparklesIcon className="h-5 w-5" aria-hidden="true" /></span>
                  <p className="mt-3 text-lg font-semibold">Hola, {user.nombre.split(/\s+/)[0]}</p>
                  <p className="mt-1 text-sm text-muted">Pregúntame cómo usar House o por tu cuenta: tus recibos, tus pagos o dónde hacer algo.</p>
                  <ul className="mt-5 space-y-2" aria-label="Preguntas sugeridas">
                    {chips.map((t) => (
                      <li key={t}>
                        <button type="button" onClick={() => { siguiendo.current = true; a.enviarTexto(t); }} disabled={a.ocupado} className="min-h-11 w-full rounded-lg border border-line bg-surface px-3.5 py-2 text-left text-sm font-medium transition-colors duration-150 hover:bg-surface2 disabled:opacity-50">{t}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Mensajes mensajes={a.mensajes} verMetricas={user.rol === 'superadmin'} ocupado={a.ocupado} onNavegar={navegar} onCopiar={copiar} onEditar={editar} onRegenerar={() => regenerar()} onReintentarConAuto={() => regenerar({ auto: true })} onUsarAutoSiempre={() => { a.usarAutoSiempre(); toast.ok('Listo: usaré Auto en tus próximas consultas'); }} autoYaGuardado={a.ajustes.modelo === 'auto'} />
              )}
            </div>
          ) : (
            <Conversaciones
              lista={a.lista}
              activa={a.conversacionId}
              error={a.errorLista}
              onReintentar={() => void a.cargarLista()}
              onAbrir={(id) => { void a.abrir(id).then((ok) => { if (ok) { siguiendo.current = true; setVista('chat'); } else toast.error('No se pudo abrir la conversación.'); }); }}
              onRenombrar={a.renombrar}
              onBorrar={async (id) => { try { await a.borrar(id); toast.ok('Conversación borrada'); } catch { toast.error('No se pudo borrar la conversación.'); throw new Error('borrar'); } }}
            />
          )}
        </div>

        {enChat && (
          <Compositor
            valor={a.texto}
            onChange={a.setTexto}
            onEnviar={() => { siguiendo.current = true; a.enviar(); }}
            onDetener={a.detener}
            onRecuperar={() => ultimoEnviado(a.mensajes)}
            ocupado={a.ocupado}
            inputRef={input}
          />
        )}
      </div>
    </aside>
  );
}
