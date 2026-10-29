import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { ROL_LABEL } from '../../app/nav';
import SesionesActivas from './SesionesActivas';
import { AvisosPerfil } from './_parts/AvisosPerfil';
import { CanalesPerfil } from './_parts/CanalesPerfil';
import { TelegramPerfil } from './_parts/TelegramPerfil';
import { TokensApiPerfil } from './_parts/TokensApi';
import { Avatar, Button, Card, CardBody, CardHeader, DefinitionList, Input, PageHeader, Skeleton, useToast } from '../../ui';

/** Roles que tienen herramientas de consulta (mantenimiento y seguridad no): sólo ellos ven los tokens de API. */
const CON_HERRAMIENTAS: readonly string[] = ['superadmin', 'admin', 'propietario', 'inquilino'];

interface DatosForm { nombre: string }
interface ClaveForm { actual: string; nueva: string; confirmar: string }

export default function Perfil() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  const datos = useForm<DatosForm>({ defaultValues: { nombre: '' } });
  const clave = useForm<ClaveForm>({ defaultValues: { actual: '', nueva: '', confirmar: '' } });

  const resetDatos = datos.reset;
  useEffect(() => {
    if (user) resetDatos({ nombre: user.nombre });
  }, [user, resetDatos]);

  async function guardarDatos(v: DatosForm) {
    try {
      await api('/api/me', { method: 'PUT', json: { nombre: v.nombre.trim() } });
      await refresh();
      toast.ok('Datos actualizados');
    } catch (e) { toast.error(errorText(e)); }
  }

  async function cambiarClave(v: ClaveForm) {
    try {
      await api('/api/me/password', { method: 'PUT', json: { actual: v.actual, nueva: v.nueva } });
      clave.reset();
      toast.ok('Contraseña actualizada');
    } catch (e) { toast.error(errorText(e)); }
  }

  if (!user) return <><PageHeader title="Mi perfil" /><Skeleton className="h-64 w-full" /></>;

  return (
    <>
      <PageHeader title="Mi perfil" description="Tus datos de acceso y cómo te contactamos." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <Avatar nombre={user.nombre} />
            <div className="min-w-0 flex-1">
              <DefinitionList
                items={[
                  { label: 'Nombre', value: user.nombre },
                  { label: 'Correo', value: <span className="break-all">{user.email}</span> },
                  { label: 'Rol', value: ROL_LABEL[user.rol] },
                  { label: 'Teléfono', value: user.telefono && <span className="num">{user.telefono}</span> },
                ]}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Datos personales" description="El correo y el rol los gestiona tu administrador. Tu celular está en «Celular y avisos», más abajo." />
          <CardBody>
            <form onSubmit={datos.handleSubmit(guardarDatos)} className="grid gap-4" noValidate>
              <Input label="Nombre completo" autoComplete="name" error={datos.formState.errors.nombre && 'Ingresa tu nombre'} {...datos.register('nombre', { validate: v => v.trim().length > 0 })} />
              <div className="flex justify-end">
                <Button type="submit" loading={datos.formState.isSubmitting} className="w-full sm:w-auto">Guardar cambios</Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contraseña" description="Usa al menos 8 caracteres." />
          <CardBody>
            <form onSubmit={clave.handleSubmit(cambiarClave)} className="grid gap-4" noValidate>
              <Input label="Contraseña actual" type="password" autoComplete="current-password" error={clave.formState.errors.actual && 'Ingresa tu contraseña actual'} {...clave.register('actual', { required: true })} />
              <Input label="Nueva contraseña" type="password" autoComplete="new-password" error={clave.formState.errors.nueva && 'Mínimo 8 caracteres'} {...clave.register('nueva', { required: true, minLength: 8 })} />
              <Input
                label="Confirma la nueva contraseña"
                type="password"
                autoComplete="new-password"
                error={clave.formState.errors.confirmar && 'Las contraseñas no coinciden'}
                {...clave.register('confirmar', { required: true, validate: v => v === clave.getValues('nueva') })}
              />
              <div className="flex justify-end">
                <Button type="submit" loading={clave.formState.isSubmitting} className="w-full sm:w-auto">Cambiar contraseña</Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <SesionesActivas />
        <AvisosPerfil />
        <CanalesPerfil />
        <TelegramPerfil />
        {CON_HERRAMIENTAS.includes(user.rol) && <TokensApiPerfil />}
      </div>
    </>
  );
}
