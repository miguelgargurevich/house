import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../ui';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="House, inicio">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-brand" />
        <path d="M9 24V12.5L16 8l7 4.5V24M13.5 24v-5h5v5" fill="none" className="stroke-on-brand" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="text-xl">House</span>
    </Link>
  );
}

const enlace = 'rounded px-2 py-1.5 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink';

/** Marco de las pantallas públicas (portada, precios, registro): cabecera con acceso y pie. Móvil primero. */
export function Marco({ children, ancho = 'max-w-5xl' }: { children: ReactNode; ancho?: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="border-b border-line">
        <div className={cx('mx-auto flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-6', ancho)}>
          <Logo />
          <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-2">
            <Link to="/precios" className={enlace}>Precios</Link>
            <Link to="/login" className={enlace}>Ingresar</Link>
            <Link to="/registro" className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-on-brand transition-colors duration-150 hover:bg-brand-hover">Crear cuenta</Link>
          </nav>
        </div>
      </header>
      <main className={cx('mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12', ancho)}>{children}</main>
      <footer className="border-t border-line">
        <p className={cx('mx-auto w-full px-4 py-6 text-xs text-muted sm:px-6', ancho)}>House · Administración de condominios en Perú. Precios en soles, IGV incluido.</p>
      </footer>
    </div>
  );
}
