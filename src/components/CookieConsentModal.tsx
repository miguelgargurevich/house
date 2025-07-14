import { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface CookieConsentModalProps {
  message?: string;
  acceptText?: string;
  declineText?: string;
  onAccept?: () => void;
  onDecline?: () => void;
}

const STORAGE_KEY = 'cookie_consent_accepted';

export default function CookieConsentModal({
  message = 'Este sitio utiliza cookies para mejorar tu experiencia. ¿Aceptas el uso de cookies?',
  acceptText = 'Aceptar',
  declineText = 'Rechazar',
  onAccept,
  onDecline,
}: CookieConsentModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem(STORAGE_KEY);
    if (!accepted) setOpen(true);
  }, []);

  function handleAccept() {
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
    onAccept?.();
  }

  function handleDecline() {
    localStorage.setItem(STORAGE_KEY, 'false');
    setOpen(false);
    onDecline?.();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30">
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl md:rounded-2xl shadow-lg w-full max-w-md p-6 flex flex-col gap-4 m-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-primary text-lg">Cookies</span>
          <button onClick={() => setOpen(false)} aria-label="Cerrar aviso cookies">
            <XMarkIcon className="h-6 w-6 text-gray-400 hover:text-primary" />
          </button>
        </div>
        <div className="text-gray-600 dark:text-gray-300 text-sm">{message}</div>
        <div className="flex gap-2 justify-end mt-2">
          <button
            className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
            onClick={handleDecline}
          >
            {declineText}
          </button>
          <button
            className="px-4 py-2 rounded bg-primary text-white hover:bg-primary/90 focus:outline-none"
            onClick={handleAccept}
          >
            {acceptText}
          </button>
        </div>
      </div>
    </div>
  );
}
