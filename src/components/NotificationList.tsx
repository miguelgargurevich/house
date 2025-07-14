import { BellIcon, XMarkIcon } from '@heroicons/react/24/outline';
// ...existing code...

export interface Notification {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
}

interface NotificationProps {
  notifications: Notification[];
  onClose: (id: string) => void;
}

export default function NotificationList({ notifications, onClose }: NotificationProps) {
  return (
    <div className="fixed top-6 right-6 z-50 flex flex-col gap-2">
      {notifications.map(n => (
        <div key={n.id} className={`flex items-center gap-2 px-4 py-3 rounded shadow-lg text-sm bg-white dark:bg-gray-900 border-l-4 ${
          n.type === 'success' ? 'border-green-500' :
          n.type === 'error' ? 'border-red-500' :
          n.type === 'warning' ? 'border-yellow-500' :
          'border-primary'
        }`}>
          <BellIcon className="h-5 w-5 text-primary" />
          <span className="flex-1">{n.message}</span>
          <button onClick={() => onClose(n.id)} aria-label="Cerrar notificación">
            <XMarkIcon className="h-4 w-4 text-gray-400 hover:text-primary" />
          </button>
        </div>
      ))}
    </div>
  );
}
