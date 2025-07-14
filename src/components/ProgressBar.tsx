export default function ProgressBar({ value, max = 100, className = '' }: { value: number; max?: number; className?: string }) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={`w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden ${className}`} aria-label="Progreso">
      <div
        className="h-full bg-accent transition-all"
        style={{ width: `${percent}%` }}
        aria-valuenow={value}
        aria-valuemax={max}
        aria-valuemin={0}
        role="progressbar"
      />
    </div>
  );
}
