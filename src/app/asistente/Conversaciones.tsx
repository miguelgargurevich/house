import { useState } from 'react';
import { ChatBubbleLeftRightIcon, TrashIcon } from '@heroicons/react/24/outline';
import { ConfirmDialog, EmptyState, IconButton, Skeleton, cx } from '../../ui';
import type { ConversacionResumen } from './tipos';

const fecha = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

interface Props {
  lista: ConversacionResumen[] | null;
  activa: string | null;
  error: string | null;
  onAbrir: (id: string) => void;
  onBorrar: (id: string) => Promise<void>;
  onReintentar: () => void;
}

/** Las últimas conversaciones del usuario (hasta 20), con «Borrar» y confirmación. */
export function Conversaciones({ lista, activa, error, onAbrir, onBorrar, onReintentar }: Props) {
  const [borrar, setBorrar] = useState<ConversacionResumen | null>(null);
  const [borrando, setBorrando] = useState(false);

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

  return (
    <>
      <ul className="divide-y divide-line" aria-label="Tus conversaciones">
        {lista.map((c) => (
          <li key={c.id} className="flex items-center gap-1 pr-2">
            <button
              type="button"
              onClick={() => onAbrir(c.id)}
              aria-current={c.id === activa || undefined}
              className={cx('flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-2 text-left transition-colors duration-150 hover:bg-surface2', c.id === activa && 'bg-brand-soft')}
            >
              <span className="truncate text-sm font-medium">{c.titulo}</span>
              <span className="text-xs text-muted">{fecha.format(new Date(c.updated_at))}</span>
            </button>
            <IconButton label={`Borrar la conversación «${c.titulo}»`} onClick={() => setBorrar(c)}><TrashIcon className="h-4 w-4" aria-hidden="true" /></IconButton>
          </li>
        ))}
      </ul>
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
    </>
  );
}
