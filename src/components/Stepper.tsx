import type { ReactNode } from 'react';

export interface Step {
  label: string;
  description?: string;
  icon?: ReactNode;
}

export default function Stepper({
  steps,
  current,
  className = '',
}: {
  steps: Step[];
  current: number;
  className?: string;
}) {
  return (
    <ol className={`flex flex-col md:flex-row gap-4 md:gap-0 md:items-center ${className}`} aria-label="Progreso">
      {steps.map((step, i) => (
        <li key={i} className="flex-1 flex flex-col md:flex-row md:items-center">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-bold transition-colors
            ${i < current ? 'bg-accent border-accent text-primary' : i === current ? 'bg-primary border-primary text-white' : 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300'}`}
            aria-current={i === current ? 'step' : undefined}
          >
            {step.icon || i + 1}
          </div>
          <div className="mt-2 md:mt-0 md:ml-3 text-center md:text-left">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{step.label}</div>
            {step.description && <div className="text-xs text-gray-500 dark:text-gray-400">{step.description}</div>}
          </div>
          {i < steps.length - 1 && (
            <div className="hidden md:block flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 mx-2" />
          )}
        </li>
      ))}
    </ol>
  );
}
