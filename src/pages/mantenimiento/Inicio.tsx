import { Link } from 'react-router-dom';
import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useList, useResource } from '../../api';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatStrip } from '../../ui';
import { TareaCard, useCambiarEstado } from './_parts/TareaCard';
import type { Tarea } from './_parts/TareaCard';

interface Resumen { tareas_pendientes: number; en_progreso: number; completadas: number }

export default function Inicio() {
  const resumen = useResource<Resumen>('/api/dashboard/resumen');
  const tareas = useList<Tarea>('/api/tareas', { pageSize: 10, params: { orden: 'fecha_creacion:desc' } });
  const { busyId, cambiar } = useCambiarEstado(() => { void resumen.reload(); void tareas.reload(); });
  const abiertas = tareas.items.filter(t => t.estado !== 'completada').slice(0, 3);
  const d = resumen.data;

  return (
    <>
      <PageHeader title="Inicio" description="Tu trabajo de mantenimiento de un vistazo." />
      {resumen.error ? (
        <Card className="mb-6"><ErrorState message={resumen.error} onRetry={resumen.reload} /></Card>
      ) : resumen.loading || !d ? (
        <Skeleton className="mb-6 h-24 w-full" />
      ) : (
        <StatStrip
          stats={[
            { label: 'Pendientes', value: d.tareas_pendientes, tone: d.tareas_pendientes > 0 ? 'warn' : undefined },
            { label: 'En progreso', value: d.en_progreso },
            { label: 'Completadas', value: d.completadas, tone: 'ok' },
          ]}
        />
      )}

      <Card>
        <CardHeader
          title="Tareas recientes"
          description="Las últimas que siguen abiertas."
          action={<Link to="/mantenimiento/tareas" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-brand hover:underline">Ver todas <ArrowRightIcon className="h-4 w-4" /></Link>}
        />
        {tareas.error ? (
          <ErrorState message={tareas.error} onRetry={tareas.reload} />
        ) : tareas.loading ? (
          <CardBody className="space-y-3" aria-busy="true">{[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full" />)}</CardBody>
        ) : abiertas.length === 0 ? (
          <EmptyState icon={<CheckCircleIcon />} title="Estás al día" description="No tienes tareas abiertas. Cuando te asignen una nueva, la verás aquí." />
        ) : (
          <ul className="space-y-3 p-5">
            {abiertas.map(t => <li key={t.id}><TareaCard tarea={t} busy={busyId === t.id} onCambiar={cambiar} /></li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
