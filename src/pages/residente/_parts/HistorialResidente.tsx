import { useState } from 'react';
import { useResource } from '../../../api';
import { Card, ErrorState, PageHeader, Skeleton, TabPanel, Tabs } from '../../../ui';
import { PagosResidente } from './PagosResidente';
import { VistaResumen } from './HistorialGraficos';
import type { Historial } from './historial';

type Pestana = 'resumen' | 'pagos';

export function HistorialResidente() {
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [unidad, setUnidad] = useState('');
  const [anio, setAnio] = useState('');
  const sp = new URLSearchParams();
  if (unidad) sp.set('unidad_id', unidad);
  if (anio) sp.set('anio', anio);
  const consulta = sp.toString() ? `?${sp}` : '';
  // `data` se conserva mientras llega la respuesta de un filtro nuevo: los selectores no desaparecen ni pierden el foco.
  const { data, loading, error, reload } = useResource<Historial>(`/api/me/historial${consulta}`);

  return (
    <>
      <PageHeader title="Mi historial" description="Cuánto pagas cada mes, cómo se mueve tu consumo de agua y qué tan puntual eres, con tus pagos al final." />
      <div className="mb-6">
        <Tabs<Pestana> value={pestana} onChange={setPestana} idBase="historial" label="Secciones de tu historial" items={[{ id: 'resumen', label: 'Resumen' }, { id: 'pagos', label: 'Pagos' }]} />
      </div>

      <TabPanel idBase="historial" id="resumen" value={pestana}>
        {error && !data ? (
          <Card><ErrorState message={error} onRetry={reload} /></Card>
        ) : !data ? (
          <div className="space-y-6" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>
        ) : (
          <VistaResumen data={data} loading={loading} error={error} onRetry={reload} unidad={unidad} anio={anio} setUnidad={setUnidad} setAnio={setAnio} consulta={consulta} />
        )}
      </TabPanel>

      <TabPanel idBase="historial" id="pagos" value={pestana}>
        <PagosResidente />
      </TabPanel>
    </>
  );
}
