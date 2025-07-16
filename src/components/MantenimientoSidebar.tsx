import RoleGuard from './RoleGuard';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/mantenimiento/tareas', label: 'Tareas', roles: ['mantenimiento', 'superadmin'] },
  { to: '/mantenimiento/nueva-tarea', label: 'Nueva Tarea', roles: ['mantenimiento', 'superadmin'] },
  { to: '/mantenimiento/estado', label: 'Estado', roles: ['mantenimiento', 'superadmin'] },
];

export default function MantenimientoSidebar() {
  return (
    <aside className="w-56 bg-red-800 text-white min-h-screen p-4">
      <nav className="flex flex-col gap-2">
        {links.map(link => (
          <RoleGuard key={link.to} allowed={link.roles}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded hover:bg-red-900 transition ${isActive ? 'bg-red-900 font-bold' : ''}`
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
