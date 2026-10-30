import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { PencilSquareIcon, PlusIcon, TrashIcon, TruckIcon } from '@heroicons/react/24/outline';
import { useCondominio } from '../../app/condominio';
import { api, errorText, useList, useResource } from '../../api';
import type { Page } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, PageHeader, SearchBox, Select, TelefonoInput, Textarea, Toolbar, useToast } from '../../ui';
import type { Column } from '../../ui';
import { Interruptor } from './_parts/catalogo/Interruptor';
import { RUBROS, rubroLabel } from './_parts/personas/proveedores';
import type { Proveedor, Rubro } from './_parts/personas/proveedores';

interface Opt { id: number; nombre: string; empresa_id?: number | null }
/** La junta recibe además `compartido`: atiende también a otros condominios y sólo la administración lo cambia. `visible_vecinos`: lo ven los vecinos en su menú «Proveedores». */
type Fila = Proveedor & { compartido?: boolean; visible_vecinos?: boolean };
interface Form {
  razon_social: string; rubro: Rubro; ruc: string; contacto_nombre: string; telefono: string; email: string; notas: string;
  activo: boolean; visible_vecinos: boolean; empresa_id: string;
}

/**
 * Directorio de proveedores de la administradora (ascensores, gasfitería, pintura…): sólo ficha, no inician sesión. Se asignan a tareas de mantenimiento.
 * También la usa la junta (`/junta/proveedores`): ve los de su condominio, administra los que atienden sólo a él (no los elimina: los desactiva) y
 * los compartidos con otros condominios los ve en sólo lectura.
 */
