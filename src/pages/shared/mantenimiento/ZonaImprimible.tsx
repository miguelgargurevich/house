import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Lo que sale al imprimir (recibo o comprobante). Va al final de <body>, fuera de #root (la app y los modales):
 * en pantalla queda oculto y al imprimir el CSS («Impresión» en index.css) oculta todo lo demás con display:none.
 */
export function ZonaImprimible({ children }: { children: ReactNode }) {
  return createPortal(<div id="zona-imprimible" className="text-ink">{children}</div>, document.body);
}
