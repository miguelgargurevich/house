import type { ReactNode } from 'react';

export interface Tab {
  label: string;
  value: string;
  icon?: ReactNode;
}

export default function Tabs({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: Tab[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 border-b border-gray-200 dark:border-gray-700 ${className}`} role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.value}
          className={`px-4 py-2 font-medium rounded-t transition-colors focus:outline-none
            ${value === tab.value
              ? 'bg-white dark:bg-gray-900 border-b-2 border-accent text-primary dark:text-accent'
              : 'bg-transparent text-gray-500 dark:text-gray-300 hover:text-primary dark:hover:text-accent'}`}
          role="tab"
          aria-selected={value === tab.value}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon && <span className="inline-block mr-1 align-middle">{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
