import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText, useResource, type Page } from '../../../../api';
import { Button, Input, Modal, Select, Textarea, useToast } from '../../../../ui';
import { useOpciones } from '../catalogo/opciones';
import { ESTADOS_UNIDAD, idONull, nombreTorre, type FilaUnidad, type FormUnidad, type Piso, type Torre } from './tipos';
import { etiquetaTipoUnidad, normalizarTipoUnidad, TIPOS_UNIDAD } from './tipoUnidad';

interface Props {
  unidad: FilaUnidad | 'nuevo' | null;
  /** Condominio fijo: la unidad pertenece a este condominio y no se puede cambiar. */
  complejoId?: number;
  complejoNombre?: string;
  onClose: () => void;
  onGuardada: () => void;
}

/** Alta/edición de una unidad. La torre y el piso dependen del condominio y de la torre. */
export function ModalDeUnidad({ unidad, complejoId, complejoNombre, onClose, onGuardada }: Props) {
  const toast = useToast();
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormUnidad>();
  const esNuevo = unidad === 'nuevo';
  const tipoElegido = watch('tipo');
  const complejoElegido = watch('complejo_id');
  const torreElegida = watch('estructura_id');
  const complejos = useOpciones(complejoId ? null : '/api/complejos');
  const propietarios = useOpciones('/api/usuarios?rol=propietario');
  const inquilinos = useOpciones('/api/usuarios?rol=inquilino');
  const torres = useResource<Page<Torre>>(complejoElegido ? `/api/estructuras?complejo_id=${complejoElegido}&pageSize=100` : null);
  const pisos = useResource<Page<Piso>>(torreElegida ? `/api/pisos?estructura_id=${torreElegida}&pageSize=100` : null);

  useEffect(() => {
    if (!unidad) return;
    reset(esNuevo
      ? { codigo: '', tipo: 'departamento', complejo_id: complejoId ? String(complejoId) : '', estructura_id: '', piso_id: '', descripcion: '', estado: 'activa', propietario_id: '', inquilino_id: '' }
      : {
          codigo: unidad.codigo, tipo: normalizarTipoUnidad(unidad.tipo), complejo_id: unidad.complejo_id ? String(unidad.complejo_id) : '',
          estructura_id: unidad.estructura_id ? String(unidad.estructura_id) : '', piso_id: unidad.piso_id ? String(unidad.piso_id) : '',
          descripcion: unidad.descripcion ?? '', estado: unidad.estado ?? 'activa',
          propietario_id: unidad.propietario_id ? String(unidad.propietario_id) : '', inquilino_id: unidad.inquilino_id ? String(unidad.inquilino_id) : '',
        });
  }, [unidad, esNuevo, complejoId, reset]);

  async function guardar(v: FormUnidad) {
    const body = {
      codigo: v.codigo.trim(), tipo: v.tipo, complejo_id: Number(v.complejo_id),
      estructura_id: idONull(v.estructura_id), piso_id: idONull(v.piso_id),
      descripcion: v.descripcion.trim() || null, estado: v.estado,
      propietario_id: idONull(v.propietario_id), inquilino_id: idONull(v.inquilino_id),
    };
    try {
      await api(esNuevo ? '/api/unidades' : `/api/unidades/${(unidad as FilaUnidad).id}`, { method: esNuevo ? 'POST' : 'PUT', json: body });
      toast.ok(esNuevo ? 'Unidad creada' : 'Cambios guardados');
      onGuardada();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={unidad !== null}
      onClose={onClose}
      title={esNuevo ? 'Nueva unidad' : 'Editar unidad'}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{esNuevo ? 'Crear unidad' : 'Guardar cambios'}</Button></>}
    >
      <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Código" placeholder="Ej. 101 o A-203" error={errors.codigo && 'Ingresa el código'} {...register('codigo', { required: true, validate: v => !!v.trim() })} />
        <Select label="Tipo" error={errors.tipo && 'Elige el tipo'} {...register('tipo', { required: true })}>
          {TIPOS_UNIDAD.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          {tipoElegido && !TIPOS_UNIDAD.some(t => t.value === tipoElegido) && <option value={tipoElegido}>{etiquetaTipoUnidad(tipoElegido)}</option>}
        </Select>
        {complejoId ? (
          <Input label="Condominio" value={complejoNombre ?? 'Este condominio'} disabled readOnly />
        ) : (
          <Select
            label="Condominio"
            error={errors.complejo_id && 'Elige el condominio'}
            hint={complejos.error ?? undefined}
            {...register('complejo_id', { required: true, onChange: () => { setValue('estructura_id', ''); setValue('piso_id', ''); } })}
          >
            <option value="">{complejos.loading ? 'Cargando…' : 'Selecciona un condominio'}</option>
            {complejos.opciones.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        )}
        <Select
          label="Torre"
          hint={torres.error ?? undefined}
          disabled={!complejoElegido || torres.loading}
          {...register('estructura_id', { onChange: () => setValue('piso_id', '') })}
        >
          <option value="">{!complejoElegido ? 'Elige primero el condominio' : torres.loading ? 'Cargando…' : 'Sin torre'}</option>
          {(torres.data?.items ?? []).map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
        </Select>
        <Select label="Piso" disabled={!torreElegida || pisos.loading} {...register('piso_id')}>
          <option value="">{!torreElegida ? 'Elige primero la torre' : pisos.loading ? 'Cargando…' : 'Sin piso'}</option>
          {(pisos.data?.items ?? []).map(p => <option key={p.id} value={p.id}>{p.numero != null ? `Piso ${p.numero}` : `Piso ${p.id}`}</option>)}
        </Select>
        <Select label="Estado" {...register('estado', { required: true })}>
          {ESTADOS_UNIDAD.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </Select>
        <Select label="Propietario" hint={propietarios.error ?? undefined} {...register('propietario_id')}>
          <option value="">{propietarios.loading ? 'Cargando…' : 'Sin asignar'}</option>
          {propietarios.opciones.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Select>
        <Select label="Inquilino" hint={inquilinos.error ?? undefined} {...register('inquilino_id')}>
          <option value="">{inquilinos.loading ? 'Cargando…' : 'Sin inquilino'}</option>
          {inquilinos.opciones.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Select>
        <Textarea label="Descripción" className="sm:col-span-2" {...register('descripcion')} />
      </form>
    </Modal>
  );
}
