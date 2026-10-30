import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button, IconButton } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

const FOCALIZABLE = 'input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';

/**
 * Diálogo nativo (<dialog>): foco atrapado, Esc y clic fuera cierran.
 * Al abrir, el foco va al primer control del contenido (o del pie) —no al botón «Cerrar»— salvo que un campo traiga `autoFocus`;
 * al cerrar, vuelve al elemento que lo abrió.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const previo = useRef<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      previo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.modalCerrar !== undefined) {
        const inicial = d.querySelector<HTMLElement>(`[data-modal-cuerpo] :is(${FOCALIZABLE}), [data-modal-pie] :is(${FOCALIZABLE})`);
        inicial?.focus();
      }
    }
    if (!open) {
      if (d.open) d.close();
      const volver = previo.current;
      previo.current = null;
      if (volver?.isConnected) volver.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      // React propaga el close por el árbol: sin el chequeo, cerrar un modal abierto dentro de otro (la foto del contómetro) cerraba los dos.
      onClose={e => { if (e.target === e.currentTarget) onClose(); }}
      onClick={e => { if (e.target === ref.current) onClose(); }}
      aria-labelledby={`${id}-titulo`}
      aria-describedby={description ? `${id}-desc` : undefined}
      // El <dialog> nunca se desplaza: sólo el cuerpo. Con `vh` (o sin `overflow-hidden`) en WebKit el diálogo crecía más que la pantalla,
      // se desplazaba entero y el pie quedaba a media altura con un hueco debajo. `dvh` es la altura visible real.
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-hidden ${widths[size]} rounded-xl border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-transparent open:animate-[dialog-in_180ms_cubic-bezier(0.22,1,0.36,1)]`}
    >
      {open && (
        <div className="flex max-h-[min(85dvh,calc(100dvh-2rem))] flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5">
            <div>
              <h2 id={`${id}-titulo`} className="text-lg font-semibold">{title}</h2>
              {description && <p id={`${id}-desc`} className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <IconButton label="Cerrar" data-modal-cerrar="" onClick={onClose} className="-mr-2 -mt-1"><XMarkIcon className="h-5 w-5" /></IconButton>
          </div>
          <div data-modal-cuerpo="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
          {footer && <div data-modal-pie="" className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirmar', danger, loading }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={() => void onConfirm()}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}
