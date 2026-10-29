import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ArrowRightStartOnRectangleIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import type { Usuario } from '../auth/AuthContext';
import { Avatar, cx } from '../ui';
import { PERFIL, ROL_LABEL } from './nav';

const item = 'flex w-full items-center gap-3 rounded px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:bg-surface2 hover:text-ink focus-visible:bg-surface2 focus-visible:text-ink focus-visible:outline-none';

/**
 * El usuario arriba a la derecha: avatar (con nombre y rol desde `sm`) que abre «Mi perfil» y «Cerrar sesión».
 * Se cierra al hacer clic fuera, con Escape (devuelve el foco al botón) o al cambiar de página. `onSalir` pide la confirmación.
 */
export function MenuUsuario({ user, onSalir }: { user: Pick<Usuario, 'nombre' | 'email' | 'rol'>; onSalir: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const loc = useLocation();

  useEffect(() => { setAbierto(false); }, [loc.pathname]);
  useEffect(() => {
    if (!abierto) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);

  /** Escape cierra; las flechas recorren las opciones. */
  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); setAbierto(false); boton.current?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={raiz} className="relative">
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto(a => !a)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls="menu-usuario"
        aria-label={`Tu cuenta: ${user.nombre}`}
        className="flex items-center gap-2 rounded-full p-0.5 transition-colors duration-150 hover:bg-surface2 sm:rounded sm:py-1 sm:pl-1 sm:pr-2"
      >
        <Avatar nombre={user.nombre} size="sm" />
        <span className="hidden min-w-0 max-w-[12rem] text-left leading-tight sm:block">
          <span className="block truncate text-sm font-medium">{user.nombre}</span>
          <span className="block truncate text-xs text-muted">{ROL_LABEL[user.rol]}</span>
        </span>
        <ChevronDownIcon className={cx('hidden h-4 w-4 text-muted transition-transform duration-150 sm:block', abierto && 'rotate-180')} aria-hidden="true" />
      </button>
      {abierto && (
        <div
          ref={menu}
          id="menu-usuario"
          role="menu"
          aria-label="Tu cuenta"
          onKeyDown={teclas}
          className="absolute right-0 top-full z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1.5 text-ink shadow-pop"
        >
          <div className="border-b border-line px-3 pb-2.5 pt-1.5">
            <p className="truncate text-sm font-medium">{user.nombre}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="truncate text-xs text-muted">{ROL_LABEL[user.rol]}</p>
          </div>
          <div className="pt-1.5">
            <NavLink to={PERFIL.to} role="menuitem" className={item}>
              <PERFIL.icon className="h-5 w-5 shrink-0" aria-hidden="true" /> {PERFIL.label}
            </NavLink>
            <button type="button" role="menuitem" onClick={() => { setAbierto(false); onSalir(); }} className={item}>
              <ArrowRightStartOnRectangleIcon className="h-5 w-5 shrink-0" aria-hidden="true" /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
