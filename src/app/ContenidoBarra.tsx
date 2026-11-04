// El contenido de la barra de «Entrar como», sin sesión ni API: lo prueban las pruebas de Node. La barra de verdad (`BarraImpersonacion.tsx`) le pone el estado.
import { ArrowUturnLeftIcon, EyeIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui';
import { quedanTexto } from '../auth/impersonacion-lib';

interface Props { nombre: string; rotulo: string; minutos: number; saliendo: boolean; error: string | null; onVolver: () => void }

/** Barra fija mientras dura la sesión prestada. No se puede cerrar: sólo «Volver a mi cuenta». Colores de advertencia (`warn`), legibles en claro y oscuro. */
export function ContenidoBarra({ nombre, rotulo, minutos, saliendo, error, onVolver }: Props) {
  return (
    <div role="region" aria-label="Sesión de soporte" className="border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn lg:px-8" data-barra="impersonacion">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <EyeIcon className="hidden h-5 w-5 shrink-0 sm:block" aria-hidden="true" />
        <p className="min-w-0 flex-1 basis-60 font-medium">
          Estás viendo Torre como <strong className="font-semibold">{nombre}</strong>
          <span aria-hidden="true"> · </span><span className="sr-only">, </span>{rotulo}
          <span aria-hidden="true"> · </span><span className="sr-only">, </span><span className="num" aria-live="off">{quedanTexto(minutos)}</span>
        </p>
        <Button size="sm" variant="secondary" onClick={onVolver} loading={saliendo} icon={<ArrowUturnLeftIcon className="h-4 w-4" aria-hidden="true" />} className="w-full sm:w-auto">
          Volver a mi cuenta
        </Button>
      </div>
      {error && <p role="alert" className="mt-1.5 font-medium">{error}</p>}
    </div>
  );
}
