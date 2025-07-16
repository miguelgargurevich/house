import { NavLink } from 'react-router-dom';

const links = [
  { to: '/limpieza/dashboard', label: 'Dashboard' },
  { to: '/limpieza/tareas', label: 'Tareas de Limpieza' },
  { to: '/limpieza/reportes', label: 'Reportes' },
];

export default function LimpiezaSidebar() {
  return (
    <aside className="w-56 bg-pink-700 text-white min-h-screen p-4">
      <nav className="flex flex-col gap-2">
        {links.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `block px-3 py-2 rounded hover:bg-pink-800 transition ${isActive ? 'bg-pink-800 font-bold' : ''}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
