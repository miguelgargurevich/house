import { useState } from 'react';
import type { ReactElement } from 'react';
import { ChartBarIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../api';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, TabPanel, Tabs } from '../../../ui';
import { EstadoCuentaModal } from '../../shared/estado-cuenta/EstadoCuentaModal';
import { PagosResidente } from './PagosResidente';
import { VistaAcumulado } from './HistorialAcumulado';
import { VistaAgua, VistaPuntualidad } from './HistorialAguaPuntualidad';
import { VistaPorConcepto } from './HistorialConceptos';
import { FiltrosHistorial } from './HistorialFiltros';
import { VistaResumen } from './HistorialGraficos';
import type { Historial } from './historial';

type Vista = 'resumen' | 'concepto' | 'acumulado' | 'agua' | 'puntualidad';
type Pestana = Vista | 'pagos';

/** Las pestañas de gráficos, en orden; comparten los filtros y la misma respuesta de la API. «Pagos» (la tabla) va al final. */
const VISTAS: { id: Vista; label: string; vista: (p: { data: Historial }) => ReactElement }[] = [
  { id: 'resumen', label: 'Resumen', vista: VistaResumen },
  { id: 'concepto', label: 'Por concepto', vista: VistaPorConcepto },
  { id: 'acumulado', label: 'Acumulado', vista: VistaAcumulado },
  { id: 'agua', label: 'Agua', vista: VistaAgua },
  { id: 'puntualidad', label: 'Puntualidad', vista: VistaPuntualidad },
];

export function HistorialResidente() {
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [unidad, setUnidad] = useState('');
  const [anio, setAnio] = useState('');
  const [estadoCuenta, setEstadoCuenta] = useState(false);
  const sp = new URLSearchParams();
  if (unidad) sp.set('unidad_id', unidad);
  if (anio) sp.set('anio', anio);
  const consulta = sp.toString() ? `?${sp}` : '';
  // `data` se conserva mientras llega la respuesta de un filtro nuevo: los selectores no desaparecen ni pierden el foco.
  const { data, loading, error, reload } = useResource<Historial>(`/api/me/historial${consulta}`);
  const graficos = pestana !== 'pagos';

  return (
    <>
      <PageHeader title="Mi historial"
        description="Cómo evolucionan tus pagos por concepto y acumulados, tu agua y tu puntualidad, con tus pagos al final."
        actions={data && data.unidades.length > 0 && <Button variant="secondary" icon={<DocumentTextIcon className="h-4 w-4" />} onClick={() => setEstadoCuenta(true)}>Estado de cuenta</Button>}
      />
      <div className="mb-6 max-w-full">
        <Tabs<Pestana> value={pestana} onChange={setPestana} idBase="historial" label="Secciones de tu historial" items={[...VISTAS.map(({ id, label }) => ({ id, label })), { id: 'pagos', label: 'Pagos' }]} />
      </div>

      {graficos && data && <FiltrosHistorial data={data} unidad={unidad} anio={anio} setUnidad={setUnidad} setAnio={setAnio} consulta={consulta} error={error} onRetry={reload} />}

      {VISTAS.map(({ id, vista: Cuerpo }) => (
        <TabPanel key={id} idBase="historial" id={id} value={pestana}>
          {error && !data ? (
            <Card><ErrorState message={error} onRetry={reload} /></Card>
          ) : !data ? (
            <div className="space-y-6" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>
          ) : (
            <div aria-busy={loading || undefined} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              {data.meses.length === 0
                ? <Card><EmptyState icon={<ChartBarIcon />} title="Aún no tienes recibos" description="Cuando la administración emita tu primer mantenimiento, aquí verás cuánto pagas cada mes." /></Card>
                : <Cuerpo data={data} />}
            </div>
          )}
        </TabPanel>
      ))}

      <TabPanel idBase="historial" id="pagos" value={pestana}>
        <PagosResidente />
      </TabPanel>

      {/* Con una unidad elegida arriba se abre ésa; con varias, la primera y el selector del modal para cambiar. */}
      <EstadoCuentaModal
        unidades={(data?.unidades ?? []).map(u => ({ id: u.id, codigo: u.codigo }))}
        unidadId={estadoCuenta && data && data.unidades.length > 0 ? Number(unidad) || data.unidades[0]!.id : null}
        onClose={() => setEstadoCuenta(false)}
      />
    </>
  );
}
