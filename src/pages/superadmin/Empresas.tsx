import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { BuildingOffice2Icon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../api';
import {
  Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, PageHeader, SearchBox, Select, StatusBadge, Toolbar, useToast,
} from '../../ui';
import type { Column } from '../../ui';

interface Fila {
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

export default function Empresas() {
  const toast = useToast();
  const list = useList<Fila>('/api/empresas');
  const [editando, setEditando] = useState<Fila | 'nueva' | null>(null);
  const [borrar, setBorrar] = useState<Fila | null>(null);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>({ defaultValues: VACIO });

  function abrir(f: Fila | 'nueva') {
    reset(f === 'nueva' ? VACIO : {
      nombre: f.nombre,
      ruc: f.ruc ?? '',
      direccion: f.direccion ?? '',
      telefono: f.telefono ?? '',
      email: f.email ?? '',
      representante_legal: f.representante_legal ?? '',
      estado: f.estado?.toLowerCase() === 'inactiva' ? 'inactiva' : 'activa',
    });
    setEditando(f);
  }

  async function guardar(v: Form) {
    const nueva = editando === 'nueva';
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
      await api(nueva ? '/api/empresas' : `/api/empresas/${(editando as Fila).id}`, { method: nueva ? 'POST' : 'PUT', json: body });
      toast.ok(nueva ? 'Empresa creada' : 'Cambios guardados');
      setEditando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/empresas/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Empresa eliminada');
      setBorrar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Fila>[] = [
    { key: 'nombre', header: 'Empresa', cell: f => (
      <div className="min-w-0"><p className="truncate font-medium">{f.nombre}</p><p className="truncate text-xs text-muted">{f.email ?? 'Sin correo'}</p></div>
    ) },
    { key: 'ruc', header: 'RUC', hideBelow: 'sm', cell: f => <span className="num">{f.ruc ?? '—'}</span> },
    { key: 'representante', header: 'Representante legal', hideBelow: 'lg', cell: f => f.representante_legal ?? '—' },
    { key: 'telefono', header: 'Teléfono', hideBelow: 'md', cell: f => <span className="num">{f.telefono ?? '—'}</span> },
    { key: 'estado', header: 'Estado', cell: f => <StatusBadge estado={f.estado ?? 'activa'} /> },
    { key: 'acciones', header: '', align: 'right', cell: f => (
      <div className="flex justify-end gap-1">
        <Link to={`/superadmin/empresas/${f.id}`} className="inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-brand hover:underline">Ver ficha</Link>
        <IconButton label={`Editar ${f.nombre}`} onClick={() => abrir(f)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Eliminar ${f.nombre}`} onClick={() => setBorrar(f)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Administradoras de condominios que usan House."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nueva')}>Nueva empresa</Button>}
      />
      <Card>
        <Toolbar><SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por nombre o RUC" /></Toolbar>
        <DataTable
          caption="Empresas administradoras"
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
            title: list.q ? 'Sin resultados' : 'Aún no hay empresas',
            description: list.q ? 'Prueba con otro nombre o RUC.' : 'Registra la primera administradora para que pueda crear sus condominios y usuarios.',
            icon: <BuildingOffice2Icon />,
            action: list.q ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nueva')}>Nueva empresa</Button>,
          }}
        />
      </Card>

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando === 'nueva' ? 'Nueva empresa' : 'Editar empresa'}
        footer={<><Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{editando === 'nueva' ? 'Crear empresa' : 'Guardar cambios'}</Button></>}
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
          <Input label="Teléfono" inputMode="tel" autoComplete="tel" {...register('telefono')} />
          <Input label="Correo electrónico" type="email" error={errors.email && 'Ingresa un correo válido'} {...register('email', { pattern: /^\S+@\S+\.\S+$/ })} />
          <Input label="Representante legal" className="sm:col-span-2" {...register('representante_legal')} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Eliminar empresa"
        message={`Se eliminará ${borrar?.nombre ?? 'la empresa'}. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar empresa"
      />
    </>
  );
}
