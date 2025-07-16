import RoleGuard from './RoleGuard';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/propietario/mi-panel', label: 'Mi Panel', roles: ['propietario', 'superadmin'] },
  { to: '/propietario/mis-propiedades', label: 'Mis Propiedades', roles: ['propietario', 'superadmin'] },
  { to: '/propietario/mis-pagos', label: 'Pagos Realizados', roles: ['propietario', 'superadmin'] },
  { to: '/propietario/pendientes', label: 'Pagos Pendientes', roles: ['propietario', 'superadmin'] },
  { to: '/propietario/perfil', label: 'Perfil', roles: ['propietario', 'superadmin'] },
];

export default function PropietarioSidebar() {
  return (
    <aside className="w-56 bg-green-700 text-white min-h-screen p-4">
      <nav className="flex flex-col gap-2">
        {links.map(link => (
          <RoleGuard key={link.to} allowed={link.roles}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded hover:bg-green-800 transition ${isActive ? 'bg-green-800 font-bold' : ''}`
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
