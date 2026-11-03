import { useEffect, useState } from 'react';
import { ArrowDownTrayIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../api';
import { Button, ErrorState, Modal, Select, Skeleton } from '../../../ui';
import { ZonaImprimible } from '../mantenimiento/ZonaImprimible';
import { EstadoCuentaHoja } from './EstadoCuentaHoja';
import { consultaDeRango, type EstadoCuenta, type RangoEstadoCuenta, type UnidadElegible } from './tipos';

interface Props {
  /** Los departamentos que se pueden elegir (con más de uno aparece el selector). */
  unidades: UnidadElegible[];
  /** El departamento a abrir; `null` = cerrado. */
  unidadId: number | null;
  onClose: () => void;
}

/** «Estado de cuenta» de un departamento: cuenta corriente mes a mes, con Excel e impresión (PDF del navegador). Lo usan la administración y el residente. */
export function EstadoCuentaModal({ unidades, unidadId, onClose }: Props) {
  const [elegida, setElegida] = useState<number | null>(null);
  const [rango, setRango] = useState<RangoEstadoCuenta>('ultimos');
  useEffect(() => { setElegida(null); setRango('ultimos'); }, [unidadId]);
  const id = unidadId === null ? null : elegida ?? unidadId;
  const anio = new Date().getFullYear();
  const consulta = consultaDeRango(rango, anio);
  const { data, loading, error, reload } = useResource<EstadoCuenta>(id === null ? null : `/api/estado-cuenta/unidades/${id}${consulta}`);
  const listo = data !== null && data !== undefined && data.unidad.id === id;
  const codigo = unidades.find(u => u.id === id)?.codigo;

  return (
    <Modal
      open={unidadId !== null}
      onClose={onClose}
      size="lg"
      title={`Estado de cuenta${codigo ? ` · ${codigo}` : ''}`}
      description="Lo cargado, lo pagado y lo que se debe, mes a mes."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button variant="secondary" icon={<ArrowDownTrayIcon className="h-4 w-4" />} disabled={!listo} onClick={() => window.location.assign(`/api/estado-cuenta/unidades/${id}/estado-cuenta.xlsx${consulta}`)}>Excel</Button>
          <Button icon={<PrinterIcon className="h-4 w-4" />} disabled={!listo} onClick={() => window.print()}>Imprimir</Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {unidades.length > 1 && (
          <Select label="Departamento" value={String(id ?? '')} onChange={ev => setElegida(Number(ev.target.value))} className="w-full sm:w-56">
            {unidades.map(u => <option key={u.id} value={u.id}>{u.codigo}</option>)}
          </Select>
        )}
        <Select label="Periodo" value={rango} onChange={ev => setRango(ev.target.value as RangoEstadoCuenta)} className="w-full sm:w-56">
          <option value="ultimos">Últimos 12 meses</option>
          <option value="anio">Año {anio}</option>
          <option value="anio_pasado">Año {anio - 1}</option>
          <option value="todo">Todo el historial</option>
        </Select>
      </div>
      {error && !listo ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !listo ? (
        <div aria-busy="true" className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <div aria-busy={loading || undefined} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <EstadoCuentaHoja e={data} />
          <ZonaImprimible><EstadoCuentaHoja e={data} /></ZonaImprimible>
        </div>
      )}
    </Modal>
  );
}
