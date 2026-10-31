// El contenido de la banda de solo lectura, sin sesión ni API: lo prueban las pruebas de Node. La banda de verdad (`BandaSoloLectura.tsx`) le pone el estado y el rol.
import { Link } from 'react-router-dom';
import { ofertaDePago, textoBanda, type VistaSoloLectura } from './soloLectura';

/** Lo que dice la banda. La administración tiene el botón a Mi plan; la junta no cambia planes y se manda con su administración. */
export function ContenidoBanda({ v, junta }: { v: VistaSoloLectura; junta: boolean }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-warn-soft px-4 py-2 text-sm text-warn lg:px-8" data-banda="solo-lectura">
      <p className="min-w-0 flex-1">
        {textoBanda(v)}{' '}
        {junta ? 'Pídele a tu administración que lo pase a un plan de pago para seguir registrando.' : <>Pásalo a un plan de pago para seguir registrando: {ofertaDePago(v.basicoDesde)}.</>}
      </p>
      {!junta && <Link to="/admin/mi-plan" className="inline-flex h-9 shrink-0 items-center rounded bg-brand px-4 text-sm font-medium text-on-brand transition-colors duration-150 hover:bg-brand-hover">Ir a Mi plan</Link>}
    </div>
  );
}
