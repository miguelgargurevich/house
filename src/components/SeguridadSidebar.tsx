import RoleGuard from './RoleGuard';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/seguridad/dashboard', label: 'Dashboard', roles: ['seguridad', 'superadmin'] },
  { to: '/seguridad/incidencias', label: 'Incidencias', roles: ['seguridad', 'superadmin'] },
  { to: '/seguridad/reportes', label: 'Reportes', roles: ['seguridad', 'superadmin'] },
];

export default function SeguridadSidebar() {
  return (
    <aside className="w-56 bg-gray-900 text-white min-h-screen p-4">
      <nav className="flex flex-col gap-2">
        {links.map(link => (
          <RoleGuard key={link.to} allowed={link.roles}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded hover:bg-gray-800 transition ${isActive ? 'bg-gray-800 font-bold' : ''}`
              }
            >
              {link.label}
            </NavLink>
          </RoleGuard>
        ))}
      </nav>
    </aside>
  );
}
