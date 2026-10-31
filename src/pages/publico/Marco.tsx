import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../ui';
import { monedaDe } from '../../lib/paises';
import { useCatalogo } from './catalogo';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="Torre, inicio">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-brand" />
        <path d="M9 24V12.5L16 8l7 4.5V24M13.5 24v-5h5v5" fill="none" className="stroke-on-brand" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="text-xl">Torre</span>
    </Link>
  );
}

const enlace = 'rounded px-1.5 py-1.5 sm:px-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink';

/** Marco de las pantallas públicas (portada, precios, registro): cabecera con acceso y pie. Móvil primero. */
export function Marco({ children, ancho = 'max-w-5xl', completo = false }: { children: ReactNode; ancho?: string; /** Sin ancho ni márgenes en el contenido: cada sección pone los suyos (para fondos que llegan de borde a borde). */ completo?: boolean }) {
  // «Crear cuenta» sólo con el registro abierto: mientras llega el dato, no se muestra (evita ofrecer lo que luego se quita).
  const { data } = useCatalogo();
  return (
    <div className="flex min-h-svh flex-col bg-bg text-ink">
      <header className={completo ? '' : 'border-b border-line'}>
        <div className={cx('mx-auto flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-6', ancho)}>
          <Logo />
          <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-2">
            <Link to="/precios" className={enlace}>Precios</Link>
            <Link to="/login" className={enlace}>Ingresar</Link>
            {data?.registro_abierto && <Link to="/registro" className="whitespace-nowrap rounded bg-brand px-2.5 py-1.5 sm:px-3 text-sm font-medium text-on-brand transition-colors duration-150 hover:bg-brand-hover">Crear cuenta</Link>}
          </nav>
        </div>
      </header>
      <main className={completo ? 'w-full flex-1' : cx('mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12', ancho)}>{children}</main>
      <footer className={completo ? 'bg-surface2' : 'border-t border-line'}>
        <p className={cx('mx-auto w-full px-4 py-6 text-xs text-muted sm:px-6', ancho)}>Torre · Administración de condominios. {data ? `Precios en ${monedaDe(data.moneda)?.plural ?? data.moneda}${Number(data.impuesto.tasa) > 0 ? `, sin ${data.impuesto.nombre}` : ''}.` : 'Precios sin impuestos.'}</p>
        <nav aria-label="Legal" className={cx('mx-auto flex w-full flex-wrap gap-x-2 px-4 pb-6 text-xs text-muted sm:px-6', ancho)}>
          <Link to="/privacidad" className="underline-offset-2 hover:text-ink hover:underline">Privacidad</Link>
          <span aria-hidden="true">·</span>
          <Link to="/terminos" className="underline-offset-2 hover:text-ink hover:underline">Términos</Link>
        </nav>
      </footer>
    </div>
  );
}
