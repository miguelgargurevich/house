import type { ReactNode } from 'react';

export default function Card({
  title,
  children,
  className = '',
  actions,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded shadow p-4 transition-colors ${className}`}>
      {title && <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-lg text-gray-800 dark:text-gray-100">{title}</h3>
        {actions}
      </div>}
      <div>{children}</div>
    </div>
  );
}
