import RoleGuard from './RoleGuard';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/admin/dashboard', label: 'Dashboard', roles: ['admin', 'superadmin'] },
  { to: '/admin/empresas', label: 'Empresas', roles: ['admin', 'superadmin'] },
  { to: '/admin/propiedades', label: 'Propiedades', roles: ['admin', 'superadmin'] },
  { to: '/admin/propietarios', label: 'Propietarios', roles: ['admin', 'superadmin'] },
  { to: '/admin/pagos', label: 'Pagos', roles: ['admin', 'superadmin'] },
  { to: '/admin/reportes', label: 'Reportes', roles: ['admin', 'superadmin'] },
  { to: '/admin/usuarios', label: 'Usuarios', roles: ['admin', 'superadmin'] },
  { to: '/admin/configuracion', label: 'Configuración', roles: ['admin', 'superadmin'] },
  { to: '/admin/mantenimientos', label: 'Mantenimientos', roles: ['admin', 'superadmin', 'mantenimiento'] },
];

export default function AdminSidebar() {
  return (
    <aside className="w-56 bg-blue-900 text-white min-h-screen p-4">
      <nav className="flex flex-col gap-2">
        {links.map(link => (
          <RoleGuard key={link.to} allowed={link.roles}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded hover:bg-blue-800 transition ${isActive ? 'bg-blue-800 font-bold' : ''}`
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
