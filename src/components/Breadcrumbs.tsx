import { ChevronRightIcon, HomeIcon } from '@heroicons/react/24/outline';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export default function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav className={`flex items-center text-sm gap-1 ${className || ''}`} aria-label="Breadcrumb">
      <ol className="flex items-center gap-1">
        <li>
          <a href="/" className="text-gray-400 hover:text-primary flex items-center" aria-label="Inicio">
            <HomeIcon className="h-4 w-4" />
          </a>
        </li>
        {items.map((item, idx) => (
          <li key={idx} className="flex items-center gap-1">
            <ChevronRightIcon className="h-4 w-4 text-gray-300" />
            {item.href ? (
              <a href={item.href} className="text-gray-600 hover:text-primary flex items-center gap-1">
                {item.icon} {item.label}
              </a>
            ) : (
              <span className="text-gray-400 flex items-center gap-1">{item.icon} {item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
