export default function Switch({ checked, onChange, label, className = '' }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer select-none ${className}`}>
      <span className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only"
        />
        <span className={`block w-10 h-6 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-700'}`}></span>
        <span className={`absolute left-0 top-0 w-6 h-6 bg-white dark:bg-gray-900 rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`}></span>
      </span>
      {label && <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>}
    </label>
  );
}
