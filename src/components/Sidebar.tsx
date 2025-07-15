import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  HomeModernIcon,
  DocumentDuplicateIcon,
  BuildingStorefrontIcon,
  KeyIcon,
  CreditCardIcon,
  BellAlertIcon,
  Bars3BottomLeftIcon,
  ArrowLeftOnRectangleIcon,
  UserGroupIcon,
  BanknotesIcon,
  ClipboardDocumentCheckIcon,
  Squares2X2Icon,
  CurrencyDollarIcon,
  PuzzlePieceIcon,
  ArchiveBoxIcon
} from '@heroicons/react/24/solid';

const groupedLinks = [
  {
    label: 'General',
    links: [
      { to: '/dashboard', label: 'Dashboard', icon: HomeModernIcon },
    ],
  },
  {
    label: 'Mantenimiento',
    links: [
      { to: '/usuarios', label: 'Usuarios', icon: UserGroupIcon },
      { to: '/empresas', label: 'Empresas', icon: BuildingStorefrontIcon },
    ],
  },
  {
    label: 'Finanzas',
    links: [
      { to: '/receipts', label: 'Recibos', icon: DocumentDuplicateIcon },
    ],
  },
];

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  // Por defecto colapsado, pero permite expandir
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sidebar-collapsed');
      return stored === null ? true : stored === 'true';
    }
    return true;
  });
  // Persistir colapsado
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const handler = () => setOpen(o => !o);
    window.addEventListener('toggle-sidebar', handler);
    return () => window.removeEventListener('toggle-sidebar', handler);
  }, []);

  return (
    <>
      <aside
        className={`fixed md:static z-40 top-0 left-0 h-full ${collapsed ? 'w-16' : 'w-56'} bg-primary dark:bg-gray-900 text-gray-100 dark:text-gray-100 flex flex-col py-6 px-2 md:px-4 min-h-screen transition-all duration-200 ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Botón para contraer/expandir solo en desktop */}
        <button
          className="hidden md:flex items-center justify-center mb-4 p-2 rounded hover:bg-accent/20 dark:hover:bg-accent/10 transition-colors focus:outline-none"
          aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? <svg className="h-6 w-6 text-accent dark:text-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg> : <svg className="h-6 w-6 text-accent dark:text-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>}
        </button>
        <nav className={`flex flex-col gap-3 mt-8 md:mt-0 ${collapsed ? 'items-center' : ''}`} aria-label="Menú principal">
          {groupedLinks.flatMap(group => group.links).map(link => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                title={collapsed ? link.label : undefined}
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`inline-flex items-center rounded transition-colors align-middle ${collapsed ? 'justify-center bg-white/10 dark:bg-gray-800 hover:bg-accent/20 dark:hover:bg-accent/10 p-2' : 'justify-start p-0 mr-2'}`}
                      style={{ minWidth: collapsed ? undefined : 24, minHeight: 32 }}
                    >
                      <Icon className={`h-5 w-5 ${isActive ? 'text-accent' : 'text-white dark:text-white'}`} aria-hidden="true" />
                    </span>
                    <span className={collapsed ? 'sr-only' : 'text-white dark:text-white inline-flex items-center align-middle'} style={{lineHeight: 1, whiteSpace: 'nowrap'}}>{link.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
        <button
          className="mt-auto flex items-center justify-center px-3 py-2 rounded text-sm border border-gray-300 dark:border-gray-700 bg-white/20 dark:bg-gray-800 text-primary dark:text-gray-200 hover:bg-accent/20 dark:hover:bg-accent/10 transition-colors font-semibold focus:outline-none focus:ring-2 focus:ring-accent/60"
          onClick={() => {
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            window.location.href = '/login';
          }}
          title="Cerrar sesión"
        >
          <ArrowLeftOnRectangleIcon className="h-6 w-6 text-accent dark:text-accent" aria-hidden="true" />
        </button>
      </aside>
      {/* Overlay mobile */}
      {open && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
