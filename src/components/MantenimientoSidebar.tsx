import { useState, useEffect } from 'react';
import RoleGuard from './RoleGuard';
import { NavLink } from 'react-router-dom';
import { ClipboardDocumentListIcon, PlusCircleIcon, ChartBarIcon } from '@heroicons/react/24/solid';

const links = [
  { to: '/mantenimiento/tareas', label: 'Tareas', icon: ClipboardDocumentListIcon, roles: ['mantenimiento', 'superadmin'] },
  { to: '/mantenimiento/nueva-tarea', label: 'Nueva Tarea', icon: PlusCircleIcon, roles: ['mantenimiento', 'superadmin'] },
  { to: '/mantenimiento/estado', label: 'Estado', icon: ChartBarIcon, roles: ['mantenimiento', 'superadmin'] },
];

export default function MantenimientoSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sidebar-collapsed-mantenimiento');
      return stored === null ? true : stored === 'true';
    }
    return true;
  });
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed-mantenimiento', String(collapsed));
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
      <nav className={`flex flex-col gap-2 mt-8 md:mt-0 ${collapsed ? 'items-center' : ''}`} aria-label="Menú mantenimiento">
        {links.map(link => (
          <RoleGuard key={link.to} allowed={link.roles}>
            <NavLink
              to={link.to}
              title={collapsed ? link.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded transition-colors ${collapsed ? 'justify-center bg-white/10 dark:bg-gray-800 hover:bg-accent/20 dark:hover:bg-accent/10 p-2' : 'justify-start'} ${isActive ? 'bg-accent font-bold' : ''}`
              }
            >
              {/* Si hay icono, mostrarlo con el mismo estilo que superadmin */}
              {/* Ícono con color y transición igual a SuperAdminSidebar */}
              {link.icon ? (
                <span className={`inline-flex items-center align-middle ${collapsed ? 'justify-center p-2' : 'justify-start p-0 mr-2'}`}>
                  <link.icon className="h-5 w-5 text-gray-500 dark:text-gray-300 transition-colors hover:text-accent dark:hover:text-accent" aria-hidden="true" />
                </span>
              ) : null}
              <span
                className={collapsed ? 'sr-only' : 'text-white dark:text-white text-sm inline-flex items-center align-middle transition-colors hover:text-accent dark:hover:text-accent'}
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
