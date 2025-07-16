
import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  HomeModernIcon,
  BuildingStorefrontIcon,
  UserGroupIcon,
  DocumentDuplicateIcon,
  ArrowLeftOnRectangleIcon,
  Cog6ToothIcon,
  ClipboardDocumentListIcon,
  BuildingOffice2Icon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/solid';
import RoleGuard from './RoleGuard';

const groupedLinks = [
  {
    label: 'General',
    links: [
      { to: '/superadmin/dashboard', label: 'Dashboard', icon: HomeModernIcon, roles: ['superadmin'] },
    ],
  },
  {
    label: 'Gestión',
    links: [
      { to: '/superadmin/empresas', label: 'Empresas', icon: BuildingStorefrontIcon, roles: ['superadmin'] },
      { to: '/superadmin/usuarios', label: 'Usuarios Globales', icon: UserGroupIcon, roles: ['superadmin'] },
    ],
  },
  {
    label: 'Auditoría',
    links: [
      { to: '/superadmin/auditoria', label: 'Auditoría', icon: DocumentDuplicateIcon, roles: ['superadmin'] },
    ],
  },
  {
    label: 'Configuración',
    links: [
      { to: '/superadmin/configuracion', label: 'Configuración Avanzada', icon: HomeModernIcon, roles: ['superadmin'] },
    ],
  },
  {
    label: 'Admin',
    links: [
      { to: '/admin/propiedades', label: 'Propiedades (Admin)', icon: BuildingStorefrontIcon, roles: ['superadmin', 'admin'] },
      { to: '/admin/mantenimientos', label: 'Mantenimientos (Admin)', icon: UserGroupIcon, roles: ['superadmin', 'admin', 'mantenimiento'] },
    ],
  },
];

export default function SuperAdminSidebar() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sidebar-collapsed-superadmin');
      return stored === null ? true : stored === 'true';
    }
    return true;
  });
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed-superadmin', String(collapsed));
  }, [collapsed]);
  useEffect(() => {
    const handler = () => setOpen(o => !o);
    window.addEventListener('toggle-sidebar', handler);
    return () => window.removeEventListener('toggle-sidebar', handler);
  }, []);

  // Opciones directas, sin agrupaciones visuales
  const menu = [
    { to: '/superadmin/dashboard', label: 'Dashboard', icon: HomeModernIcon },
    { to: '/superadmin/empresas', label: 'Empresas', icon: BuildingOffice2Icon },
    { to: '/superadmin/usuarios', label: 'Usuarios Globales', icon: UserGroupIcon },
    { to: '/superadmin/auditoria', label: 'Auditoría', icon: ClipboardDocumentListIcon },
    { to: '/superadmin/configuracion', label: 'Configuración Avanzada', icon: Cog6ToothIcon },
    { to: '/admin/propiedades', label: 'Propiedades (Admin)', icon: BuildingStorefrontIcon },
    { to: '/admin/mantenimientos', label: 'Mantenimientos (Admin)', icon: WrenchScrewdriverIcon },
  ];
  return (
    <>
      <aside
        className={`z-40 top-0 left-0 ${collapsed ? 'w-16' : 'w-56'} bg-primary dark:bg-gray-800 text-gray-100 dark:text-gray-100 flex flex-col py-6 px-2 md:px-4 min-h-screen transition-all duration-200 fixed md:sticky md:top-0 md:h-auto h-full ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Botón para contraer/expandir solo en desktop */}
        <button
          className="hidden md:flex items-center justify-center mb-4 p-2 focus:outline-none"
          style={{ marginTop: 0, background: 'none', border: 'none', boxShadow: 'none' }}
          aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? (
            <svg className="h-5 w-5 text-gray-500 dark:text-gray-300 transition-colors hover:text-accent dark:hover:text-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
          ) : (
            <svg className="h-5 w-5 text-gray-500 dark:text-gray-300 transition-colors hover:text-accent dark:hover:text-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          )}
        </button>
        <nav className={`flex flex-col gap-0 mt-8 md:mt-0`} aria-label="Menú superadmin">
          {menu.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2 px-2 py-3 rounded transition-colors ${collapsed ? 'justify-center' : 'justify-start'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`inline-flex items-center align-middle ${collapsed ? 'justify-center' : 'justify-start'}`}>
                    <Icon className={`h-5 w-5 transition-colors ${isActive ? 'text-yellow-600' : 'text-gray-100'} hover:text-yellow-600`} aria-hidden="true" />
                  </span>
                  <span
                    className={collapsed ? 'sr-only' : `text-sm inline-flex items-center align-middle transition-colors ${isActive ? 'text-yellow-600' : 'text-gray-100'} hover:text-yellow-600`}
                    style={{lineHeight: 1, whiteSpace: 'nowrap'}}
                  >
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <button
          className="mt-auto flex items-center justify-center p-2 focus:outline-none"
          style={{ background: 'none', border: 'none', boxShadow: 'none' }}
          onClick={() => {
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            window.location.href = '/login';
          }}
          title="Cerrar sesión"
        >
          <ArrowLeftOnRectangleIcon className="h-5 w-5 text-gray-500 dark:text-gray-300 transition-colors hover:text-accent dark:hover:text-accent" aria-hidden="true" />
        </button>
      </aside>
      {/* Overlay mobile */}
      {open && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}

