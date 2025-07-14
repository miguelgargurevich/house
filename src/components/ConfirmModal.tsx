import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useRef } from 'react';

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmModal({ open, title = '¿Estás seguro?', description, confirmText = 'Confirmar', cancelText = 'Cancelar', onConfirm, onCancel, loading }: ConfirmModalProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500" />
          <span className="font-bold text-lg text-primary">{title}</span>
        </div>
        {description && <div className="text-gray-600 dark:text-gray-300 text-sm">{description}</div>}
        <div className="flex gap-2 justify-end mt-2">
          <button
            ref={cancelButtonRef}
            className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            className="px-4 py-2 rounded bg-primary text-white hover:bg-primary/90 focus:outline-none disabled:opacity-60"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Procesando...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
