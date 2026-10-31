import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import type { CondominioOpcion } from '../../../../app/condominio';
import { Button, Input, Modal, Select, Textarea, useToast } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';
import type { AreaComun } from '../../../shared/_parts/reservas/tipos';
import { minutosDe } from '../../../shared/_parts/reservas/tipos';

interface Form {
  complejo_id: string;
  nombre: string;
  descripcion: string;
  capacidad: string;
  hora_apertura: string;
  hora_cierre: string;
  duracion_max_horas: string;
  dias_anticipacion_max: string;
  requiere_aprobacion: boolean;
}

interface Props {
  /** `'nueva'` abre el formulario vacío; un área la edita; `null` lo cierra. */
  area: AreaComun | 'nueva' | null;
  condominios: CondominioOpcion[];
  /** Condominio elegido en la pantalla: valor inicial del área nueva. */
  inicial: string;
  onClose: () => void;
  onSaved: () => void;
}

const vacio = (condominios: CondominioOpcion[], inicial: string): Form => ({
  complejo_id: inicial || (condominios.length === 1 ? String(condominios[0]!.id) : ''),
  nombre: '', descripcion: '', capacidad: '', hora_apertura: '08:00', hora_cierre: '22:00', duracion_max_horas: '2', dias_anticipacion_max: '30', requiere_aprobacion: false,
});

/** Crear o editar un área común. El condominio sólo se elige al crear. Horario y días se leen en la zona horaria del condominio. */
export function AreaModal({ area, condominios, inicial, onClose, onSaved }: Props) {
  const toast = useToast();
  const nueva = area === 'nueva';
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Form>();
  useEffect(() => {
    if (area === null) return;
    reset(area === 'nueva' ? vacio(condominios, inicial) : {
      complejo_id: String(area.complejo_id), nombre: area.nombre, descripcion: area.descripcion ?? '', capacidad: area.capacidad != null ? String(area.capacidad) : '',
      hora_apertura: area.hora_apertura, hora_cierre: area.hora_cierre, duracion_max_horas: String(area.duracion_max_horas), dias_anticipacion_max: String(area.dias_anticipacion_max), requiere_aprobacion: area.requiere_aprobacion,
    });
    // Sólo al abrir: la lista de fondo cambia y no debe pisar lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  const apertura = watch('hora_apertura');

  async function guardar(v: Form) {
    const cuerpo = {
      nombre: v.nombre.trim(),
      descripcion: v.descripcion.trim() || null,
      capacidad: v.capacidad.trim() ? Number(v.capacidad) : null,
      hora_apertura: v.hora_apertura,
      hora_cierre: v.hora_cierre,
      duracion_max_horas: Number(v.duracion_max_horas),
      dias_anticipacion_max: Number(v.dias_anticipacion_max),
      requiere_aprobacion: !!v.requiere_aprobacion,
    };
    try {
      if (nueva) {
        await api('/api/areas-comunes', { method: 'POST', json: { ...cuerpo, complejo_id: Number(v.complejo_id) } });
        toast.ok('Área creada: ya se puede reservar');
      } else if (area) {
        await api(`/api/areas-comunes/${area.id}`, { method: 'PATCH', json: cuerpo });
        toast.ok('Cambios guardados');
      }
      onSaved();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={area !== null}
      onClose={onClose}
      size="lg"
      title={nueva ? 'Nueva área común' : 'Editar área común'}
      description="Los cambios rigen para las reservas nuevas; las que ya existen no se tocan. El horario se lee en la zona horaria del condominio."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{nueva ? 'Crear área' : 'Guardar cambios'}</Button></>}
    >
      <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {nueva && condominios.length !== 1 && (
          <Select label="Condominio" className="sm:col-span-2" error={errors.complejo_id && 'Elige el condominio'} {...register('complejo_id', { required: true })}>
            <option value="">Elige un condominio</option>
            {condominios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        )}
        {!nueva && area && <p className="text-sm text-muted sm:col-span-2">Condominio: <span className="font-medium text-ink">{area.complejo.nombre}</span></p>}
        <Input label="Nombre" className="sm:col-span-2" maxLength={80} placeholder="Salón de eventos, parrilla, piscina…" error={errors.nombre && 'Escribe el nombre'} {...register('nombre', { required: true, validate: v => !!v.trim() })} />
        <Textarea label="Descripción (opcional)" className="sm:col-span-2" rows={2} maxLength={500} hint="Qué incluye, reglas de uso, a quién avisar." {...register('descripcion')} />
        <Input label="Abre a las" type="time" error={errors.hora_apertura && 'Indica la hora de apertura'} {...register('hora_apertura', { required: true })} />
        <Input label="Cierra a las" type="time" error={errors.hora_cierre?.type === 'validate' ? 'Debe ser posterior a la apertura' : errors.hora_cierre && 'Indica la hora de cierre'}
          {...register('hora_cierre', { required: true, validate: v => !apertura || minutosDe(v) > minutosDe(apertura) })} />
        <Input label="Duración máxima (horas)" type="number" inputMode="numeric" min={1} max={24} error={errors.duracion_max_horas && 'Entre 1 y 24 horas'}
          {...register('duracion_max_horas', { required: true, min: 1, max: 24, validate: v => Number.isInteger(Number(v)) })} />
        <Input label="Anticipación máxima (días)" type="number" inputMode="numeric" min={1} max={365} hint="Hasta cuántos días por delante se puede reservar." error={errors.dias_anticipacion_max && 'Entre 1 y 365 días'}
          {...register('dias_anticipacion_max', { required: true, min: 1, max: 365, validate: v => Number.isInteger(Number(v)) })} />
        <Input label="Capacidad (opcional)" type="number" inputMode="numeric" min={1} hint="Personas que admite; es sólo informativo." error={errors.capacidad && 'Un número entero mayor que cero'}
          {...register('capacidad', { validate: v => !v.trim() || (Number.isInteger(Number(v)) && Number(v) >= 1) })} />
        <Interruptor label="Requiere aprobación" hint="Con esto activado, cada reserva queda pendiente hasta que la administración la apruebe. Sin él, se confirma al instante." className="sm:col-span-2" {...register('requiere_aprobacion')} />
      </form>
    </Modal>
  );
}
