import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { useList } from '../../api';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../../ui';
import { TareaCard, useCambiarEstado } from './_parts/TareaCard';
import type { Tarea } from './_parts/TareaCard';

type Estado = 'pendiente' | 'en_progreso' | 'completada';

const TABS: { id: Estado; label: string }[] = [
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'en_progreso', label: 'En progreso' },
  { id: 'completada', label: 'Completadas' },
];
const VACIO: Record<Estado, { title: string; description: string }> = {
  pendiente: { title: 'No tienes tareas pendientes', description: 'Cuando la administración te asigne una tarea, aparecerá aquí para que la inicies.' },
  en_progreso: { title: 'No tienes tareas en progreso', description: 'Inicia una tarea desde «Pendientes» y la verás aquí hasta que la completes.' },
  completada: { title: 'Aún no completaste tareas', description: 'Las tareas que marques como completadas quedarán en este historial.' },
};

export default function Tareas() {
  const [estado, setEstado] = useState<Estado>('pendiente');
  const list = useList<Tarea>('/api/tareas', { pageSize: 10, params: { estado, orden: 'fecha_creacion:desc' } });
  const { busyId, cambiar } = useCambiarEstado(() => void list.reload());
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <>
      <PageHeader title="Mis tareas" description="Trabajos que te asignó la administración." />
      <div className="mb-4 max-w-full overflow-x-auto"><Tabs value={estado} onChange={setEstado} items={TABS} /></div>

      {list.error ? (
        <Card><ErrorState message={list.error} onRetry={list.reload} /></Card>
      ) : list.loading ? (
        <div className="space-y-3" aria-busy="true">{[0, 1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : list.items.length === 0 ? (
        <Card><EmptyState icon={<WrenchScrewdriverIcon />} {...VACIO[estado]} /></Card>
      ) : (
        <>
          <ul className="space-y-3">
            {list.items.map(t => (
              <li key={t.id}><TareaCard tarea={t} busy={busyId === t.id} onCambiar={cambiar} /></li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
              <Button variant="secondary" icon={<ChevronLeftIcon className="h-4 w-4" />} disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)}>Anterior</Button>
              <span className="num">{list.page} / {pages}</span>
              <Button variant="secondary" disabled={list.page >= pages} onClick={() => list.setPage(list.page + 1)}>Siguiente<ChevronRightIcon className="h-4 w-4" /></Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
