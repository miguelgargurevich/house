import { useEffect, useState, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bars3Icon, ChevronDoubleLeftIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog, IconButton, cx } from '../ui';
import { navPara } from './nav';
import { MenuLateral } from './MenuLateral';
import { useCondominio } from './condominio';
import { MenuUsuario } from './MenuUsuario';
import { Assistant } from './Assistant';
import { useEscritorio, usePanelAbierto } from './asistente/useDock';
import { Pista } from './Pista';
import { useBarra } from './useBarra';
import { BandaSoloLectura } from './BandaSoloLectura';
import { BarraImpersonacion } from './BarraImpersonacion';
import { FranjaDemo } from './demo/FranjaDemo';
import { volverAMiCuenta } from '../auth/impersonacion';
import { InstalarApp } from './InstalarApp';
import { CondominioProvider } from './CondominioProvider';
import { SoloLecturaProvider } from './SoloLecturaProvider';
import { SelectorCondominio } from './SelectorCondominio';
import { MARCA_TORRE, inicialDeMarca } from '../lib/marca';
import { ImagenRecibo } from '../pages/shared/mantenimiento/ImagenRecibo';
import { MarcaContext, useMarca } from './marca/contexto';
import { MarcaTema } from './marca/MarcaTema';
import { IconoTorre } from '../ui/IconoTorre';

/** Encabezado del menú: la marca de la empresa (logo o su inicial y su nombre) si la tiene activa; si no, la de Torre. */
function Logo({ soloMarca = false }: { soloMarca?: boolean }) {
  const marca = useMarca();
  if (marca.activa) {
    return (
      <span className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
        {marca.logo_url
          ? <ImagenRecibo src={marca.logo_url} alt="" className="h-7 w-auto max-w-[2.75rem] shrink-0 rounded object-contain" />
          : <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded bg-brand text-sm font-bold text-on-brand">{inicialDeMarca(marca.nombre)}</span>}
        {!soloMarca && <span className="truncate" title={marca.nombre}>{marca.nombre}</span>}
        {soloMarca && <span className="sr-only">{marca.nombre}</span>}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight">
      <IconoTorre className="h-7 w-7 shrink-0" />
      {!soloMarca && 'Torre'}
    </span>
  );
}

/** El condominio elegido arriba lo comparten todas las pantallas: el estado vive fuera, con la sesión (`key`) para no heredar el de otro usuario. */
export function Shell() {
  const { user } = useAuth();
  const marca = user?.marca ?? MARCA_TORRE;
  return (
    <MarcaContext.Provider value={marca}>
      <MarcaTema marca={marca} />
      <CondominioProvider key={user?.id ?? 0}><SoloLecturaProvider><ShellInterior /></SoloLecturaProvider></CondominioProvider>
    </MarcaContext.Provider>
  );
}

function ShellInterior() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [confirmarSalida, setConfirmarSalida] = useState(false);
  const escritorio = useEscritorio();
  const chat = usePanelAbierto(user?.id ?? 0, escritorio);
  const barra = useBarra(escritorio);
  const { sinCondominios } = useCondominio();
  const marca = useMarca();

  useEffect(() => { setMenu(false); }, [loc.pathname]);
  if (!user) return null;

  // En una sesión prestada no hay «cerrar sesión» propia: se vuelve a la cuenta del superadmin.
  const salir = () => { if (user.impersonando) { void volverAMiCuenta().catch(() => undefined); return; } logout(); nav('/login', { replace: true }); };

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
      <MenuLateral grupos={navPara(user, { sinCondominios })} riel={riel} />
      {/* La plataforma sigue siendo Torre: con la marca de la empresa activa queda en pequeño al pie del menú. */}
      {marca.activa && !riel && <p className="shrink-0 border-t border-line px-5 py-3 text-xs text-muted">con Torre</p>}
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
        <div className="fixed inset-0 top-[var(--techo)] z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenu(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-pop">
            <IconButton label="Cerrar menú" onClick={() => setMenu(false)} className="absolute right-2 top-2.5"><XMarkIcon className="h-5 w-5" /></IconButton>
            {sidebar(false, false)}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1" inert={chat.abierto && !escritorio}>
      <div className="sticky top-[var(--techo)] z-30 border-b border-line bg-bg/85 backdrop-blur">
      {/* Demo de Torre: la franja fija (datos de ejemplo, cambiar de rol, crear cuenta, WhatsApp y «Qué probar»); en cualquier otra instancia no pinta nada. */}
      <FranjaDemo />
      {/* «Entrar como»: mientras el superadmin ve Torre como otra persona, la barra va arriba de todo y no se puede cerrar. */}
      <BarraImpersonacion />
      <header className="flex h-14 items-center justify-between gap-2 px-4 lg:px-8">
        <div className="flex items-center gap-2 lg:hidden">
          <IconButton label="Abrir menú" onClick={() => setMenu(true)}><Bars3Icon className="h-5 w-5" /></IconButton>
          <Logo />
        </div>
        {/* En escritorio el condominio va a la izquierda de la barra; en el celular no cabe junto al resto y baja a su propia fila. */}
        <div className="hidden min-w-0 lg:block"><SelectorCondominio /></div>
        <div className="ml-auto flex items-center gap-1">
          {/* Las conversaciones del asistente son de su dueño: entrando como otra persona no se abren. */}
          {!user.impersonando && <IconButton label={chat.abierto ? 'Cerrar asistente' : 'Abrir asistente'} aria-pressed={chat.abierto} onClick={chat.alternar} className={chat.abierto ? '!text-brand' : undefined}><SparklesIcon className="h-5 w-5" /></IconButton>}
          <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
          <MenuUsuario user={user} onSalir={() => setConfirmarSalida(true)} />
        </div>
      </header>
      <div className="px-4 pb-2 empty:hidden lg:hidden"><SelectorCondominio /></div>
      {/* Banda de solo lectura (terminó el periodo gratis): fija con la barra, en todas las pantallas de la administración y la junta. */}
      <BandaSoloLectura />
      </div>

      {/* Hasta 1600 px el contenido ocupa el ancho de la ventana (antes 1152 px: en un monitor de 1920 quedaban tablas con scroll). */}
      <main id="contenido" className="mx-auto w-full max-w-[1600px] px-4 py-6 lg:px-8 lg:py-8">
        <InstalarApp />
        <Outlet />
      </main>
      </div>

      {!user.impersonando && <Assistant open={chat.abierto} onClose={chat.cerrar} escritorio={escritorio} barra={barra.ancho} />}
      {/* Un clic de más en «Cerrar sesión» sacaba de la app: se confirma antes de salir. */}
      <ConfirmDialog open={confirmarSalida} onClose={() => setConfirmarSalida(false)} onConfirm={salir} title={user.impersonando ? '¿Volver a tu cuenta?' : '¿Cerrar sesión?'} message={user.impersonando ? 'Dejas de ver Torre como esa persona y vuelves a tu cuenta de superadmin.' : 'Tendrás que volver a ingresar con tu correo y tu contraseña.'} confirmLabel={user.impersonando ? 'Volver a mi cuenta' : 'Cerrar sesión'} />
    </div>
  );
}
