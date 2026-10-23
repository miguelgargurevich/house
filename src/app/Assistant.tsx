import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { PaperAirplaneIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../api';
import { Button, IconButton, Spinner } from '../ui';

interface Msg { role: 'user' | 'ai'; text: string }

export function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setMsgs(m => [...m, { role: 'user', text: t }]);
    setText('');
    setBusy(true);
    try {
      const r = await api<{ response?: string }>('/api/ai-chat', { method: 'POST', json: { message: t } });
      setMsgs(m => [...m, { role: 'ai', text: r.response || 'No tengo una respuesta para eso.' }]);
    } catch (err) {
      setMsgs(m => [...m, { role: 'ai', text: `No pude responder: ${errorText(err)}` }]);
    } finally { setBusy(false); }
  }

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/30 sm:hidden" onClick={onClose} aria-hidden="true" />
      <aside aria-label="Asistente de House" className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-pop sm:w-[24rem]">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><SparklesIcon className="h-5 w-5 text-brand" /> Asistente</h2>
          <IconButton label="Cerrar asistente" onClick={onClose}><XMarkIcon className="h-5 w-5" /></IconButton>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <p className="rounded-lg bg-surface2 p-4 text-sm text-muted">
              Pregúntame cómo emitir un recibo, qué significa un estado de pago o dónde ver tus deudas.
            </p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'ml-8 rounded-lg bg-brand-soft px-3 py-2 text-sm' : 'mr-8 rounded-lg border border-line px-3 py-2 text-sm [&_a]:text-brand [&_a]:underline [&_li]:ml-4 [&_li]:list-disc [&_p+p]:mt-2'}>
              {m.role === 'ai' ? <ReactMarkdown>{m.text}</ReactMarkdown> : m.text}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Pensando…</div>}
          <div ref={end} />
        </div>
        <form onSubmit={send} className="flex items-center gap-2 border-t border-line p-3">
          <input
            ref={input}
            value={text}
            onChange={e => setText(e.target.value)}
            aria-label="Mensaje"
            placeholder="Escribe tu consulta…"
            className="h-10 flex-1 rounded border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
          />
          <Button type="submit" disabled={!text.trim()} loading={busy} aria-label="Enviar" className="w-10 px-0"><PaperAirplaneIcon className="h-4 w-4" /></Button>
        </form>
      </aside>
    </>
  );
}
