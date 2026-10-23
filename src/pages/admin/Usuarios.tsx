import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PencilSquareIcon, PlusIcon, TrashIcon, UsersIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList, useResource } from '../../api';
import type { Page } from '../../api';
import type { Rol } from '../../auth/AuthContext';
import { useAuth } from '../../auth/AuthContext';
import { ROL_LABEL } from '../../app/nav';
import {
  Avatar, Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, PageHeader, SearchBox, Select, Toolbar, useToast,
} from '../../ui';
import type { Column } from '../../ui';

interface Fila { id: number; nombre: string; email: string; telefono: string | null; rol: Rol | null; empresa?: { id: number; nombre: string } | null }
interface Form { nombre: string; email: string; telefono: string; rol: Rol; password: string; empresa_id: string }
interface EmpresaOpt { id: number; nombre: string }

export default function Usuarios() {
  const { user } = useAuth();
  const toast = useToast();
  const esSuper = user?.rol === 'superadmin';
  const [filtroRol, setFiltroRol] = useState('');
  const [filtroEmpresa, setFiltroEmpresa] = useState('');
  const list = useList<Fila>('/api/usuarios', { params: { rol: filtroRol, empresa_id: esSuper ? filtroEmpresa : undefined } });
  const empresas = useResource<Page<EmpresaOpt>>(esSuper ? '/api/empresas?pageSize=100' : null);
  const [editando, setEditando] = useState<Fila | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<Fila | null>(null);
  const [busy, setBusy] = useState(false);

  const roles = (Object.keys(ROL_LABEL) as Rol[]).filter(r => esSuper || r !== 'superadmin');
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Form>();

  function abrir(f: Fila | 'nuevo') {
    reset(f === 'nuevo'
      ? { nombre: '', email: '', telefono: '', rol: 'propietario', password: '', empresa_id: '' }
      : { nombre: f.nombre, email: f.email, telefono: f.telefono ?? '', rol: (f.rol ?? 'propietario') as Rol, password: '', empresa_id: f.empresa?.id ? String(f.empresa.id) : '' });
    setEditando(f);
  }

  async function guardar(v: Form) {
    const nuevo = editando === 'nuevo';
    const { empresa_id, ...resto } = v;
    const body: Record<string, unknown> = { ...resto };
    if (!resto.password) delete body.password;
    if (esSuper) body.empresa_id = empresa_id && v.rol !== 'superadmin' ? Number(empresa_id) : null;
    try {
      await api(nuevo ? '/api/usuarios' : `/api/usuarios/${(editando as Fila).id}`, { method: nuevo ? 'POST' : 'PUT', json: body });
      toast.ok(nuevo ? 'Usuario creado' : 'Cambios guardados');
      setEditando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/usuarios/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Usuario eliminado');
      setBorrar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Fila>[] = [
    { key: 'nombre', header: 'Usuario', cell: f => (
      <div className="flex items-center gap-3"><Avatar nombre={f.nombre} size="sm" /><div className="min-w-0"><p className="truncate font-medium">{f.nombre}</p><p className="truncate text-xs text-muted">{f.email}</p></div></div>
    ) },
    { key: 'rol', header: 'Rol', cell: f => (f.rol ? ROL_LABEL[f.rol] : '—') },
    { key: 'empresa', header: 'Empresa', hideBelow: 'md', cell: f => f.empresa?.nombre ?? '—' },
    { key: 'telefono', header: 'Teléfono', hideBelow: 'lg', cell: f => <span className="num">{f.telefono ?? '—'}</span> },
    { key: 'acciones', header: '', align: 'right', cell: f => (
      <div className="flex justify-end gap-1">
        <IconButton label={`Editar ${f.nombre}`} onClick={() => abrir(f)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Eliminar ${f.nombre}`} disabled={f.id === user?.id} onClick={() => setBorrar(f)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader title="Usuarios" description="Personas con acceso a House: administradores, residentes y personal." actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nuevo usuario</Button>} />
      <Card>
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por nombre o correo" />
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Select label="Filtrar por rol" className="sm:w-48" value={filtroRol} onChange={e => setFiltroRol(e.target.value)}>
              <option value="">Todos los roles</option>
              {roles.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
            </Select>
            {esSuper && (
              <Select label="Filtrar por empresa" className="sm:w-56" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} disabled={empresas.loading} hint={empresas.error ? 'No se pudieron cargar las empresas.' : undefined}>
                <option value="">Todas las empresas</option>
                {(empresas.data?.items ?? []).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </Select>
            )}
          </div>
        </Toolbar>
        <DataTable
          caption="Usuarios"
          columns={columns}
          rows={list.items}
          rowKey={f => f.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: 'No hay usuarios',
            description: list.q || filtroRol || filtroEmpresa ? 'Prueba con otra búsqueda o quita los filtros.' : 'Crea el primero para dar acceso a alguien.',
            icon: <UsersIcon />,
          }}
        />
      </Card>

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando === 'nuevo' ? 'Nuevo usuario' : 'Editar usuario'}
        footer={<><Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{editando === 'nuevo' ? 'Crear usuario' : 'Guardar cambios'}</Button></>}
      >
        <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input label="Nombre completo" className="sm:col-span-2" error={errors.nombre && 'Ingresa el nombre'} {...register('nombre', { required: true })} />
          <Input label="Correo electrónico" type="email" error={errors.email && 'Ingresa un correo válido'} {...register('email', { required: true, pattern: /^\S+@\S+\.\S+$/ })} />
          <Input label="Teléfono" inputMode="tel" {...register('telefono')} />
          <Select label="Rol" {...register('rol', { required: true })}>{roles.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}</Select>
          {esSuper && (
            <Select
              label="Empresa"
              hint={watch('rol') === 'superadmin' ? 'El superadministrador no pertenece a una empresa.' : undefined}
              error={errors.empresa_id && 'Elige la empresa del usuario'}
              disabled={watch('rol') === 'superadmin'}
              {...register('empresa_id', { validate: v => !['admin', 'mantenimiento', 'seguridad'].includes(watch('rol')) || v !== '' })}
            >
              <option value="">Sin empresa</option>
              {(empresas.data?.items ?? []).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </Select>
          )}
          <Input
            label={editando === 'nuevo' ? 'Contraseña' : 'Nueva contraseña'}
            type="password"
            autoComplete="new-password"
            hint={editando === 'nuevo' ? 'Mínimo 8 caracteres.' : 'Déjala vacía para no cambiarla.'}
            error={errors.password && 'Mínimo 8 caracteres'}
            {...register('password', { required: editando === 'nuevo', minLength: 8 })}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Eliminar usuario"
        message={`Se eliminará a ${borrar?.nombre ?? ''}. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
      />
    </>
  );
}
