import type { ReactNode } from 'react';
import { useSoloLectura } from './soloLectura';

/**
 * Envuelve el botón de una acción que crea trabajo: con el condominio en solo lectura lo desactiva y muestra el motivo al pasar el puntero (un botón
 * desactivado no recibe el puntero, así que el `title` va en el contenedor). Uso: `<Bloqueable>{b => <Button disabled={b}>Nuevo</Button>}</Bloqueable>`.
 */
export function Bloqueable({ children }: { children: (bloqueado: boolean) => ReactNode }) {
  const v = useSoloLectura();
  return <span className="inline-flex" title={v.motivo}>{children(v.soloLectura)}</span>;
}
