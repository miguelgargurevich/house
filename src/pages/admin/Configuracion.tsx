import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { BuildingOffice2Icon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  Button, Card, CardBody, CardHeader, DefinitionList, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton, StatusBadge, TabPanel, Tabs, TelefonoInput, useToast,
} from '../../ui';
import { ImagenEditable } from './_parts/condominio/ImagenEditable';
import { PaisEmpresa } from './_parts/condominio/PaisEmpresa';
import PersonasLista from './_parts/personas/PersonasLista';

const VISTAS = [
  { id: 'datos', label: 'Datos' },
  { id: 'personal', label: 'Personal' },
] as const;

type Vista = typeof VISTAS[number]['id'];
const esVista = (v: string | null): v is Vista => VISTAS.some(x => x.id === v);

interface Empresa {
  id: number;
  nombre: string;
  ruc: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  representante_legal: string | null;
  estado: string | null;
  /** Logo del recibo impreso (URL con su versión); `null` si no hay. */
  logo_url?: string | null;
  /** País (ISO 3166-1) de la empresa: el de sus condominios nuevos. */
  pais?: string;
}
interface Form { nombre: string; ruc: string; direccion: string; telefono: string; email: string; representante_legal: string }

export default function Configuracion() {
  const { user } = useAuth();
  const toast = useToast();
  const empresaId = user?.empresa_id ?? null;
  const { data, loading, error, reload } = useResource<Empresa>(empresaId ? `/api/empresas/${empresaId}` : null);
  const [abierto, setAbierto] = useState(false);
  const [params, setParams] = useSearchParams();
  const vista: Vista = esVista(params.get('vista')) ? (params.get('vista') as Vista) : 'datos';
  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<Form>();

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
      <div className="mb-4">
        <Tabs value={vista} onChange={v => setParams(v === 'datos' ? {} : { vista: v })} items={VISTAS.map(v => ({ id: v.id, label: v.label }))} idBase="mi-empresa" label="Ficha de la empresa" />
      </div>

      <TabPanel idBase="mi-empresa" id="datos" value={vista}>
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
              <section aria-labelledby="logo-empresa" className="mt-6 border-t border-line pt-5">
                <h3 id="logo-empresa" className="mb-3 text-sm font-semibold">Recibo impreso</h3>
                <ImagenEditable titulo="Logo de la empresa" ayuda="Sale al pie de cada recibo de mantenimiento. JPG, PNG o WebP, hasta 2 MB." url={data.logo_url ?? null} ruta={`/api/empresas/${data.id}/logo`} onCambio={() => void reload()} />
              </section>
              <PaisEmpresa key={data.pais} empresaId={data.id} pais={data.pais ?? 'PE'} onCambio={() => void reload()} />
            </CardBody>
          )}
        </Card>
      </TabPanel>

      <TabPanel idBase="mi-empresa" id="personal" value={vista}>
        <PersonasLista tipo="personal" empresaId={empresaId ?? undefined} sinEncabezado />
      </TabPanel>

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
          <Controller control={control} name="telefono" render={({ field }) => <TelefonoInput label="Teléfono" value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} name={field.name} />} />
          <Input label="Correo electrónico" type="email" autoComplete="email" error={errors.email && 'Ingresa un correo válido'} {...register('email', { validate: v => !v.trim() || /^\S+@\S+\.\S+$/.test(v.trim()) })} />
          <Input label="Dirección" className="sm:col-span-2" {...register('direccion')} />
        </form>
      </Modal>
    </>
  );
}
