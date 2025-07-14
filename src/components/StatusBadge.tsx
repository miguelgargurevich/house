import type { ReactNode } from 'react';

const statusMap: Record<string, { label: string; color: string }> = {
  pagado: { label: 'Pagado', color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
  vencido: { label: 'Vencido', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
  validado: { label: 'Validado', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  rechazado: { label: 'Rechazado', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
};

export default function StatusBadge({ status, children }: { status: string; children?: ReactNode }) {
  const info = statusMap[status.toLowerCase()] || { label: status, color: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${info.color}`}>{children || info.label}</span>
  );
}
