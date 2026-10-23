import { useState, useEffect } from 'react';
import RoleGuard from './RoleGuard';
import { NavLink } from 'react-router-dom';
import { HomeModernIcon, BuildingOffice2Icon, UsersIcon, BanknotesIcon, ChartBarIcon, Cog6ToothIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/solid';

const links = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: HomeModernIcon, roles: ['admin', 'superadmin'] },
  { to: '/admin/empresas', label: 'Empresas', icon: BuildingOffice2Icon, roles: ['admin', 'superadmin'] },
  { to: '/admin/propiedades', label: 'Propiedades', icon: BuildingOffice2Icon, roles: ['admin', 'superadmin'] },
  { to: '/admin/propietarios', label: 'Propietarios', icon: UsersIcon, roles: ['admin', 'superadmin'] },
  { to: '/admin/pagos', label: 'Pagos', icon: BanknotesIcon, roles: ['admin', 'superadmin'] },
  { to: '/admin/reportes', label: 'Reportes', icon: ChartBarIcon, roles: ['admin', 'superadmin'] },
  { to: '/admin/usuarios', label: 'Usuarios', icon: UsersIcon, roles: ['admin', 'superadmin'] },
  { to: '/admin/configuracion', label: 'Configuración', icon: Cog6ToothIcon, roles: ['admin', 'superadmin'] },
  { to: '/admin/mantenimientos', label: 'Mantenimientos', icon: WrenchScrewdriverIcon, roles: ['admin', 'superadmin', 'mantenimiento'] },
];

export default function AdminSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sidebar-collapsed-admin');
      return stored === null ? true : stored === 'true';
    }
    return true;
  });
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed-admin', String(collapsed));
  }, [collapsed]);

  return (
    <aside className={`z-40 top-0 left-0 ${collapsed ? 'w-16' : 'w-56'} bg-primary dark:bg-gray-800 text-white flex flex-col py-6 px-2 md:px-4 min-h-screen transition-all duration-200 fixed md:sticky md:top-0 md:h-auto h-full`}>
      {/* Botón para contraer/expandir solo en desktop */}
      <button
        className="hidden md:flex items-center justify-center mb-4 p-2 rounded-lg bg-white/20 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-accent/20 dark:hover:bg-accent/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60"
        aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
        onClick={() => setCollapsed(c => !c)}
      >
        {collapsed ? (
          <svg className="h-6 w-6 text-accent dark:text-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
        ) : (
          <svg className="h-6 w-6 text-accent dark:text-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        )}
      </button>
      <nav className={`flex flex-col gap-0 mt-8 md:mt-0`} aria-label="Menú admin">
        {links.map(link => (
          <RoleGuard key={link.to} allowed={link.roles}>
            <NavLink
              to={link.to}
              title={collapsed ? link.label : undefined}
              className={({ isActive }) =>
                  `flex items-center gap-2 px-2 rounded transition-colors ${collapsed ? 'justify-center bg-white/10 dark:bg-gray-800 hover:bg-accent/20 dark:hover:bg-accent/10' : 'justify-start'} ${isActive ? 'bg-accent font-bold' : ''}`
              }
            >
              {/* Ícono con tamaño h-6 w-6 igual al botón expandir/contraer */}
              {link.icon && (
                <span className={`inline-flex items-center align-middle ${collapsed ? 'justify-center' : 'justify-start'}`}>
                    <link.icon className="h-5 w-5 transition-colors text-gray-100 hover:text-yellow-600" aria-hidden="true" />
                </span>
              )}
              <span
                className={collapsed ? 'sr-only' : 'text-gray-100 text-sm inline-flex items-center align-middle transition-colors hover:text-yellow-600'}
                style={{lineHeight: 1, whiteSpace: 'nowrap'}}
              >
                  {link.label}
              </span>
            </NavLink>
          </RoleGuard>
        ))}
      </nav>
    </aside>
  );
}
