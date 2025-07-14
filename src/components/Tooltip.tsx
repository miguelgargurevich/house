

interface TooltipProps {
  children: React.ReactNode;
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export default function Tooltip({ children, text, position = 'top' }: TooltipProps) {
  return (
    <span className="group relative inline-block">
      {children}
      <span className={`pointer-events-none absolute z-50 whitespace-nowrap rounded bg-gray-800 text-white text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-all duration-200 ${
        position === 'top' ? 'bottom-full left-1/2 -translate-x-1/2 mb-2' :
        position === 'bottom' ? 'top-full left-1/2 -translate-x-1/2 mt-2' :
        position === 'left' ? 'right-full top-1/2 -translate-y-1/2 mr-2' :
        'left-full top-1/2 -translate-y-1/2 ml-2'
      }`}>{text}</span>
    </span>
  );
}
