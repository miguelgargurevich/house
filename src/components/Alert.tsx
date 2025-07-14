import { ExclamationTriangleIcon, CheckCircleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import type { ReactNode } from 'react';

const typeMap = {
  info: {
    icon: <InformationCircleIcon className="h-5 w-5" />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  },
  success: {
    icon: <CheckCircleIcon className="h-5 w-5" />, color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  },
  warning: {
    icon: <ExclamationTriangleIcon className="h-5 w-5" />, color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
  },
  error: {
    icon: <ExclamationTriangleIcon className="h-5 w-5" />, color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  },
};

export default function Alert({
  type = 'info',
  title,
  children,
  className = '',
}: {
  type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const info = typeMap[type] || typeMap.info;
  return (
    <div className={`flex items-start gap-2 p-3 rounded ${info.color} ${className}`} role="alert">
      <span>{info.icon}</span>
      <div>
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        {children && <div className="text-sm">{children}</div>}
      </div>
    </div>
  );
}
