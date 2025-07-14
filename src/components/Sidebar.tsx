import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  HomeIcon,
  DocumentTextIcon,
  BuildingOffice2Icon,
  KeyIcon,
  CreditCardIcon,
  BellIcon,
  Bars3Icon,
  ChevronLeftIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/outline';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/receipts', label: 'Recibos', icon: DocumentTextIcon },
  { to: '/properties', label: 'Propiedades', icon: BuildingOffice2Icon },
  { to: '/units', label: 'Unidades', icon: KeyIcon },
  { to: '/payments', label: 'Pagos', icon: CreditCardIcon },
  { to: '/notifications', label: 'Notificaciones', icon: BellIcon },
];

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sidebar-collapsed');
      return stored === null ? true : stored === 'true';
    }
    return true;
  });

  useEffect(() => {
    const handler = () => setOpen(o => !o);
    window.addEventListener('toggle-sidebar', handler);
    return () => window.removeEventListener('toggle-sidebar', handler);
  }, []);

  // Persistir colapsado
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  return (
    <>
      <aside
        className={`fixed md:static z-40 top-0 left-0 h-full ${collapsed ? 'w-16' : 'w-56'} bg-primary dark:bg-gray-800 text-white flex flex-col py-6 px-2 md:px-4 min-h-screen transition-all duration-200 ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Botón para contraer/expandir solo en desktop */}
        <button
          className="hidden md:flex items-center justify-center mb-4 p-2 rounded hover:bg-white/10 transition-colors"
          aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? <Bars3Icon className="h-6 w-6" /> : <ChevronLeftIcon className="h-6 w-6" />}
        </button>
        <nav className={`flex flex-col gap-2 mt-8 md:mt-0 ${collapsed ? 'items-center' : ''}`}>
          {links.map(link => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `flex items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded px-3 py-2 transition-colors ${isActive ? 'bg-accent text-primary dark:bg-accent dark:text-gray-900' : 'hover:bg-accent/80 dark:hover:bg-accent/60'}`
                }
                onClick={() => setOpen(false)}
                title={collapsed ? link.label : undefined}
              >
                <Icon className="h-5 w-5" />
                {!collapsed && link.label}
              </NavLink>
            );
          })}
        </nav>
        <button
          className={`mt-auto flex items-center ${collapsed ? 'justify-center' : 'gap-2'} px-3 py-2 rounded text-sm border border-gray-300 dark:border-gray-600 bg-white/10 dark:bg-gray-900 text-gray-900 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors font-semibold`}
          onClick={() => {
            localStorage.removeItem('user');
            window.location.href = '/login';
          }}
          title={collapsed ? 'Cerrar sesión' : undefined}
        >
          <ArrowRightOnRectangleIcon className="h-5 w-5" />
          {!collapsed && 'Cerrar sesión'}
        </button>
      </aside>
      {/* Overlay mobile */}
      {open && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
