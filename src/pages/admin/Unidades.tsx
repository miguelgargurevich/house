import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../api';
import {
  Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, PageHeader, SearchBox, Select, StatusBadge, Textarea, Toolbar, useToast,
} from '../../ui';
import type { Column } from '../../ui';
import { FiltroSelect } from './_parts/catalogo/FiltroSelect';
import { TIPOS_UNIDAD, useOpciones } from './_parts/catalogo/opciones';

interface Persona { id: number; nombre: string }
interface Fila {
  id: number;
  codigo: string;
  tipo: string;
  descripcion: string | null;
  estado: string | null;
  complejo_id: number | null;
  propietario_id: number | null;
  inquilino_id: number | null;
  complejo?: Persona | null;
  propietario?: Persona | null;
  inquilino?: Persona | null;
}
interface Form { codigo: string; tipo: string; complejo_id: string; descripcion: string; estado: string; propietario_id: string; inquilino_id: string }

const ESTADOS = [{ value: 'activa', label: 'Activa' }, { value: 'inactiva', label: 'Inactiva' }];
const idONull = (v: string) => (v ? Number(v) : null);

export default function Unidades() {
  const toast = useToast();
  const [complejo, setComplejo] = useState('');
  const [estado, setEstado] = useState('');
  const list = useList<Fila>('/api/unidades', { params: { complejo_id: complejo, estado } });
  const complejos = useOpciones('/api/complejos');
  const propietarios = useOpciones('/api/usuarios?rol=propietario');
  const inquilinos = useOpciones('/api/usuarios?rol=inquilino');
  const [editando, setEditando] = useState<Fila | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<Fila | null>(null);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>();

  const filtrado = !!(list.q || complejo || estado);

  function abrir(f: Fila | 'nuevo') {
    reset(f === 'nuevo'
      ? { codigo: '', tipo: 'Departamento', complejo_id: complejo, descripcion: '', estado: 'activa', propietario_id: '', inquilino_id: '' }
      : {
          codigo: f.codigo, tipo: f.tipo, complejo_id: f.complejo_id ? String(f.complejo_id) : '', descripcion: f.descripcion ?? '',
          estado: f.estado ?? 'activa', propietario_id: f.propietario_id ? String(f.propietario_id) : '', inquilino_id: f.inquilino_id ? String(f.inquilino_id) : '',
        });
    setEditando(f);
  }

  async function guardar(v: Form) {
    const nuevo = editando === 'nuevo';
    const body = {
      codigo: v.codigo.trim(), tipo: v.tipo, complejo_id: Number(v.complejo_id), descripcion: v.descripcion.trim() || null,
      estado: v.estado, propietario_id: idONull(v.propietario_id), inquilino_id: idONull(v.inquilino_id),
    };
    try {
      await api(nuevo ? '/api/unidades' : `/api/unidades/${(editando as Fila).id}`, { method: nuevo ? 'POST' : 'PUT', json: body });
      toast.ok(nuevo ? 'Unidad creada' : 'Cambios guardados');
      setEditando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/unidades/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Unidad eliminada');
      setBorrar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Fila>[] = [
    { key: 'codigo', header: 'Código', cell: f => (
      <div className="min-w-0"><p className="font-medium num">{f.codigo}</p><p className="truncate text-xs text-muted sm:hidden">{f.tipo}{f.complejo ? ` · ${f.complejo.nombre}` : ''}</p></div>
    ) },
    { key: 'tipo', header: 'Tipo', hideBelow: 'sm', cell: f => f.tipo },
    { key: 'complejo', header: 'Condominio', hideBelow: 'md', cell: f => f.complejo?.nombre ?? '—' },
    { key: 'propietario', header: 'Propietario', hideBelow: 'md', cell: f => f.propietario?.nombre ?? <span className="text-muted">Sin asignar</span> },
    { key: 'inquilino', header: 'Inquilino', hideBelow: 'lg', cell: f => f.inquilino?.nombre ?? <span className="text-muted">—</span> },
    { key: 'estado', header: 'Estado', cell: f => <StatusBadge estado={f.estado} /> },
    { key: 'acciones', header: '', align: 'right', cell: f => (
      <div className="flex justify-end gap-1">
        <IconButton label={`Editar unidad ${f.codigo}`} onClick={() => abrir(f)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Eliminar unidad ${f.codigo}`} onClick={() => setBorrar(f)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  const sinComplejos = !complejos.loading && complejos.opciones.length === 0;

  return (
    <>
      <PageHeader
        title="Unidades"
        description="Departamentos, casas, locales, estacionamientos y depósitos, con su propietario e inquilino."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nueva unidad</Button>}
      />
      <Card>
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por código" />
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <FiltroSelect label="Filtrar por condominio" value={complejo} onChange={setComplejo} className="sm:w-52">
              <option value="">Todos los condominios</option>
              {complejos.opciones.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </FiltroSelect>
            <FiltroSelect label="Filtrar por estado" value={estado} onChange={setEstado} className="sm:w-40">
              <option value="">Todos los estados</option>
              {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </FiltroSelect>
          </div>
        </Toolbar>
        <DataTable
          caption="Unidades"
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
            title: filtrado ? 'Sin resultados' : 'Aún no hay unidades',
            description: filtrado
              ? 'Cambia la búsqueda o los filtros.'
              : sinComplejos ? 'Primero crea un condominio; después podrás registrar sus unidades.' : 'Registra la primera para asignarle propietario y cobrarle recibos.',
            icon: <KeyIcon />,
            action: filtrado || sinComplejos ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nueva unidad</Button>,
          }}
        />
      </Card>

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando === 'nuevo' ? 'Nueva unidad' : 'Editar unidad'}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{editando === 'nuevo' ? 'Crear unidad' : 'Guardar cambios'}</Button></>}
      >
        <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input label="Código" placeholder="Ej. 101 o A-203" error={errors.codigo && 'Ingresa el código'} {...register('codigo', { required: true, validate: v => !!v.trim() })} />
          <Select label="Tipo" error={errors.tipo && 'Elige el tipo'} {...register('tipo', { required: true })}>
            {TIPOS_UNIDAD.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select label="Condominio" error={errors.complejo_id && 'Elige el condominio'} hint={complejos.error ?? undefined} {...register('complejo_id', { required: true })}>
            <option value="">{complejos.loading ? 'Cargando…' : 'Selecciona un condominio'}</option>
            {complejos.opciones.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
          <Select label="Estado" {...register('estado', { required: true })}>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
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

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Eliminar unidad"
        message={`Se eliminará la unidad ${borrar?.codigo ?? ''}. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar unidad"
      />
    </>
  );
}
