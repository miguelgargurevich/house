import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { cx } from '../ui';
import { Pista } from './Pista';
import type { NavGroup, NavItem } from './nav';
import { desplegado, esPlegable, grupoActivo, guardarAbiertos, leerAbiertos } from './menuGrupos';

const link = 'flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors duration-150';
const linkRiel = '!justify-center !gap-0 !px-0';
const estadoLink = ({ isActive }: { isActive: boolean }) => (isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface2 hover:text-ink');

function Entrada({ it, riel, enGrupo }: { it: NavItem; riel: boolean; enGrupo?: boolean }) {
  return (
    <li>
      <Pista texto={riel ? it.label : undefined}>
        <NavLink
          to={it.to}
          aria-label={riel ? it.label : undefined}
          className={(s) => cx(link, riel && linkRiel, enGrupo && '!py-1.5', estadoLink(s))}
        >
          <it.icon className={cx('shrink-0', enGrupo ? 'h-[18px] w-[18px]' : 'h-5 w-5')} />
          {!riel && <span className="truncate">{it.label}</span>}
        </NavLink>
      </Pista>
    </li>
  );
}

/**
 * Menú de la barra lateral, agrupado por área como el portal de dealers (9-nov, Miguel). Cada grupo con rótulo y más de una
 * entrada es una cabecera que se pliega; el de la pantalla actual se abre solo y los que la persona abre se recuerdan.
 * Con la barra colapsada (`riel`) la cabecera es un ícono que abre las entradas en un panel al costado.
 * Las rutas no cambian: sólo cómo se muestran.
 */
export function MenuLateral({ grupos, riel }: { grupos: NavGroup[]; riel: boolean }) {
  const { pathname } = useLocation();
  const activo = grupoActivo(grupos, pathname);
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(() => leerAbiertos());
  const [cerradoAMano, setCerradoAMano] = useState(false);
  const [flotante, setFlotante] = useState<{ grupo: string; top: number; left: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Al pasar a otra pantalla: el panel flotante se cierra y el grupo nuevo vuelve a abrirse solo.
  useEffect(() => { setFlotante(null); }, [pathname]);
  useEffect(() => { setCerradoAMano(false); }, [activo]);
  useEffect(() => { if (!riel) setFlotante(null); }, [riel]);

  useEffect(() => {
    if (!flotante) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (panel.current?.contains(t) || t?.closest?.('[data-grupo-cab]')) return;
      setFlotante(null);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setFlotante(null); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [flotante]);

  const alternar = (g: string, el: HTMLElement) => {
    if (riel) {
      const r = el.getBoundingClientRect();
      setFlotante(f => (f?.grupo === g ? null : { grupo: g, top: r.top, left: r.right + 8 }));
      return;
    }
    const abrir = !desplegado(g, abiertos, activo, cerradoAMano);
    const nuevos = new Set(abiertos);
    if (abrir) nuevos.add(g); else nuevos.delete(g);
    setAbiertos(nuevos);
    guardarAbiertos(nuevos);
    if (g === activo) setCerradoAMano(!abrir);
  };

  const grupoFlotante = flotante && grupos.find(g => g.label === flotante.grupo);

  return (
    <nav aria-label="Principal" className={cx('flex-1 overflow-y-auto py-3', riel ? 'space-y-1 px-2' : 'space-y-1 px-3')}>
      {grupos.map((g, i) => {
        if (!esPlegable(g)) {
          return <ul key={g.label ?? i} className={cx('space-y-0.5', i > 0 && 'pt-1')}>{g.items.map(it => <Entrada key={it.to} it={it} riel={riel} />)}</ul>;
        }
        const nombre = g.label!;
        const Icono = g.icon ?? g.items[0].icon;
        const abierto = !riel && desplegado(nombre, abiertos, activo, cerradoAMano);
        const conActivo = activo === nombre;
        const id = `grupo-menu-${i}`;
        return (
          <div key={nombre} className={cx(i > 0 && 'pt-1')}>
            <Pista texto={riel && flotante?.grupo !== nombre ? nombre : undefined}>
              <button
                type="button"
                data-grupo-cab=""
                onClick={(e) => alternar(nombre, e.currentTarget)}
                aria-expanded={riel ? flotante?.grupo === nombre : abierto}
                aria-controls={riel ? undefined : id}
                aria-label={riel ? nombre : undefined}
                className={cx(
                  link, 'w-full', riel && linkRiel,
                  // Plegado y con la pantalla actual adentro: la cabecera lo dice, para que no se pierda dónde estás.
                  conActivo && (riel || !abierto) ? 'bg-brand-soft text-brand' : 'text-ink/80 hover:bg-surface2 hover:text-ink',
                  riel && flotante?.grupo === nombre && 'bg-surface2 text-ink',
                )}
              >
                <Icono className="h-5 w-5 shrink-0" />
                {!riel && <span className="flex-1 truncate text-left font-semibold">{nombre}</span>}
                {!riel && <ChevronDownIcon aria-hidden="true" className={cx('h-4 w-4 shrink-0 text-muted transition-transform duration-150', abierto && 'rotate-180')} />}
              </button>
            </Pista>
            {abierto && (
              <ul id={id} className="mb-1 ml-[1.375rem] mt-0.5 space-y-0.5 border-l border-line pl-2">
                {g.items.map(it => <Entrada key={it.to} it={it} riel={false} enGrupo />)}
              </ul>
            )}
          </div>
        );
      })}
      {/* Barra colapsada: las entradas del grupo, en un panel al costado. Va en `document.body`, como la Pista, para no quedar debajo de la cabecera. */}
      {flotante && grupoFlotante && createPortal(
        <div
          ref={panel}
          role="menu"
          aria-label={grupoFlotante.label}
          style={{ top: Math.max(8, Math.min(flotante.top, window.innerHeight - 48 - grupoFlotante.items.length * 36)), left: flotante.left }}
          className="fixed z-[60] min-w-[13rem] rounded-lg border border-line bg-surface p-1.5 shadow-pop"
        >
          <p className="px-3 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted">{grupoFlotante.label}</p>
          <ul className="space-y-0.5">
            {grupoFlotante.items.map(it => (
              <li key={it.to}>
                <NavLink to={it.to} role="menuitem" onClick={() => setFlotante(null)} className={(s) => cx(link, '!py-1.5', estadoLink(s))}>
                  <it.icon className="h-[18px] w-[18px] shrink-0" />{it.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </nav>
  );
}
