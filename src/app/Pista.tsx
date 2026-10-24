import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip del riel de iconos: sale con el mouse y también con el foco del teclado. Va `fixed` (no `absolute`) porque la lista de la barra
 * hace scroll y recortaría un tooltip posicionado dentro de ella. Es decorativo (`aria-hidden`): el nombre accesible lo da `aria-label`
 * del control. Sin `texto` no hace nada (barra expandida).
 * Se dibuja en `document.body` (portal): la barra tiene `z-20`, que crea su propio contexto de apilamiento, y el `z-[60]` del tooltip
 * quedaba encerrado ahí, DEBAJO de la cabecera (`z-30`, translúcida y con blur): se veía borroso (24-oct, Miguel).
 */
export function Pista({ texto, children }: { texto?: string; children: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  if (!texto) return <>{children}</>;
  const mostrar = (el: HTMLElement) => { const r = el.getBoundingClientRect(); setPos({ top: r.top + r.height / 2, left: r.right + 8 }); };
  return (
    <div
      onMouseEnter={(e) => mostrar(e.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={(e) => mostrar(e.currentTarget)}
      onBlur={() => setPos(null)}
      onKeyDown={(e) => { if (e.key === 'Escape') setPos(null); }}
    >
      {children}
      {pos && createPortal(
        <span
          aria-hidden="true"
          style={{ top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs font-medium text-bg shadow-pop"
        >
          {texto}
        </span>,
        document.body,
      )}
    </div>
  );
}
