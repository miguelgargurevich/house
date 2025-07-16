import RoleGuard from './RoleGuard';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/inquilino/mi-panel', label: 'Mi Panel', roles: ['inquilino', 'superadmin'] },
  { to: '/inquilino/deudas', label: 'Deudas', roles: ['inquilino', 'superadmin'] },
  { to: '/inquilino/pagos', label: 'Pagos', roles: ['inquilino', 'superadmin'] },
  { to: '/inquilino/comprobante', label: 'Subir Comprobante', roles: ['inquilino', 'superadmin'] },
];

export default function InquilinoSidebar() {
  return (
    <aside className="w-56 bg-yellow-700 text-white min-h-screen p-4">
      <nav className="flex flex-col gap-2">
        {links.map(link => (
          <RoleGuard key={link.to} allowed={link.roles}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded hover:bg-yellow-800 transition ${isActive ? 'bg-yellow-800 font-bold' : ''}`
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
