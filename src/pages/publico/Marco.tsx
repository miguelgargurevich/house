import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../ui';
import { pieMarco } from '../../lib/seo/textos';
import { useCatalogo } from './catalogo';
import { IconoTorre } from '../../ui/IconoTorre';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="Torre, inicio">
      <IconoTorre className="h-8 w-8" />
      <span className="text-xl">Torre</span>
    </Link>
  );
}

/** Ícono de Instagram (trazo, del color del texto). Heroicons no tiene logos de marcas. */
function IconoInstagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
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
        <p className={cx('mx-auto w-full px-4 py-6 text-xs text-muted sm:px-6', ancho)}>{pieMarco(data)}</p>
        <nav aria-label="Legal" className={cx('mx-auto flex w-full flex-wrap gap-x-2 px-4 pb-6 text-xs text-muted sm:px-6', ancho)}>
          <Link to="/privacidad" className="underline-offset-2 hover:text-ink hover:underline">Privacidad</Link>
          <span aria-hidden="true">·</span>
          <Link to="/terminos" className="underline-offset-2 hover:text-ink hover:underline">Términos</Link>
          {data?.redes?.instagram && (
            <>
              <span aria-hidden="true">·</span>
              <a href={data.redes.instagram} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-ink hover:underline">
                <IconoInstagram className="h-3.5 w-3.5" /> Instagram
              </a>
            </>
          )}
        </nav>
      </footer>
    </div>
  );
}
