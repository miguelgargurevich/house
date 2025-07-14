import { useRef } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  label?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
}

export default function DatePicker({ value, onChange, label, min, max, required, disabled }: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</label>}
      <div className="relative">
        <input
          ref={inputRef}
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          className="w-full border rounded px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-white dark:bg-gray-800 dark:text-white disabled:bg-gray-100 disabled:dark:bg-gray-700"
          aria-label={label || 'Seleccionar fecha'}
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-primary"
          onClick={() => inputRef.current?.showPicker?.()}
          aria-label="Abrir selector de fecha"
          disabled={disabled}
        >
          <CalendarDaysIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
