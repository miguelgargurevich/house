/** @jsxRuntime automatic */
// Piezas sin red ni API (se pueden importar desde los tests): el marcador de «por confirmar» y el tipo de sección.
import type { ReactNode } from 'react';

export const POR_CONFIRMAR = 'por confirmar';

export interface Seccion { id: string; titulo: string; cuerpo: ReactNode }

/** Un dato del responsable o un texto pendiente. Si falta, se ve «por confirmar» resaltado (no se esconde ni se inventa). */
export function Dato({ valor, cargando = false }: { valor: string | null | undefined; cargando?: boolean }) {
  if (cargando) return <span aria-busy="true" className="text-muted">…</span>;
  if (valor && valor !== POR_CONFIRMAR) return <>{valor}</>;
  return <span className="rounded bg-warn-soft px-1 font-medium text-warn">{POR_CONFIRMAR}</span>;
}
