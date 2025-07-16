import { HomeIcon, UserIcon, CogIcon } from '@heroicons/react/24/outline';
import { Link, useLocation } from 'react-router-dom';

const menu = [
  { label: 'Inicio', icon: HomeIcon, to: '/owner/dashboard' },
  { label: 'Mi perfil', icon: UserIcon, to: '/owner/profile' },
  { label: 'Configuración', icon: CogIcon, to: '/owner/settings' },
];

export default function OwnerSidebar() {
  const location = useLocation();
  return (
    <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 min-h-screen flex flex-col py-6 px-4 shadow-lg">
      <div className="mb-8 text-2xl font-bold text-primary dark:text-accent text-center">Panel Propietario</div>
      <nav className="flex flex-col gap-2">
        {menu.map(({ label, icon: Icon, to }) => (
          <Link
            key={to}
            to={to}
            className={`flex items-center gap-3 px-4 py-2 rounded-lg font-medium transition-colors hover:bg-primary/10 dark:hover:bg-accent/10 ${location.pathname === to ? 'bg-primary/10 dark:bg-accent/10 text-primary dark:text-accent' : 'text-gray-700 dark:text-gray-200'}`}
          >
            <Icon className="h-5 w-5" />
            <span
              className="text-gray-700 dark:text-gray-200 text-sm inline-flex items-center align-middle transition-colors hover:text-accent dark:hover:text-accent"
              style={{lineHeight: 1, whiteSpace: 'nowrap'}}
            >
              {label}
            </span>
          </Link>
        ))}
      </nav>
      <div className="mt-auto pt-8 text-xs text-gray-400 text-center">© {new Date().getFullYear()} House</div>
    </aside>
  );
}
