import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { BuildingOffice2Icon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  Button, Card, CardBody, CardHeader, DefinitionList, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton, StatusBadge, useToast,
} from '../../ui';

interface Empresa {
  id: number;
  nombre: string;
  ruc: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  representante_legal: string | null;
  estado: string | null;
}
interface Form { nombre: string; ruc: string; direccion: string; telefono: string; email: string; representante_legal: string }

export default function Configuracion() {
  const { user } = useAuth();
  const toast = useToast();
  const empresaId = user?.empresa_id ?? null;
  const { data, loading, error, reload } = useResource<Empresa>(empresaId ? `/api/empresas/${empresaId}` : null);
  const [abierto, setAbierto] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>();

  function abrir() {
    if (!data) return;
    reset({
      nombre: data.nombre, ruc: data.ruc ?? '', direccion: data.direccion ?? '', telefono: data.telefono ?? '',
      email: data.email ?? '', representante_legal: data.representante_legal ?? '',
    });
    setAbierto(true);
  }

  async function guardar(v: Form) {
    const body = {
      nombre: v.nombre.trim(), ruc: v.ruc.trim() || null, direccion: v.direccion.trim() || null, telefono: v.telefono.trim() || null,
      email: v.email.trim() || null, representante_legal: v.representante_legal.trim() || null,
    };
    try {
      await api(`/api/empresas/${empresaId}`, { method: 'PUT', json: body });
      toast.ok('Datos de la empresa guardados');
      setAbierto(false);
      void reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  const descripcion = 'Los datos de tu empresa administradora, tal como aparecen en recibos y comunicaciones.';

  if (!empresaId) {
    return (
      <>
        <PageHeader title="Mi empresa" description={descripcion} />
        <Card>
          <EmptyState
            icon={<BuildingOffice2Icon />}
            title="Tu usuario no tiene una empresa asignada"
            description="Pide a un superadministrador que te asocie a una empresa administradora para poder ver y editar sus datos aquí."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Mi empresa"
        description={descripcion}
        actions={<Button variant="secondary" icon={<PencilSquareIcon className="h-4 w-4" />} disabled={!data} onClick={abrir}>Editar</Button>}
      />
      <Card>
        <CardHeader title={data?.nombre ?? 'Datos de la empresa'} description="Información legal y de contacto" action={data ? <StatusBadge estado={data.estado} /> : undefined} />
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading || !data ? (
          <CardBody>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}><Skeleton className="h-3 w-24" /><Skeleton className="mt-2 h-4 w-full max-w-[14rem]" /></div>
              ))}
            </div>
          </CardBody>
        ) : (
          <CardBody>
            <DefinitionList
              items={[
                { label: 'Razón social', value: data.nombre },
                { label: 'RUC', value: data.ruc && <span className="num">{data.ruc}</span> },
                { label: 'Representante legal', value: data.representante_legal },
                { label: 'Teléfono', value: data.telefono && <span className="num">{data.telefono}</span> },
                { label: 'Correo electrónico', value: data.email },
                { label: 'Dirección', value: data.direccion },
              ]}
            />
          </CardBody>
        )}
      </Card>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title="Editar datos de la empresa"
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>Guardar cambios</Button></>}
      >
        <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input label="Nombre o razón social" className="sm:col-span-2" error={errors.nombre && 'Ingresa el nombre de la empresa'} {...register('nombre', { required: true, validate: v => !!v.trim() })} />
          <Input
            label="RUC"
            inputMode="numeric"
            maxLength={11}
            hint="11 dígitos."
            error={errors.ruc && 'El RUC debe tener 11 dígitos'}
            {...register('ruc', { validate: v => !v.trim() || /^\d{11}$/.test(v.trim()) })}
          />
          <Input label="Representante legal" {...register('representante_legal')} />
          <Input label="Teléfono" inputMode="tel" autoComplete="tel" {...register('telefono')} />
          <Input label="Correo electrónico" type="email" autoComplete="email" error={errors.email && 'Ingresa un correo válido'} {...register('email', { validate: v => !v.trim() || /^\S+@\S+\.\S+$/.test(v.trim()) })} />
          <Input label="Dirección" className="sm:col-span-2" {...register('direccion')} />
        </form>
      </Modal>
    </>
  );
}
