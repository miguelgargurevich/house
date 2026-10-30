import { useForm } from 'react-hook-form';
import { useCondominio } from '../../../../app/condominio';
import { api, errorText, useResource } from '../../../../api';
import { Button, ErrorState, Input, Modal, Select, Skeleton, Textarea, useToast } from '../../../../ui';
import type { Lista } from './comun';

export interface Tarea {
  id: number;
  titulo: string;
  descripcion: string | null;
  estado: string;
  fecha_creacion: string;
  unidad?: { id: number; codigo: string } | null;
  asignado?: { id: number; nombre: string } | null;
}

interface UnidadOpcion { id: number; codigo: string; complejo?: { nombre: string } | null }
interface Personal { id: number; nombre: string }
interface Form { titulo: string; descripcion: string; unidad_id: string; asignado_id: string }

export function TareaModal({ tarea, onClose, onSaved }: { tarea: Tarea | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  // Las unidades que se ofrecen son las del condominio elegido arriba (o todas con «Todos los condominios»).
  const { complejo } = useCondominio();
  const unidades = useResource<Lista<UnidadOpcion>>(`/api/unidades?pageSize=100${complejo ? `&complejo_id=${complejo}` : ''}`);
  const personal = useResource<Lista<Personal>>('/api/usuarios?rol=mantenimiento&pageSize=100');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    defaultValues: {
      titulo: tarea?.titulo ?? '',
      descripcion: tarea?.descripcion ?? '',
      unidad_id: tarea?.unidad ? String(tarea.unidad.id) : '',
      asignado_id: tarea?.asignado ? String(tarea.asignado.id) : '',
    },
  });

  const cargando = unidades.loading || personal.loading;
  const error = unidades.error ?? personal.error;

  async function guardar(v: Form) {
    try {
      await api(tarea ? `/api/tareas/${tarea.id}` : '/api/tareas', {
        method: tarea ? 'PUT' : 'POST',
        json: {
          titulo: v.titulo.trim(),
          descripcion: v.descripcion.trim() || null,
          unidad_id: v.unidad_id ? Number(v.unidad_id) : null,
          asignado_id: v.asignado_id ? Number(v.asignado_id) : null,
        },
      });
      toast.ok(tarea ? 'Cambios guardados' : 'Tarea creada');
      onSaved();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tarea ? 'Editar tarea' : 'Nueva tarea'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={isSubmitting} disabled={cargando || !!error} onClick={handleSubmit(guardar)}>{tarea ? 'Guardar cambios' : 'Crear tarea'}</Button>
        </>
      }
    >
      {cargando ? (
        <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-10 w-full" /></div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => { void unidades.reload(); void personal.reload(); }} />
      ) : (
        <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input label="Título" className="sm:col-span-2" placeholder="Ej. Revisar fuga en el baño" error={errors.titulo && 'Ingresa un título'} {...register('titulo', { required: true, validate: v => v.trim().length > 0 })} />
          <Textarea label="Descripción (opcional)" className="sm:col-span-2" {...register('descripcion')} />
          <Select label="Unidad (opcional)" hint="Déjala vacía si es un área común." {...register('unidad_id')}>
            <option value="">Sin unidad</option>
            {(unidades.data?.items ?? []).map(u => <option key={u.id} value={u.id}>{u.codigo}{u.complejo ? ` · ${u.complejo.nombre}` : ''}</option>)}
          </Select>
          <Select label="Asignar a (opcional)" hint={(personal.data?.items.length ?? 0) === 0 ? 'No hay personal de mantenimiento registrado.' : undefined} {...register('asignado_id')}>
            <option value="">Sin asignar</option>
            {(personal.data?.items ?? []).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Select>
        </form>
      )}
    </Modal>
  );
}
