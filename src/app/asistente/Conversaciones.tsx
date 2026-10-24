import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChatBubbleLeftRightIcon, MagnifyingGlassIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { ConfirmDialog, EmptyState, IconButton, Skeleton, cx } from '../../ui';
import { TITULO_MAX, filtrarConversaciones, validarTitulo } from './acciones';
import type { ConversacionResumen } from './tipos';

const fecha = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

interface Props {
  lista: ConversacionResumen[] | null;
  activa: string | null;
  error: string | null;
  onAbrir: (id: string) => void;
  onBorrar: (id: string) => Promise<void>;
  /** Lanza si el servidor la rechaza. */
  onRenombrar: (id: string, titulo: string) => Promise<void>;
  onReintentar: () => void;
}

/** Título editable en la propia fila: Enter guarda, Esc cancela (sin cerrar el panel), clic fuera guarda. */
function Renombrar({ c, onGuardar, onCancelar }: { c: ConversacionResumen; onGuardar: (titulo: string) => Promise<void>; onCancelar: () => void }) {
  const [valor, setValor] = useState(c.titulo);
  const [problema, setProblema] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const terminado = useRef(false);
  useEffect(() => { campo.current?.focus(); campo.current?.select(); }, []);

  const guardar = async () => {
    if (terminado.current || guardando) return;
    if (valor.trim() === c.titulo) { terminado.current = true; onCancelar(); return; }
    const v = validarTitulo(valor);
    if (!v.ok) { setProblema(v.motivo); campo.current?.focus(); return; }
    setGuardando(true);
    try { await onGuardar(v.titulo); terminado.current = true; }
    catch { setProblema('No se pudo guardar el título. Inténtalo de nuevo.'); setGuardando(false); campo.current?.focus(); }
  };
  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void guardar(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); terminado.current = true; onCancelar(); }
  };

  return (
    <div className="min-h-14 min-w-0 flex-1 px-4 py-2">
      <input
        ref={campo}
        value={valor}
        onChange={(e) => { setValor(e.target.value); setProblema(null); }}
        onKeyDown={teclas}
        onBlur={() => void guardar()}
        maxLength={TITULO_MAX + 20}
        disabled={guardando}
        aria-label="Título de la conversación"
        aria-invalid={problema ? true : undefined}
        aria-describedby={problema ? `err-${c.id}` : undefined}
        className="h-9 w-full rounded border border-line bg-bg px-2 text-sm font-medium focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
      />
      {problema ? <p id={`err-${c.id}`} role="alert" className="mt-1 text-xs text-bad">{problema}</p> : <p className="mt-1 text-xs text-muted">Enter guarda · Esc cancela</p>}
    </div>
  );
}

/** Las últimas conversaciones del usuario (hasta 20): buscar por título, renombrar en la fila y «Borrar» con confirmación. */
export function Conversaciones({ lista, activa, error, onAbrir, onBorrar, onRenombrar, onReintentar }: Props) {
  const [borrar, setBorrar] = useState<ConversacionResumen | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [consulta, setConsulta] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const volverAlLapiz = (id: string) => requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(`[data-renombrar="${id}"]`)?.focus());

  if (error) {
    return (
      <div role="alert" className="p-4 text-sm">
        <p className="text-bad">{error}</p>
        <button type="button" onClick={onReintentar} className="mt-2 h-10 rounded px-2 font-medium text-brand hover:bg-surface2">Reintentar</button>
      </div>
    );
  }
  if (lista === null) {
    return <div className="space-y-2 p-4" aria-busy="true" aria-label="Cargando conversaciones">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (lista.length === 0) {
    return <EmptyState icon={<ChatBubbleLeftRightIcon />} title="Todavía no tienes conversaciones" description="Cuando escribas al asistente, tus últimas conversaciones aparecerán aquí." />;
  }

  const visibles = filtrarConversaciones(lista, consulta);

  return (
    <div ref={raiz}>
      <div className="px-4 pb-2">
        <label className="relative block">
          <span className="sr-only">Buscar en tus conversaciones por título</span>
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && consulta) { e.preventDefault(); e.stopPropagation(); setConsulta(''); } }}
            placeholder="Buscar por título…"
            autoComplete="off"
            className="h-11 w-full rounded-lg border border-line bg-bg pl-9 pr-3 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
          />
        </label>
      </div>
      {visibles.length === 0 ? (
        <p role="status" className="px-4 py-6 text-center text-sm text-muted">Ninguna conversación coincide con «{consulta.trim()}».</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Tus conversaciones">
          {visibles.map((c) => (
            <li key={c.id} className="flex items-center gap-1 pr-2">
              {editando === c.id ? (
                <Renombrar
                  c={c}
                  onGuardar={async (t) => { await onRenombrar(c.id, t); setEditando(null); volverAlLapiz(c.id); }}
                  onCancelar={() => { setEditando(null); volverAlLapiz(c.id); }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onAbrir(c.id)}
                    aria-current={c.id === activa || undefined}
                    className={cx('flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-2 text-left transition-colors duration-150 hover:bg-surface2', c.id === activa && 'bg-brand-soft')}
                  >
                    <span className="truncate text-sm font-medium">{c.titulo}</span>
                    <span className="text-xs text-muted">{fecha.format(new Date(c.updated_at))}</span>
                  </button>
                  <IconButton
                    data-renombrar={c.id}
                    className="h-11 w-11"
                    label={`Renombrar la conversación «${c.titulo}»`}
                    onClick={() => setEditando(c.id)}
                  ><PencilIcon className="h-4 w-4" aria-hidden="true" /></IconButton>
                  <IconButton className="h-11 w-11" label={`Borrar la conversación «${c.titulo}»`} onClick={() => setBorrar(c)}><TrashIcon className="h-4 w-4" aria-hidden="true" /></IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        loading={borrando}
        danger
        title="Borrar conversación"
        message={`Se borrará «${borrar?.titulo ?? ''}» con todos sus mensajes. No se puede deshacer.`}
        confirmLabel="Borrar"
        onConfirm={async () => {
          if (!borrar) return;
          setBorrando(true);
          try { await onBorrar(borrar.id); setBorrar(null); } finally { setBorrando(false); }
        }}
      />
    </div>
  );
}
