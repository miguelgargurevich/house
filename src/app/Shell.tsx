import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRightStartOnRectangleIcon, Bars3Icon, MoonIcon, SparklesIcon, SunIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../auth/AuthContext';
import { Avatar, IconButton, cx } from '../ui';
import { NAV, PERFIL, ROL_LABEL } from './nav';
import { useTheme } from './theme';
import { Assistant } from './Assistant';

function Logo() {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-brand" />
        <path d="M9 24V12.5L16 8l7 4.5V24M13.5 24v-5h5v5" fill="none" className="stroke-on-brand" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      House
    </span>
  );
}

const link = 'flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors duration-150';

export function Shell() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [chat, setChat] = useState(false);

  useEffect(() => { setMenu(false); }, [loc.pathname]);
  if (!user) return null;

  const salir = () => { logout(); nav('/login', { replace: true }); };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-5"><Logo /></div>
      <nav aria-label="Principal" className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {NAV[user.rol].map((g, i) => (
          <div key={i}>
            {g.label && <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wide text-muted">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map(it => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    className={({ isActive }) => cx(link, isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface2 hover:text-ink')}
                  >
                    <it.icon className="h-5 w-5 shrink-0" />
                    {it.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-3">
        <NavLink to={PERFIL.to} className={({ isActive }) => cx('flex items-center gap-3 rounded px-3 py-2 transition-colors duration-150', isActive ? 'bg-brand-soft' : 'hover:bg-surface2')}>
          <Avatar nombre={user.nombre} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-medium">{user.nombre}</span>
            <span className="block truncate text-xs text-muted">{ROL_LABEL[user.rol]}</span>
          </span>
        </NavLink>
        <button onClick={salir} className={cx(link, 'mt-1 w-full text-muted hover:bg-surface2 hover:text-ink')}>
          <ArrowRightStartOnRectangleIcon className="h-5 w-5" /> Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">Saltar al contenido</a>

      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-surface lg:block">{sidebar}</aside>

      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenu(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-pop">
            <IconButton label="Cerrar menú" onClick={() => setMenu(false)} className="absolute right-2 top-2.5"><XMarkIcon className="h-5 w-5" /></IconButton>
            {sidebar}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur lg:px-8">
        <div className="flex items-center gap-2 lg:hidden">
          <IconButton label="Abrir menú" onClick={() => setMenu(true)}><Bars3Icon className="h-5 w-5" /></IconButton>
          <Logo />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} onClick={toggle}>
            {dark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
          </IconButton>
          <IconButton label="Abrir asistente" onClick={() => setChat(true)}><SparklesIcon className="h-5 w-5" /></IconButton>
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>

      <Assistant open={chat} onClose={() => setChat(false)} />
    </div>
  );
}
