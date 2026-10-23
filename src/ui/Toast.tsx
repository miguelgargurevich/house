import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

type ToastKind = 'ok' | 'error';
interface ToastItem { id: number; kind: ToastKind; text: string }
interface ToastApi { ok: (text: string) => void; error: (text: string) => void }

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems(s => [...s, { id, kind, text }]);
    setTimeout(() => setItems(s => s.filter(t => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const api = useMemo<ToastApi>(() => ({ ok: t => push('ok', t), error: t => push('error', t) }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-pop animate-[toast-in_200ms_cubic-bezier(0.22,1,0.36,1)]">
            {t.kind === 'ok'
              ? <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
              : <ExclamationCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-bad" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast fuera de ToastProvider');
  return c;
}