export default function Proveedores() {
  const { user } = useAuth();
  const toast = useToast();
  const esSuper = user?.rol === 'superadmin';
  const esJunta = user?.rol === 'propietario';
  const [filtroRubro, setFiltroRubro] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  // El condominio es el de la barra superior (la junta no tiene selector: sólo ve los de su condominio).
  const { complejo: filtroComplejo } = useCondominio();
  const list = useList<Fila>('/api/proveedores', { params: { rubro: filtroRubro, activo: filtroEstado, complejo_id: filtroComplejo } });
  const complejos = useResource<Page<Opt>>(esJunta ? null : '/api/complejos?pageSize=100'); // la junta no lista condominios: sólo trabaja con el suyo
  const empresas = useResource<Page<Opt>>(esSuper ? '/api/empresas?pageSize=100' : null);
  const [editando, setEditando] = useState<Fila | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<Proveedor | null>(null);
  const [busy, setBusy] = useState(false);
  // Los condominios se marcan fuera del formulario: con un solo condominio, react-hook-form trata la casilla como un valor suelto, no como lista.
  const [atiende, setAtiende] = useState<number[]>([]);
  const { register, handleSubmit, reset, watch, control, formState: { errors, isSubmitting } } = useForm<Form>();
  const empresaElegida = watch('empresa_id');
  // El superadmin elige la empresa del proveedor: sus condominios deben ser de ella.
  const complejosElegibles = (complejos.data?.items ?? []).filter(c => !esSuper || (empresaElegida !== '' && String(c.empresa_id) === empresaElegida));

  function abrir(p: Fila | 'nuevo') {
    reset(p === 'nuevo'
      ? { razon_social: '', rubro: 'otros', ruc: '', contacto_nombre: '', telefono: '', email: '', notas: '', activo: true, visible_vecinos: false, empresa_id: '' }
      : { razon_social: p.razon_social, rubro: p.rubro, ruc: p.ruc ?? '', contacto_nombre: p.contacto_nombre ?? '', telefono: p.telefono ?? '', email: p.email ?? '', notas: p.notas ?? '', activo: p.activo, visible_vecinos: p.visible_vecinos ?? false, empresa_id: String(p.empresa_id) });
    // Un proveedor nuevo atiende, por defecto, al condominio elegido arriba (el superadmin primero elige la empresa).
    setAtiende(p === 'nuevo' ? (filtroComplejo && !esSuper ? [Number(filtroComplejo)] : []) : p.complejos.map(c => c.id));
    setEditando(p);
  }

  async function guardar(v: Form) {
    const nuevo = editando === 'nuevo';
    const body: Record<string, unknown> = {
      razon_social: v.razon_social, rubro: v.rubro, ruc: v.ruc, contacto_nombre: v.contacto_nombre, telefono: v.telefono, email: v.email, notas: v.notas,
      activo: v.activo, visible_vecinos: v.visible_vecinos,
      ...(esJunta ? {} : { complejo_ids: atiende }), // la API deja siempre los de la junta vinculados sólo a su condominio
    };
    if (nuevo && esSuper) body.empresa_id = Number(v.empresa_id);
    try {
      await api(nuevo ? '/api/proveedores' : `/api/proveedores/${(editando as Proveedor).id}`, { method: nuevo ? 'POST' : 'PUT', json: body });
      toast.ok(nuevo ? 'Proveedor creado' : 'Cambios guardados');
      setEditando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  /** Prende o apaga «Visible para los vecinos» desde la lista: sólo manda ese campo (la auditoría deja claro qué cambió). */
  async function cambiarVisible(p: Fila) {
    const valor = !p.visible_vecinos;
    try {
      await api(`/api/proveedores/${p.id}`, { method: 'PUT', json: { visible_vecinos: valor } });
      toast.ok(valor ? `«${p.razon_social}» ahora lo ven los vecinos` : `«${p.razon_social}» ya no lo ven los vecinos`);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/proveedores/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Proveedor eliminado');
      setBorrar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Fila>[] = [
    { key: 'razon', header: 'Proveedor', cell: p => (
      <div className="min-w-0"><p className="font-medium">{p.razon_social}</p>{p.ruc && <p className="num text-xs text-muted">RUC {p.ruc}</p>}</div>
    ) },
    { key: 'rubro', header: 'Rubro', cell: p => <Badge tone="brand">{rubroLabel(p.rubro)}</Badge> },
    { key: 'contacto', header: 'Contacto', hideBelow: 'md', cell: p => (
      <div className="min-w-0"><p>{p.contacto_nombre ?? '—'}</p><p className="num text-xs text-muted">{[p.telefono, p.email].filter(Boolean).join(' · ')}</p></div>
    ) },
    { key: 'complejos', header: 'Atiende', hideBelow: 'lg', cell: p => (
      <span className="block">
        {p.complejos.length ? p.complejos.map(c => c.nombre).join(', ') : <span className="text-muted">Sin condominio asignado</span>}
        {esJunta && p.compartido && <span className="block text-xs text-muted">También atiende a otros condominios</span>}
      </span>
    ) },
    { key: 'vecinos', header: 'Vecinos', hideBelow: 'md', cell: p => (
      esJunta && p.compartido ? (
        <span title="Atiende a más de un condominio: sólo la administración puede cambiarlo">{p.visible_vecinos ? <Badge tone="ok">Lo ven</Badge> : <Badge>No lo ven</Badge>}</span>
      ) : (
        <button type="button" onClick={() => void cambiarVisible(p)} aria-pressed={!!p.visible_vecinos} aria-label={`Visible para los vecinos: ${p.razon_social}`}
          title={p.visible_vecinos ? (p.activo ? 'Los vecinos lo ven. Clic para ocultarlo.' : 'Marcado, pero está inactivo: los vecinos no lo ven. Clic para ocultarlo.') : 'Los vecinos no lo ven. Clic para mostrarlo.'}
          className="inline-flex min-h-10 items-center">
          {p.visible_vecinos ? <Badge tone={p.activo ? 'ok' : 'warn'}>{p.activo ? 'Lo ven' : 'Marcado (inactivo)'}</Badge> : <Badge>No lo ven</Badge>}
        </button>
      )
    ) },
    { key: 'activo', header: 'Estado', hideBelow: 'sm', cell: p => (p.activo ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>) },
    { key: 'acciones', header: '', align: 'right', cell: p => (
      esJunta && p.compartido ? (
        <span title="Atiende a más de un condominio: sólo la administración puede cambiarlo"><Badge>Sólo lectura</Badge></span>
      ) : (
        <div className="flex justify-end gap-1">
          <IconButton label={`Editar ${p.razon_social}`} onClick={() => abrir(p)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
          {!esJunta && <IconButton label={`Eliminar ${p.razon_social}`} onClick={() => setBorrar(p)}><TrashIcon className="h-4 w-4" /></IconButton>}
        </div>
      )
    ) },
  ];

  const filtrado = !!(list.q || filtroRubro || filtroEstado || filtroComplejo);

  return (
    <>
      <PageHeader title="Proveedores" description={esJunta ? 'Los servicios externos de tu condominio (ascensores, gasfitería, pintura…). Puedes agregar y editar los que atienden sólo a tu condominio; si un proveedor ya no sirve, márcalo como inactivo. Los que también atienden a otros condominios los ve la administración y aquí son de sólo lectura.' : 'Ascensores, gasfitería, pintura y demás servicios externos. Son una ficha de contacto (no inician sesión) que asignas a las tareas de mantenimiento.'} actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nuevo proveedor</Button>} />
      <Card>
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por nombre, RUC o contacto" />
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
            <Select label="Filtrar por rubro" className="sm:w-44" value={filtroRubro} onChange={e => setFiltroRubro(e.target.value)}>
              <option value="">Todos los rubros</option>
              {RUBROS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
            <Select label="Filtrar por estado" className="sm:w-40" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              <option value="">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </Select>
          </div>
        </Toolbar>
        <DataTable
          caption="Proveedores"
          columns={columns}
          rows={list.items}
          rowKey={p => p.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: filtrado ? 'Sin resultados' : 'Aún no hay proveedores',
            description: filtrado ? 'Prueba con otra búsqueda o quita los filtros.' : 'Registra el primero para poder asignarlo a una tarea de mantenimiento.',
            icon: <TruckIcon />,
            action: filtrado ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nuevo proveedor</Button>,
          }}
        />
      </Card>

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando === 'nuevo' ? 'Nuevo proveedor' : 'Editar proveedor'}
        footer={<><Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{editando === 'nuevo' ? 'Crear proveedor' : 'Guardar cambios'}</Button></>}
      >
        <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input label="Razón social" className="sm:col-span-2" error={errors.razon_social && 'Ingresa el nombre del proveedor'} {...register('razon_social', { required: true, validate: v => !!v.trim() })} />
          {esSuper && editando === 'nuevo' && (
            <Select label="Empresa" className="sm:col-span-2" hint="La administradora a la que pertenece este proveedor." error={errors.empresa_id && 'Elige la empresa'} {...register('empresa_id', { validate: v => v !== '', onChange: () => setAtiende([]) })}>
              <option value="">Elige una empresa</option>
              {(empresas.data?.items ?? []).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </Select>
          )}
          <Select label="Rubro" {...register('rubro', { required: true })}>{RUBROS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
          <Input label="RUC (opcional)" inputMode="numeric" maxLength={11} error={errors.ruc && 'El RUC tiene 11 dígitos'} {...register('ruc', { pattern: /^(\d{11})?$/ })} />
          <Input label="Persona de contacto" {...register('contacto_nombre')} />
          <Controller control={control} name="telefono" render={({ field }) => <TelefonoInput label="Teléfono" value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} name={field.name} />} />
          <Input label="Correo electrónico" type="email" className="sm:col-span-2" error={errors.email && 'Ingresa un correo válido'} {...register('email', { pattern: /^(\S+@\S+\.\S+)?$/ })} />
          {!esJunta && <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Condominios que atiende</legend>
            {esSuper && empresaElegida === '' ? (
              <p className="text-sm text-muted">Elige primero la empresa.</p>
            ) : complejosElegibles.length === 0 ? (
              <p className="text-sm text-muted">{complejos.loading ? 'Cargando…' : 'No hay condominios registrados.'}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {complejosElegibles.map(c => (
                  <label key={c.id} className="flex min-h-10 items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand" checked={atiende.includes(c.id)} onChange={e => setAtiende(a => (e.target.checked ? [...a, c.id] : a.filter(x => x !== c.id)))} />
                    {c.nombre}
                  </label>
                ))}
              </div>
            )}
          </fieldset>}
          <Textarea label="Notas (opcional)" className="sm:col-span-2" {...register('notas')} />
          <Interruptor label="Activo" hint="Un proveedor inactivo no se puede asignar a tareas nuevas." className="sm:col-span-2" {...register('activo')} />
          <Interruptor label="Visible para los vecinos" hint="Los propietarios e inquilinos de los condominios que atiende verán su nombre, rubro, contacto, teléfono y correo en «Proveedores». Tus notas y el RUC no se muestran. Sólo se ve si está activo." className="sm:col-span-2" {...register('visible_vecinos')} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Eliminar proveedor"
        message={`Se eliminará «${borrar?.razon_social ?? ''}». Sus tareas quedarán sin asignar. Si sólo quieres dejar de usarlo, márcalo como inactivo.`}
        confirmLabel="Eliminar proveedor"
      />
    </>
  );
}
