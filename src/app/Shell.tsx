import { useEffect, useState, type CSSProperties } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRightStartOnRectangleIcon, Bars3Icon, ChevronDoubleLeftIcon, MoonIcon, SparklesIcon, SunIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../auth/AuthContext';
import { Avatar, ConfirmDialog, IconButton, cx } from '../ui';
import { PERFIL, ROL_LABEL, navPara } from './nav';
import { useTheme } from './theme';
import { Assistant } from './Assistant';
import { useEscritorio, usePanelAbierto } from './asistente/useDock';
import { Pista } from './Pista';
import { useBarra } from './useBarra';

function Logo({ soloMarca = false }: { soloMarca?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-brand" />
        <path d="M9 24V12.5L16 8l7 4.5V24M13.5 24v-5h5v5" fill="none" className="stroke-on-brand" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {!soloMarca && 'House'}
    </span>
  );
}

const link = 'flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors duration-150';
const linkRiel = '!justify-center !gap-0 !px-0';

export function Shell() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [confirmarSalida, setConfirmarSalida] = useState(false);
  const escritorio = useEscritorio();
  const chat = usePanelAbierto(user?.id ?? 0, escritorio);
  const barra = useBarra(escritorio);

  useEffect(() => { setMenu(false); }, [loc.pathname]);
  if (!user) return null;

  const salir = () => { logout(); nav('/login', { replace: true }); };

  /** `riel`: sólo iconos (escritorio colapsado). El cajón del celular siempre se pinta con textos. */
  const sidebar = (riel: boolean, escritorioBarra: boolean) => (
    <div className="flex h-full flex-col">
      <div className={cx('flex h-14 shrink-0 items-center', riel ? 'justify-center' : 'justify-between px-5')}>
        {escritorioBarra ? (
          <Pista texto={riel ? 'Expandir menú' : undefined}>
            <button
              type="button"
              onClick={barra.alternar}
              aria-expanded={!riel}
              aria-controls="barra-lateral"
              aria-label={riel ? 'Expandir menú' : 'Colapsar menú'}
              title={riel ? undefined : 'Colapsar menú ( [ )'}
              className={cx('group flex h-10 items-center rounded transition-colors duration-150 hover:bg-surface2', riel ? 'w-10 justify-center' : 'w-full justify-between pl-1 pr-2 -ml-1')}
            >
              <Logo soloMarca={riel} />
              {!riel && <ChevronDoubleLeftIcon className="h-4 w-4 text-muted group-hover:text-ink" aria-hidden="true" />}
            </button>
          </Pista>
        ) : <Logo />}
      </div>
      <nav aria-label="Principal" className={cx('flex-1 overflow-y-auto py-3', riel ? 'space-y-3 px-2' : 'space-y-5 px-3')}>
        {navPara(user).map((g, i) => (
          <div key={i} className={cx(riel && i > 0 && 'border-t border-line pt-3')}>
            {!riel && g.label && <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wide text-muted">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map(it => (
                <li key={it.to}>
                  <Pista texto={riel ? it.label : undefined}>
                    <NavLink
                      to={it.to}
                      aria-label={riel ? it.label : undefined}
                      className={({ isActive }) => cx(link, riel && linkRiel, isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface2 hover:text-ink')}
                    >
                      <it.icon className="h-5 w-5 shrink-0" />
                      {!riel && it.label}
                    </NavLink>
                  </Pista>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className={cx('border-t border-line', riel ? 'px-2 py-3' : 'p-3')}>
        <Pista texto={riel ? `${user.nombre} · ${ROL_LABEL[user.rol]}` : undefined}>
          <NavLink
            to={PERFIL.to}
            aria-label={riel ? `${PERFIL.label}: ${user.nombre}` : undefined}
            className={({ isActive }) => cx('flex items-center gap-3 rounded px-3 py-2 transition-colors duration-150', riel && linkRiel, isActive ? 'bg-brand-soft' : 'hover:bg-surface2')}
          >
            <Avatar nombre={user.nombre} />
            {!riel && (
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-medium">{user.nombre}</span>
                <span className="block truncate text-xs text-muted">{ROL_LABEL[user.rol]}</span>
              </span>
            )}
          </NavLink>
        </Pista>
        <Pista texto={riel ? 'Cerrar sesión' : undefined}>
          <button onClick={() => setConfirmarSalida(true)} aria-label={riel ? 'Cerrar sesión' : undefined} className={cx(link, riel && linkRiel, 'mt-1 w-full text-muted hover:bg-surface2 hover:text-ink')}>
            <ArrowRightStartOnRectangleIcon className="h-5 w-5 shrink-0" /> {!riel && 'Cerrar sesión'}
          </button>
        </Pista>
      </div>
    </div>
  );

  return (
    <div
      className={cx('min-h-screen lg:flex lg:pl-[var(--barra)]', barra.animar && 'lg:transition-[padding] lg:duration-[180ms] lg:ease-out')}
      style={{ '--barra': `${barra.ancho}px` } as CSSProperties}
    >
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">Saltar al contenido</a>

      <aside
        id="barra-lateral"
        className={cx('fixed inset-y-0 left-0 z-20 hidden w-[var(--barra)] overflow-x-hidden border-r border-line bg-surface lg:block', barra.animar && 'transition-[width] duration-[180ms] ease-out')}
      >
        {sidebar(barra.colapsada, true)}
      </aside>

      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenu(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-pop">
            <IconButton label="Cerrar menú" onClick={() => setMenu(false)} className="absolute right-2 top-2.5"><XMarkIcon className="h-5 w-5" /></IconButton>
            {sidebar(false, false)}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1" inert={chat.abierto && !escritorio}>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur lg:px-8">
        <div className="flex items-center gap-2 lg:hidden">
          <IconButton label="Abrir menú" onClick={() => setMenu(true)}><Bars3Icon className="h-5 w-5" /></IconButton>
          <Logo />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} onClick={toggle}>
            {dark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
          </IconButton>
          <IconButton label={chat.abierto ? 'Cerrar asistente' : 'Abrir asistente'} aria-pressed={chat.abierto} onClick={chat.alternar} className={chat.abierto ? '!text-brand' : undefined}><SparklesIcon className="h-5 w-5" /></IconButton>
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
      </div>

      <Assistant open={chat.abierto} onClose={chat.cerrar} escritorio={escritorio} barra={barra.ancho} />
      {/* El botón queda justo debajo del usuario: un clic de más sacaba de la app. Se confirma antes de salir. */}
      <ConfirmDialog open={confirmarSalida} onClose={() => setConfirmarSalida(false)} onConfirm={salir} title="¿Cerrar sesión?" message="Tendrás que volver a ingresar con tu correo y tu contraseña." confirmLabel="Cerrar sesión" />
    </div>
  );
}
