import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Select } from '../../../ui';
import type { Historial } from './historial';

export interface FiltrosHistorialProps {
  data: Historial;
  unidad: string;
  anio: string;
  setUnidad: (v: string) => void;
  setAnio: (v: string) => void;
  /** `?unidad_id=…&anio=…` (o vacío): el Excel se baja con lo mismo que se ve. */
  consulta: string;
  error: string | null;
  onRetry: () => void;
}

/** Unidad y periodo, compartidos por todas las pestañas de gráficos (una sola llamada a la API). El Excel y un error al cambiar de filtro viven aquí. */
export function FiltrosHistorial({ data, unidad, anio, setUnidad, setAnio, consulta, error, onRetry }: FiltrosHistorialProps) {
  const hayMeses = data.meses.length > 0;
  const hayFiltros = data.unidades.length > 1 || data.anios.length > 1 || hayMeses;
  if (!hayFiltros && !error) return null;
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {data.unidades.length > 1 && (
          <Select label="Unidad" value={unidad} onChange={e => setUnidad(e.target.value)} className="w-full sm:w-56">
            <option value="">Todas mis unidades</option>
            {data.unidades.map(u => <option key={u.id} value={u.id}>{u.codigo}{u.estructura?.nombre ? ` · ${u.estructura.nombre}` : ''}</option>)}
          </Select>
        )}
        {data.anios.length > 1 && (
          <Select label="Periodo" value={anio} onChange={e => setAnio(e.target.value)} className="w-full sm:w-56">
            <option value="">Últimos 12 meses</option>
            {data.anios.map(a => <option key={a} value={a}>{a}</option>)}
          </Select>
        )}
        {hayMeses && (
          <Button variant="secondary" icon={<ArrowDownTrayIcon className="h-4 w-4" />} onClick={() => window.location.assign(`/api/me/historial.xlsx${consulta}`)}>
            Descargar Excel
          </Button>
        )}
      </div>
      {error && <Alert tone="bad">{error} <button type="button" className="font-medium underline" onClick={onRetry}>Reintentar</button></Alert>}
    </div>
  );
}
