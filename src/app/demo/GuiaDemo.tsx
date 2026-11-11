import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ArrowTopRightOnSquareIcon, PlayCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { IconButton, cx } from '../../ui';
import { GUIA, enlaceDeVideo } from './guia';
import { TITULO_DE_ROL, type RolDemo } from './roles';

/**
 * «Qué probar»: los pasos del rol, cada uno con su casilla, su pantalla y, si el manual tiene el video corto de esa pantalla, su enlace.
 * Es una tarjeta flotante abajo a la derecha; no tapa la navegación y se cierra con su botón (la franja de arriba la vuelve a abrir).
 */
export function GuiaDemo({ rol, urlManual, marcadas, onAlternar, onLimpiar, onCerrar }: {
  rol: RolDemo;
  urlManual: string | null;
  marcadas: ReadonlySet<string>;
  onAlternar: (id: string) => void;
  onLimpiar: () => void;
  onCerrar: () => void;
}) {
  const pasos = GUIA[rol];
  const hechos = pasos.filter((p) => marcadas.has(p.id)).length;
  // Va en `document.body`: la cabecera de la app tiene `backdrop-blur`, que encierra a sus hijos `fixed` y los dejaría pegados arriba.
  const tarjeta = (
    <aside
      role="complementary"
      aria-label="Qué probar en la demo"
      className="fixed bottom-4 right-4 z-40 flex max-h-[min(34rem,calc(100vh-7rem))] w-[22rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-line bg-surface shadow-pop"
    >
      <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Qué probar</h2>
          <p className="truncate text-xs text-muted">{TITULO_DE_ROL[rol]} · {hechos} de {pasos.length}</p>
        </div>
        <IconButton label="Cerrar la guía" onClick={onCerrar} className="-mr-2 -mt-1"><XMarkIcon className="h-5 w-5" /></IconButton>
      </header>
      <ol className="space-y-1 overflow-y-auto px-2 py-2">
        {pasos.map((p, i) => {
          const video = enlaceDeVideo(urlManual, p);
          const listo = marcadas.has(p.id);
          return (
            <li key={p.id} className="flex gap-2 rounded-lg px-2 py-2 hover:bg-surface2">
              <input
                id={`paso-${p.id}`}
                type="checkbox"
                checked={listo}
                onChange={() => onAlternar(p.id)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand,#0f766e)]"
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={`paso-${p.id}`} className={cx('block cursor-pointer text-sm font-medium', listo && 'text-muted line-through')}>{i + 1}. {p.texto}</label>
                {p.ayuda && <p className="mt-0.5 text-xs leading-snug text-muted">{p.ayuda}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <Link to={p.ruta} className="inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline">Ir a la pantalla</Link>
                  {video && (
                    <a href={video} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline">
                      <PlayCircleIcon className="h-4 w-4" aria-hidden="true" />Ver video<ArrowTopRightOnSquareIcon className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (se abre en otra pestaña)</span>
                    </a>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
        <span>{hechos === pasos.length ? 'Listo: probaste todo.' : 'Tus casillas se guardan en este navegador.'}</span>
        {hechos > 0 && <button type="button" onClick={onLimpiar} className="font-medium text-brand underline-offset-2 hover:underline">Empezar de nuevo</button>}
      </footer>
    </aside>
  );
  return typeof document === 'undefined' ? tarjeta : createPortal(tarjeta, document.body);
}
