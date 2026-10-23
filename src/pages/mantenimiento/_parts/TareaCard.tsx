import { useState } from 'react';
import { CheckIcon, PlayIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../api';
import { Button, Card, StatusBadge, fechaCorta, useToast } from '../../../ui';

export interface Tarea {
  id: number;
  titulo: string;
  descripcion: string | null;
  estado: string;
  fecha_creacion: string;
  unidad?: { id: number; codigo: string } | null;
}

type Estado = 'pendiente' | 'en_progreso' | 'completada';

/** Cambia el estado de una tarea (PATCH /api/tareas/:id/estado) con toast; devuelve el id en curso. */
export function useCambiarEstado(onDone: () => void) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);
  async function cambiar(t: Tarea, estado: Estado) {
    setBusyId(t.id);
    try {
      await api(`/api/tareas/${t.id}/estado`, { method: 'PATCH', json: { estado } });
      toast.ok(estado === 'en_progreso' ? `Iniciaste «${t.titulo}»` : `Completaste «${t.titulo}»`);
      onDone();
    } catch (e) { toast.error(errorText(e)); } finally { setBusyId(null); }
  }
  return { busyId, cambiar };
}

interface Props { tarea: Tarea; busy: boolean; onCambiar: (t: Tarea, estado: Estado) => void }

export function TareaCard({ tarea, busy, onCambiar }: Props) {
  const accion = tarea.estado === 'pendiente'
    ? { label: 'Iniciar', estado: 'en_progreso' as const, icon: <PlayIcon className="h-5 w-5" /> }
    : tarea.estado === 'en_progreso'
      ? { label: 'Marcar completada', estado: 'completada' as const, icon: <CheckIcon className="h-5 w-5" /> }
      : null;

  return (
    <Card>
      <article className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-base font-semibold">{tarea.titulo}</h3>
          <StatusBadge estado={tarea.estado} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {tarea.unidad ? <>Unidad <span className="num font-medium text-ink">{tarea.unidad.codigo}</span></> : 'Sin unidad asignada'}
          <span aria-hidden="true"> · </span>
          <span className="num">{fechaCorta(tarea.fecha_creacion)}</span>
        </p>
        {tarea.descripcion && <p className="mt-2 line-clamp-3 text-sm">{tarea.descripcion}</p>}
        {accion && (
          <Button
            className="mt-4 h-11 w-full sm:w-auto"
            variant={accion.estado === 'completada' ? 'primary' : 'secondary'}
            icon={accion.icon}
            loading={busy}
            onClick={() => onCambiar(tarea, accion.estado)}
          >
            {accion.label}
          </Button>
        )}
      </article>
    </Card>
  );
}
