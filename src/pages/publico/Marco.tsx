import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenIcon, DevicePhoneMobileIcon, EnvelopeIcon, PlayCircleIcon } from '@heroicons/react/24/outline';
import { cx } from '../../ui';
import { pieMarco } from '../../lib/seo/textos';
import { useCatalogo } from './catalogo';
import { URL_TORRE, useModoDemo } from '../../app/demo/useDemo';
import { IconoTorre } from '../../ui/IconoTorre';
import { IconoWhatsapp } from '../../ui/IconoWhatsapp';
import { useDatosLegales } from './legal/datos';
import { APP_MOVIL } from './appMovil/textos';
import { muestraBloques } from './appMovil/logica';
import { agente } from '../../app/instalar';
import { WhatsappFlotante } from './WhatsappFlotante';

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

/** Ícono de Facebook (la «f» en el círculo, del color del texto). Heroicons no tiene logos de marcas. */
function IconoFacebook({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971h-1.513c-1.491 0-1.956.931-1.956 1.887v2.263h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073Z" />
    </svg>
  );
}

const enlace = 'rounded px-1.5 py-1.5 sm:px-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink';

/** Marco de las pantallas públicas (portada, precios, registro): cabecera con acceso y pie. Móvil primero. */
export function Marco({ children, ancho = 'max-w-5xl', completo = false, sinWhatsapp = false }: {
  children: ReactNode;
  ancho?: string;
  /** Sin ancho ni márgenes en el contenido: cada sección pone los suyos (para fondos que llegan de borde a borde). */
  completo?: boolean;
  /** Sin el botón flotante de WhatsApp: en las pantallas cuyo botón principal queda abajo a la derecha en el celular (el registro). */
  sinWhatsapp?: boolean;
}) {
  // «Crear cuenta» sólo con el registro abierto: mientras llega el dato, no se muestra (evita ofrecer lo que luego se quita).
  const { data } = useCatalogo();
  const { demo } = useModoDemo(); // en la demo el registro es el de torrecondominios.com (aquí está cerrado)
  // Datos del responsable para el pie (razón social, RUC, domicilio y correo): sin ellos (cargando o sin red) el pie sólo omite esas líneas.
  const { datos } = useDatosLegales();
  const redes = data?.redes;
  const vinculo = 'inline-flex items-center gap-1.5 underline-offset-2 hover:text-ink hover:underline';
  return (
    <div className="flex min-h-svh flex-col bg-bg text-ink">
      <header className={completo ? '' : 'border-b border-line'}>
        <div className={cx('mx-auto flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-6', ancho)}>
          <Logo />
          <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-2">
            <Link to="/precios" className={enlace}>Precios</Link>
            <Link to="/contacto" className={cx(enlace, 'hidden sm:inline-block')}>Contacto</Link>
            <Link to="/login" className={enlace}>Ingresar</Link>
            {data?.registro_abierto && (demo
              ? <a href={`${URL_TORRE}/registro`} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap rounded bg-brand px-2.5 py-1.5 sm:px-3 text-sm font-medium text-on-brand transition-colors duration-150 hover:bg-brand-hover">Crear cuenta<span className="sr-only"> (se abre en otra pestaña)</span></a>
              : <Link to="/registro" className="whitespace-nowrap rounded bg-brand px-2.5 py-1.5 sm:px-3 text-sm font-medium text-on-brand transition-colors duration-150 hover:bg-brand-hover">Crear cuenta</Link>)}
          </nav>
        </div>
      </header>
      <main className={completo ? 'w-full flex-1' : cx('mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12', ancho)}>{children}</main>
      <footer className={cx(completo ? 'bg-surface2' : 'border-t border-line')}>
        <div className={cx('mx-auto grid w-full gap-8 px-4 pt-8 text-sm text-muted sm:grid-cols-2 sm:px-6', ancho)}>
          <div>
            <p className="font-semibold text-ink">Torre</p>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed">
              {datos?.razon_social && <li>{datos.razon_social}</li>}
              {datos?.ruc && <li>RUC {datos.ruc}</li>}
              {datos?.domicilio && <li>{datos.domicilio}</li>}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-ink">Contacto</p>
            <ul className="mt-2 space-y-2">
              <li><Link to="/contacto" className={vinculo}>Contacto</Link></li>
              {datos?.correo && <li><a href={`mailto:${datos.correo}`} className={vinculo}><EnvelopeIcon className="h-4 w-4" aria-hidden="true" /> {datos.correo}</a></li>}
              {redes?.whatsapp && (
                <li><a href={redes.whatsapp.enlace} target="_blank" rel="noopener noreferrer" className={vinculo}><IconoWhatsapp className="h-4 w-4" /> WhatsApp +{redes.whatsapp.numero}<span className="sr-only"> (se abre en otra pestaña)</span></a></li>
              )}
              {redes?.instagram && (
                <li><a href={redes.instagram} target="_blank" rel="noopener noreferrer" className={vinculo}><IconoInstagram className="h-4 w-4" /> Instagram<span className="sr-only"> (se abre en otra pestaña)</span></a></li>
              )}
              {redes?.facebook && (
                <li><a href={redes.facebook} target="_blank" rel="noopener noreferrer" className={vinculo}><IconoFacebook className="h-4 w-4" /> Facebook<span className="sr-only"> (se abre en otra pestaña)</span></a></li>
              )}
            </ul>
          </div>
        </div>
        <p className={cx('mx-auto w-full px-4 pt-6 text-xs text-muted sm:px-6', ancho)}>{pieMarco(data)}</p>
        {/* Abajo queda espacio libre (`pb-24` en el celular) para que el botón flotante de WhatsApp no tape estos enlaces. */}
        <nav aria-label="Legal" className={cx('mx-auto flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-24 pt-3 text-xs text-muted sm:px-6 sm:pb-8', ancho)}>
          <Link to="/privacidad" className="underline-offset-2 hover:text-ink hover:underline">Privacidad</Link>
          <span aria-hidden="true">·</span>
          <Link to="/terminos" className="underline-offset-2 hover:text-ink hover:underline">Términos</Link>
          <span aria-hidden="true">·</span>
          <Link to="/libro-de-reclamaciones" className="inline-flex items-center gap-1 underline-offset-2 hover:text-ink hover:underline"><BookOpenIcon className="h-4 w-4" aria-hidden="true" /> Libro de Reclamaciones</Link>
          {muestraBloques(agente()) && (
            <>
              <span aria-hidden="true">·</span>
              <Link to="/app" className="inline-flex items-center gap-1 underline-offset-2 hover:text-ink hover:underline"><DevicePhoneMobileIcon className="h-4 w-4" aria-hidden="true" /> {APP_MOVIL.nombre}</Link>
            </>
          )}
          {data?.manual && (
            <>
              <span aria-hidden="true">·</span>
              <a href={data.manual} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-ink hover:underline"><PlayCircleIcon className="h-4 w-4" aria-hidden="true" /> Manual y videos<span className="sr-only"> (se abre en otra pestaña)</span></a>
            </>
          )}
        </nav>
      </footer>
      {redes?.whatsapp && !sinWhatsapp && <WhatsappFlotante enlace={redes.whatsapp.enlace} />}
    </div>
  );
}
