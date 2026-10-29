import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { api, errorText } from '../../../api';
import { Button, Input, Modal, Select, TelefonoInput, useToast } from '../../../ui';

export interface FilaEmpresa {
  id: number;
  nombre: string;
  ruc: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  representante_legal: string | null;
  estado: string | null;
}

interface Form { nombre: string; ruc: string; direccion: string; telefono: string; email: string; representante_legal: string; estado: 'activa' | 'inactiva' }

const VACIO: Form = { nombre: '', ruc: '', direccion: '', telefono: '', email: '', representante_legal: '', estado: 'activa' };

/** Alta/edición de la empresa administradora: lo usa la lista (para el alta) y la ficha (para editar). */
export function ModalDeEmpresa({ empresa, onClose, onGuardado }: { empresa: FilaEmpresa | 'nueva' | null; onClose: () => void; onGuardado: () => void }) {
  const toast = useToast();
  const nueva = empresa === 'nueva';
  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<Form>({ defaultValues: VACIO });

  // El formulario se prepara al abrir el modal.
  useEffect(() => {
    if (!empresa) return;
    reset(empresa === 'nueva' ? VACIO : {
      nombre: empresa.nombre,
      ruc: empresa.ruc ?? '',
      direccion: empresa.direccion ?? '',
      telefono: empresa.telefono ?? '',
      email: empresa.email ?? '',
      representante_legal: empresa.representante_legal ?? '',
      estado: empresa.estado?.toLowerCase() === 'inactiva' ? 'inactiva' : 'activa',
    });
  }, [empresa, reset]);

  async function guardar(v: Form) {
    const body = {
      nombre: v.nombre.trim(),
      ruc: v.ruc,
      direccion: v.direccion.trim() || null,
      telefono: v.telefono.trim() || null,
      email: v.email.trim() || null,
      representante_legal: v.representante_legal.trim() || null,
      estado: v.estado,
    };
    try {
      await api(nueva ? '/api/empresas' : `/api/empresas/${(empresa as FilaEmpresa).id}`, { method: nueva ? 'POST' : 'PUT', json: body });
      toast.ok(nueva ? 'Empresa creada' : 'Cambios guardados');
      onGuardado();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={empresa !== null}
      onClose={onClose}
      title={nueva ? 'Nueva empresa' : 'Editar empresa'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{nueva ? 'Crear empresa' : 'Guardar cambios'}</Button></>}
    >
      <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Razón social" className="sm:col-span-2" autoComplete="organization" error={errors.nombre && 'Ingresa el nombre de la empresa'} {...register('nombre', { required: true, validate: v => v.trim().length > 0 })} />
        <Input
          label="RUC"
          inputMode="numeric"
          maxLength={11}
          hint="11 dígitos."
          error={errors.ruc && 'El RUC debe tener 11 dígitos'}
          {...register('ruc', { required: true, pattern: /^\d{11}$/ })}
        />
        <Select label="Estado" {...register('estado')}>
          <option value="activa">Activa</option>
          <option value="inactiva">Inactiva</option>
        </Select>
        <Input label="Dirección" className="sm:col-span-2" autoComplete="street-address" {...register('direccion')} />
        <Controller control={control} name="telefono" render={({ field }) => <TelefonoInput label="Teléfono" value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} name={field.name} />} />
        <Input label="Correo electrónico" type="email" error={errors.email && 'Ingresa un correo válido'} {...register('email', { pattern: /^\S+@\S+\.\S+$/ })} />
        <Input label="Representante legal" className="sm:col-span-2" {...register('representante_legal')} />
      </form>
    </Modal>
  );
}
