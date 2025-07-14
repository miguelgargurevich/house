import { FaceFrownIcon } from '@heroicons/react/24/outline';

export default function EmptyState({
  title = 'Sin datos',
  description = 'No se encontraron resultados para tu búsqueda.',
  icon = <FaceFrownIcon className="h-10 w-10 text-gray-400 mb-2" />,
  children,
}: {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon}
      <h2 className="text-lg font-semibold mb-1 text-gray-700 dark:text-gray-200">{title}</h2>
      <p className="text-gray-500 dark:text-gray-400 mb-4">{description}</p>
      {children}
    </div>
  );
}
