import { useEffect } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/outline';
import { cx } from '../../ui';

interface Props {
  valor: string;
  onChange: (v: string) => void;
  onEnviar: () => void;
  onDetener: () => void;
  /** ↑ con el campo vacío: devuelve el último mensaje enviado (o `null`) para editarlo. */
  onRecuperar: () => string | null;
  ocupado: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

const MAX = 4000;

/** Pie SÓLIDO (sin blur) con el campo de texto: Enter envía; Mayús+Enter agrega una línea. Los ajustes viven en la cabecera. */
export function Compositor({ valor, onChange, onEnviar, onDetener, onRecuperar, ocupado, inputRef }: Props) {
  // Crece con el texto, hasta 6 líneas.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [valor, inputRef]);

  const enviar = (e: FormEvent) => { e.preventDefault(); if (!ocupado && valor.trim()) onEnviar(); };
  const teclas = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!ocupado && valor.trim()) onEnviar(); }
    else if (e.key === 'ArrowUp' && !valor && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
      const previo = onRecuperar();
      if (previo) { e.preventDefault(); onChange(previo); }
    }
  };

  return (
    <form onSubmit={enviar} className="relative z-10 shrink-0 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex items-end gap-1 rounded-xl border border-line bg-bg py-1 pl-3.5 pr-1 transition-colors duration-150 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/25">
        <textarea
          ref={inputRef}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={teclas}
          rows={1}
          maxLength={MAX}
          aria-label="Mensaje"
          placeholder="Escribe tu consulta…"
          enterKeyHint="send"
          className="max-h-36 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-sm placeholder:text-muted/70 focus:outline-none"
        />
        {ocupado ? (
          <button type="button" onClick={onDetener} aria-label="Detener" title="Detener" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink transition-colors duration-150 hover:bg-surface2">
            <StopIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" disabled={!valor.trim()} aria-label="Enviar" title="Enviar" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand transition-colors duration-150 hover:bg-brand-hover disabled:bg-transparent disabled:text-muted/60 disabled:pointer-events-none">
            <PaperAirplaneIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-1.5 flex items-center justify-between px-1 text-xs text-muted">
        <span>Enter envía · Mayús+Enter, línea nueva · ↑ último</span>
        <span className={cx('num', valor.length >= MAX * 0.9 && 'text-warn')} aria-hidden={valor.length < MAX * 0.9 || undefined}>{valor.length > 0 ? `${valor.length}/${MAX}` : ''}</span>
      </p>
    </form>
  );
}
