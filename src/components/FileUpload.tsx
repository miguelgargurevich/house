import { useRef } from 'react';
import { PaperClipIcon } from '@heroicons/react/24/solid';

export default function FileUpload({
  onFile,
  accept = '',
  label = 'Adjuntar archivo',
  className = '',
}: {
  onFile: (file: File | null) => void;
  accept?: string;
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={`inline-flex items-center gap-2 px-3 py-2 rounded bg-accent text-primary hover:bg-accent/90 transition ${className}`}
        onClick={() => inputRef.current?.click()}
        aria-label={label}
      >
        <PaperClipIcon className="h-5 w-5" />
        <span className="text-sm font-medium">{label}</span>
      </button>
      <input
        type="file"
        ref={inputRef}
        className="hidden"
        accept={accept}
        onChange={e => onFile(e.target.files?.[0] || null)}
      />
    </>
  );
}
