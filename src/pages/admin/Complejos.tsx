import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { BuildingStorefrontIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, PageHeader, SearchBox, Select, Textarea, Toolbar, useToast,
} from '../../ui';
import type { Column } from '../../ui';
import { TIPOS_COMPLEJO, useOpciones } from './_parts/catalogo/opciones';

interface Fila {
  id: number;
  nombre: string;
  tipo: string;
  direccion: string | null;
  descripcion: string | null;
  empresa_id: number | null;
  empresa?: { id: number; nombre: string } | null;
  _count?: { unidades: number };
  unidades_count?: number;
}
interface Form { nombre: string; tipo: string; direccion: string; descripcion: string; empresa_id: string }

const cantidad = (f: Fila) => f._count?.unidades ?? f.unidades_count;

export default function Complejos() {
  const { user } = useAuth();
  const toast = useToast();
  const esSuper = user?.rol === 'superadmin';
  const list = useList<Fila>('/api/complejos');
  const empresas = useOpciones(esSuper ? '/api/empresas' : null);
  const [editando, setEditando] = useState<Fila | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<Fila | null>(null);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>();

  function abrir(f: Fila | 'nuevo') {
    reset(f === 'nuevo'
      ? { nombre: '', tipo: 'Condominio', direccion: '', descripcion: '', empresa_id: '' }
      : { nombre: f.nombre, tipo: f.tipo, direccion: f.direccion ?? '', descripcion: f.descripcion ?? '', empresa_id: f.empresa_id ? String(f.empresa_id) : '' });
    setEditando(f);
  }

  async function guardar(v: Form) {
    const nuevo = editando === 'nuevo';
    const body: Record<string, unknown> = { nombre: v.nombre.trim(), tipo: v.tipo, direccion: v.direccion.trim() || null, descripcion: v.descripcion.trim() || null };
    if (esSuper) body.empresa_id = Number(v.empresa_id);
    try {
      await api(nuevo ? '/api/complejos' : `/api/complejos/${(editando as Fila).id}`, { method: nuevo ? 'POST' : 'PUT', json: body });
      toast.ok(nuevo ? 'Condominio creado' : 'Cambios guardados');
      setEditando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/complejos/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Condominio eliminado');
      setBorrar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Fila>[] = [
    { key: 'nombre', header: 'Condominio', cell: f => (
      <div className="min-w-0"><p className="truncate font-medium">{f.nombre}</p>{f.direccion && <p className="truncate text-xs text-muted sm:hidden">{f.direccion}</p>}</div>
    ) },
    { key: 'tipo', header: 'Tipo', cell: f => <Badge tone="brand">{f.tipo}</Badge> },
    { key: 'direccion', header: 'Dirección', hideBelow: 'sm', cell: f => f.direccion ?? '—' },
    ...(esSuper ? [{ key: 'empresa', header: 'Empresa', hideBelow: 'md' as const, cell: (f: Fila) => f.empresa?.nombre ?? '—' }] : []),
    { key: 'unidades', header: 'Unidades', align: 'right', hideBelow: 'md', cell: f => <span className="num">{cantidad(f) ?? '—'}</span> },
    { key: 'acciones', header: '', align: 'right', cell: f => (
      <div className="flex justify-end gap-1">
        <IconButton label={`Editar ${f.nombre}`} onClick={() => abrir(f)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Eliminar ${f.nombre}`} onClick={() => setBorrar(f)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Condominios"
        description="Edificios, condominios y conjuntos residenciales que administras. Cada unidad y cada recibo pertenece a uno."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nuevo condominio</Button>}
      />
      <Card>
        <Toolbar><SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por nombre o dirección" /></Toolbar>
        <DataTable
          caption="Condominios"
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
            title: list.q ? 'Sin resultados' : 'Aún no hay condominios',
            description: list.q ? 'Prueba con otra búsqueda.' : 'Registra el primero para poder crear sus unidades y emitir recibos.',
            icon: <BuildingStorefrontIcon />,
            action: list.q ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nuevo condominio</Button>,
          }}
        />
      </Card>

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando === 'nuevo' ? 'Nuevo condominio' : 'Editar condominio'}
        footer={<><Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{editando === 'nuevo' ? 'Crear condominio' : 'Guardar cambios'}</Button></>}
      >
        <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input label="Nombre" className="sm:col-span-2" error={errors.nombre && 'Ingresa el nombre'} {...register('nombre', { required: true, validate: v => !!v.trim() })} />
          <Select label="Tipo" error={errors.tipo && 'Elige el tipo'} {...register('tipo', { required: true })}>
            {TIPOS_COMPLEJO.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          {esSuper && (
            <Select label="Empresa" error={errors.empresa_id && 'Elige la empresa'} hint={empresas.error ?? undefined} {...register('empresa_id', { required: true })}>
              <option value="">{empresas.loading ? 'Cargando…' : 'Selecciona una empresa'}</option>
              {empresas.opciones.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </Select>
          )}
          <Input label="Dirección" className="sm:col-span-2" placeholder="Av. Arequipa 1234, Lince" {...register('direccion')} />
          <Textarea label="Descripción" className="sm:col-span-2" {...register('descripcion')} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Eliminar condominio"
        message={`Se eliminará «${borrar?.nombre ?? ''}». Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar condominio"
      />
    </>
  );
}
