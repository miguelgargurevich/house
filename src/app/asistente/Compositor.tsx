import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { AdjustmentsHorizontalIcon, PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/outline';
import { Button, cx } from '../../ui';
import { AjustesMenu } from './AjustesMenu';
import { NOMBRE_PRESET } from './ajustes';
import type { Ajustes, OpcionesChat } from './tipos';

interface Props {
  valor: string;
  onChange: (v: string) => void;
  onEnviar: () => void;
  onDetener: () => void;
  ocupado: boolean;
  opciones: OpcionesChat | null;
  ajustes: Ajustes;
  onAjustes: (a: Ajustes) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** Campo de texto + «Ajustes» + Enviar/Detener. Enter envía; Mayús+Enter agrega una línea. */
export function Compositor({ valor, onChange, onEnviar, onDetener, ocupado, opciones, ajustes, onAjustes, inputRef }: Props) {
  const [menu, setMenu] = useState(false);
  const botonAjustes = useRef<HTMLButtonElement>(null);

  // Crece con el texto, hasta 5 líneas.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [valor, inputRef]);

  // Esc cierra primero el menú (no el panel entero).
  useEffect(() => {
    if (!menu) return;
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(false); botonAjustes.current?.focus(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [menu]);

  const enviar = (e: FormEvent) => { e.preventDefault(); if (!ocupado && valor.trim()) onEnviar(); };
  const teclas = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!ocupado && valor.trim()) onEnviar(); }
  };

  return (
    <form onSubmit={enviar} className="relative border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {menu && opciones && (
        <div id="asistente-ajustes" role="group" aria-label="Ajustes del asistente" className="absolute inset-x-3 bottom-full mb-2 max-h-[min(70dvh,32rem)] overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-pop">
          <AjustesMenu opciones={opciones} ajustes={ajustes} onChange={onAjustes} />
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={teclas}
          rows={1}
          maxLength={4000}
          aria-label="Mensaje"
          placeholder="Escribe tu consulta…"
          enterKeyHint="send"
          className="max-h-32 min-h-10 flex-1 resize-none rounded border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
        />
        {ocupado ? (
          <Button variant="secondary" onClick={onDetener} icon={<StopIcon className="h-4 w-4" aria-hidden="true" />} className="min-w-10">Detener</Button>
        ) : (
          <Button type="submit" disabled={!valor.trim()} aria-label="Enviar" className="w-10 px-0"><PaperAirplaneIcon className="h-4 w-4" aria-hidden="true" /></Button>
        )}
      </div>
      {opciones && (
        <button
          ref={botonAjustes}
          type="button"
          aria-expanded={menu}
          aria-controls="asistente-ajustes"
          onClick={() => setMenu((v) => !v)}
          className={cx('mt-1.5 inline-flex h-10 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors duration-150 hover:bg-surface2', menu ? 'text-brand' : 'text-muted')}
        >
          <AdjustmentsHorizontalIcon className="h-4 w-4" aria-hidden="true" />
          Ajustes · {NOMBRE_PRESET[ajustes.preset]}
        </button>
      )}
    </form>
  );
}
