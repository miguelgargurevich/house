import { useState } from 'react';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { PencilSquareIcon, PlusIcon, TrashIcon, UsersIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList, useResource } from '../../../../api';
import type { Page } from '../../../../api';
import type { CargoJunta, Rol } from '../../../../auth/AuthContext';
import { ROLES_PERSONAL, useAuth } from '../../../../auth/AuthContext';
import { ROL_LABEL } from '../../../../app/nav';
import {
  Avatar, Badge, Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, PageHeader, SearchBox, Select, TelefonoInput, Toolbar, useToast,
} from '../../../../ui';
import type { Column } from '../../../../ui';
import { nombreTorre } from '../medios/tipos';

export type TipoPersona = 'residente' | 'personal' | 'superadmin';

interface UnidadFila { id: number; codigo: string; complejo: { id: number; nombre: string } | null; estructura: { id: number; nombre: string | null } | null }
interface Fila {
  id: number; nombre: string; email: string; telefono: string | null; rol: Rol | null;
  empresa?: { id: number; nombre: string } | null;
  complejo?: { id: number; nombre: string } | null;
  cargo_junta?: CargoJunta | null; complejo_id?: number | null; estructura_id?: number | null;
  /** Residentes: sus departamentos (de ahí sale su condominio y su torre) y si están en mora. */
  unidades?: UnidadFila[]; moroso?: boolean;
}
interface Form {
  nombre: string; email: string; telefono: string; rol: Rol; password: string; empresa_id: string;
  cargo_junta: CargoJunta | ''; complejo_id: string; estructura_id: string; unidad: string; unidad_id: string;
}
interface Opt { id: number; nombre: string; empresa_id?: number | null }
interface TorreOpt { id: number; nombre: string | null }

const CARGOS: { value: CargoJunta; label: string }[] = [
  { value: 'presidente', label: 'Presidente' },
  { value: 'tesorero', label: 'Tesorero' },
  { value: 'secretario', label: 'Secretario' },
  { value: 'vocal', label: 'Vocal' },
];
const cargoLabel = (c: CargoJunta | null | undefined) => CARGOS.find(x => x.value === c)?.label ?? '—';

const ROLES_RESIDENTE: Rol[] = ['propietario', 'inquilino'];
const ROLES_POR_TIPO: Record<TipoPersona, readonly Rol[]> = { residente: ROLES_RESIDENTE, personal: ROLES_PERSONAL, superadmin: ['superadmin'] };

const TEXTOS: Record<TipoPersona, { titulo: string; descripcion: string; nuevo: string; vacio: string; singular: string }> = {
  residente: { titulo: 'Residentes', descripcion: 'Propietarios e inquilinos de tus condominios, con su departamento.', nuevo: 'Nuevo residente', vacio: 'Crea el primero y asígnale su departamento.', singular: 'residente' },
  personal: { titulo: 'Personal', descripcion: 'Administradores, seguridad, mantenimiento, limpieza y jardinería de la empresa.', nuevo: 'Nuevo personal', vacio: 'Crea el primero para darle acceso.', singular: 'persona' },
  superadmin: { titulo: 'Superadministradores', descripcion: 'Cuentas con acceso a toda la plataforma.', nuevo: 'Nuevo superadmin', vacio: 'No hay otras cuentas de superadministrador.', singular: 'superadministrador' },
};

/** «B01-804» y, si tiene más departamentos, «B01-804 +1». */
export const departamentos = (f: Pick<Fila, 'unidades'>) => {
  const u = f.unidades ?? [];
  return u.length === 0 ? '—' : u.length === 1 ? u[0]!.codigo : `${u[0]!.codigo} +${u.length - 1}`;
};
/** «Los Libertadores · Torre 1» del primer departamento (o el condominio de su ficha). */
export const ubicacion = (f: Pick<Fila, 'unidades' | 'complejo'>) => {
  const u = f.unidades?.[0];
  if (!u) return f.complejo?.nombre ?? 'Sin condominio';
  return [u.complejo?.nombre, u.estructura ? nombreTorre(u.estructura) : null].filter(Boolean).join(' · ') || 'Sin condominio';
};

interface Props {
  tipo: TipoPersona;
  /** Para pantallas que ponen pestañas encima de la lista (superadmin). */
  encima?: ReactNode;
  titulo?: string;
  descripcion?: string;
  /** Fija el condominio (ficha del condominio): la lista y el filtro quedan en ese condominio. */
  complejoId?: number;
  /** Fija la empresa (ficha de la empresa): el personal y su filtro quedan en esa empresa. */
  empresaId?: number;
  /** Oculta el encabezado de página (la lista vive dentro de una pestaña). */
  sinEncabezado?: boolean;
}

/** Lista y alta/edición de personas. Residentes, personal y superadmins comparten esta tabla pero NO se mezclan: cada pantalla pide un tipo. */
export default function PersonasLista({ tipo, encima, titulo, descripcion, complejoId, empresaId, sinEncabezado }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const esSuper = user?.rol === 'superadmin';
  const t = TEXTOS[tipo];
  const [filtroRol, setFiltroRol] = useState('');
  const [filtroEmpresa, setFiltroEmpresa] = useState(empresaId ? String(empresaId) : '');
  const [filtroComplejo, setFiltroComplejo] = useState(complejoId ? String(complejoId) : '');
  const [filtroTorre, setFiltroTorre] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const list = useList<Fila>('/api/usuarios', {
    params: {
      tipo,
      rol: filtroRol,
      empresa_id: tipo === 'personal' ? (empresaId ? String(empresaId) : esSuper ? filtroEmpresa : undefined) : undefined,
      complejo_id: tipo === 'superadmin' ? undefined : (complejoId ? String(complejoId) : filtroComplejo),
      estructura_id: tipo === 'residente' ? filtroTorre : undefined,
      estado: tipo === 'residente' ? filtroEstado : undefined,
    },
  });
  const empresas = useResource<Page<Opt>>(esSuper && tipo === 'personal' ? '/api/empresas?pageSize=100' : null);
  const complejos = useResource<Page<Opt>>(tipo === 'superadmin' ? null : '/api/complejos?pageSize=100');
  const torresFiltro = useResource<Page<TorreOpt>>(tipo === 'residente' && filtroComplejo ? `/api/estructuras?complejo_id=${filtroComplejo}&pageSize=100` : null);
  const [editando, setEditando] = useState<Fila | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<Fila | null>(null);
  const [busy, setBusy] = useState(false);

  const roles = ROLES_POR_TIPO[tipo];
  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors, isSubmitting } } = useForm<Form>();
  const rolElegido = watch('rol');
  const esResidente = tipo === 'residente';
  const esPersonal = tipo === 'personal';
  const cargoElegido = rolElegido === 'propietario' && watch('cargo_junta') !== '';
  // Un residente nuevo debe nacer con condominio (si no, la administración no lo alcanzaría); la junta también lo exige.
  const exigeCondominio = esResidente && ((editando === 'nuevo' && !esSuper) || cargoElegido);
  const complejoElegido = watch('complejo_id');
  const empresaElegida = watch('empresa_id');
  const torresJunta = useResource<Page<TorreOpt>>(cargoElegido && complejoElegido ? `/api/estructuras?complejo_id=${complejoElegido}&pageSize=100` : null);
  // El superadmin elige la empresa del personal; el condominio donde trabaja debe ser de ella.
  const complejosDeLaEmpresa = (complejos.data?.items ?? []).filter(c => !esSuper || !esPersonal || !empresaElegida || String(c.empresa_id) === empresaElegida);
  // Con el condominio fijo (ficha del condominio) sólo se ofrecen sus condominios: el que se está viendo.
  const complejosVisibles = (complejos.data?.items ?? []).filter(c => !complejoId || c.id === complejoId);

  function abrir(f: Fila | 'nuevo') {
    reset(f === 'nuevo'
      ? { nombre: '', email: '', telefono: '', rol: roles[0]!, password: '', empresa_id: empresaId ? String(empresaId) : '', cargo_junta: '', complejo_id: complejoId ? String(complejoId) : '', estructura_id: '', unidad: '', unidad_id: '' }
      : { nombre: f.nombre, email: f.email, telefono: f.telefono ?? '', rol: (f.rol ?? roles[0]!) as Rol, password: '', empresa_id: f.empresa?.id ? String(f.empresa.id) : '', cargo_junta: f.cargo_junta ?? '', complejo_id: f.complejo_id ? String(f.complejo_id) : '', estructura_id: f.estructura_id ? String(f.estructura_id) : '', unidad: f.unidades?.[0]?.codigo ?? '', unidad_id: f.unidades?.[0]?.id ? String(f.unidades[0].id) : '' });
    setEditando(f);
  }

  async function guardar(v: Form) {
    const nuevo = editando === 'nuevo';
    const body: Record<string, unknown> = { nombre: v.nombre, email: v.email, telefono: v.telefono, rol: v.rol };
    if (v.password) body.password = v.password;
    if (esResidente) {
      body.complejo_id = v.complejo_id ? Number(v.complejo_id) : null;
      // El cargo sólo existe para propietarios; con cargo va también la torre de la junta.
      if (v.rol === 'propietario') {
        body.cargo_junta = v.cargo_junta || null;
        if (v.cargo_junta) body.estructura_id = v.estructura_id ? Number(v.estructura_id) : null;
      }
      const codigo = v.unidad.trim();
      const unidadId = v.unidad_id ? Number(v.unidad_id) : null;
      const codigoActual = (editando as Fila)?.unidades?.[0]?.codigo ?? '';
      const unidadIdActual = (editando as Fila)?.unidades?.[0]?.id ? String((editando as Fila)?.unidades?.[0]?.id) : '';
      const departamentoCambio = codigo !== codigoActual || Boolean(unidadId && String(unidadId) !== unidadIdActual);
      if (nuevo || departamentoCambio) {
        if (codigo || unidadId) {
          // El departamento se escribe por su código (un condominio puede tener cientos): se busca dentro del condominio elegido.
          let hit: { id: number; codigo: string } | null = null;
          if (unidadId) {
            hit = { id: unidadId, codigo };
          } else {
            try {
              const r = await api<Page<{ id: number; codigo: string }>>(`/api/unidades?complejo_id=${v.complejo_id}&q=${encodeURIComponent(codigo)}&pageSize=20`);
              hit = r.items.find(u => u.codigo.toLowerCase() === codigo.toLowerCase()) ?? null;
            } catch (e) { toast.error(errorText(e)); return; }
          }
          if (!hit) { toast.error(`No encontré el departamento «${codigo}» en ese condominio.`); return; }
          body.unidad_id = hit.id;
        } else {
          // Se quitó el departamento: el backend suelta la unidad anterior.
          body.unidad_id = null;
        }
      }
    }
    if (esPersonal) {
      body.complejo_id = v.complejo_id ? Number(v.complejo_id) : null;
      if (esSuper) body.empresa_id = v.empresa_id ? Number(v.empresa_id) : null;
    }
    try {
      await api(nuevo ? '/api/usuarios' : `/api/usuarios/${(editando as Fila).id}`, { method: nuevo ? 'POST' : 'PUT', json: body });
      toast.ok(nuevo ? `${t.singular[0]!.toUpperCase()}${t.singular.slice(1)} creado` : 'Cambios guardados');
      setEditando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/usuarios/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Persona eliminada');
      setBorrar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const persona: Column<Fila> = { key: 'nombre', header: 'Nombre', cell: f => (
    <div className="flex items-center gap-3"><Avatar nombre={f.nombre} size="sm" /><div className="min-w-0"><p className="truncate font-medium">{f.nombre}</p><p className="truncate text-xs text-muted">{f.email}</p></div></div>
  ) };
  const rol: Column<Fila> = { key: 'rol', header: 'Rol', cell: f => (f.rol ? ROL_LABEL[f.rol] : '—') };
  const telefono: Column<Fila> = { key: 'telefono', header: 'Teléfono', hideBelow: 'lg', cell: f => <span className="num">{f.telefono ?? '—'}</span> };
  const acciones: Column<Fila> = { key: 'acciones', header: '', align: 'right', cell: f => (
    <div className="flex justify-end gap-1">
      <IconButton label={`Editar ${f.nombre}`} onClick={() => abrir(f)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
      <IconButton label={`Eliminar ${f.nombre}`} disabled={f.id === user?.id} onClick={() => setBorrar(f)}><TrashIcon className="h-4 w-4" /></IconButton>
    </div>
  ) };
  const columns: Column<Fila>[] = esResidente
    ? [
      persona, rol,
      { key: 'depto', header: 'Departamento', cell: f => (
        <div className="min-w-0"><p className="num truncate font-medium">{departamentos(f)}</p><p className="truncate text-xs text-muted">{ubicacion(f)}</p></div>
      ) },
      { key: 'estado', header: 'Estado', hideBelow: 'md', cell: f => (f.moroso ? <Badge tone="bad">Moroso</Badge> : <Badge tone="ok">Al día</Badge>) },
      { key: 'cargo', header: 'Cargo', hideBelow: 'md', cell: f => (f.cargo_junta ? cargoLabel(f.cargo_junta) : '—') },
      telefono, acciones,
    ]
    : esPersonal
      ? [
        persona, rol,
        { key: 'complejo', header: 'Trabaja en', hideBelow: 'md', cell: f => f.complejo?.nombre ?? <span className="text-muted">Toda la empresa</span> },
        ...(esSuper ? [{ key: 'empresa', header: 'Empresa', hideBelow: 'md' as const, cell: (f: Fila) => f.empresa?.nombre ?? '—' }] : []),
        telefono, acciones,
      ]
      : [persona, telefono, acciones];

  return (
    <>
      {!sinEncabezado ? (
        <PageHeader title={titulo ?? t.titulo} description={descripcion ?? t.descripcion} actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>{t.nuevo}</Button>} />
      ) : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{descripcion ?? t.descripcion}</p>
          <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>{t.nuevo}</Button>
        </div>
      )}
      {encima}
      <Card>
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por nombre o correo" />
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
            {tipo !== 'superadmin' && !complejoId && (
              <Select label="Filtrar por condominio" className="sm:w-52" value={filtroComplejo} onChange={e => { setFiltroComplejo(e.target.value); setFiltroTorre(''); }} disabled={complejos.loading} hint={complejos.error ? 'No se pudieron cargar los condominios.' : undefined}>
                <option value="">Todos los condominios</option>
                {(complejos.data?.items ?? []).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Select>
            )}
            {esResidente && (
              <>
                <Select label="Filtrar por torre" className="sm:w-40" value={filtroTorre} onChange={e => setFiltroTorre(e.target.value)} disabled={!filtroComplejo || torresFiltro.loading}>
                  <option value="">Todas las torres</option>
                  {(torresFiltro.data?.items ?? []).map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
                </Select>
                <Select label="Filtrar por estado" className="sm:w-40" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="moroso">Morosos</option>
                  <option value="al_dia">Al día</option>
                </Select>
              </>
            )}
            {esPersonal && (
              <Select label="Filtrar por rol" className="sm:w-44" value={filtroRol} onChange={e => setFiltroRol(e.target.value)}>
                <option value="">Todos los roles</option>
                {roles.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
              </Select>
            )}
            {esSuper && esPersonal && !empresaId && (
              <Select label="Filtrar por empresa" className="sm:w-52" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} disabled={empresas.loading} hint={empresas.error ? 'No se pudieron cargar las empresas.' : undefined}>
                <option value="">Todas las empresas</option>
                {(empresas.data?.items ?? []).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </Select>
            )}
          </div>
        </Toolbar>
        <DataTable
          caption={t.titulo}
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
            title: `No hay ${t.titulo.toLowerCase()}`,
            description: list.q || filtroRol || filtroEmpresa || filtroComplejo || filtroTorre || filtroEstado ? 'Prueba con otra búsqueda o quita los filtros.' : t.vacio,
            icon: <UsersIcon />,
          }}
        />
      </Card>

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando === 'nuevo' ? t.nuevo : `Editar ${t.singular}`}
        footer={<><Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{editando === 'nuevo' ? 'Crear' : 'Guardar cambios'}</Button></>}
      >
        <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input label="Nombre completo" className="sm:col-span-2" error={errors.nombre && 'Ingresa el nombre'} {...register('nombre', { required: true })} />
          <Input label="Correo electrónico" type="email" error={errors.email && 'Ingresa un correo válido'} {...register('email', { required: true, pattern: /^\S+@\S+\.\S+$/ })} />
          <Controller control={control} name="telefono" render={({ field }) => <TelefonoInput label="Teléfono" value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} name={field.name} />} />
          {roles.length > 1 && <Select label="Rol" {...register('rol', { required: true })}>{roles.map(r => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}</Select>}
          {esPersonal && esSuper && (
            <Select label="Empresa" hint="Para quién trabaja y qué ve." error={errors.empresa_id && 'Elige la empresa'} {...register('empresa_id', { validate: v => v !== '', onChange: () => setValue('complejo_id', '') })}>
              <option value="">Elige una empresa</option>
              {(empresas.data?.items ?? []).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </Select>
          )}
          {esPersonal && (
            <Select label="Trabaja en (opcional)" hint="Déjalo vacío si cubre toda la empresa." disabled={complejos.loading || (esSuper && !empresaElegida)} {...register('complejo_id')}>
              <option value="">Toda la empresa</option>
              {complejosDeLaEmpresa.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          )}
          {esResidente && (
            <Select
              label="Condominio"
              error={errors.complejo_id && 'Elige el condominio'}
              disabled={complejos.loading}
              {...register('complejo_id', { validate: v => !exigeCondominio || v !== '', onChange: () => setValue('estructura_id', '') })}
            >
              <option value="">{esSuper ? 'Sin condominio' : 'Elige un condominio'}</option>
              {complejosVisibles.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          )}
          {esResidente && (
            <Input
              label="Departamento (opcional)"
              placeholder="Ej. B01-804"
              hint="Código de la unidad; quedará como su departamento."
              disabled={!complejoElegido}
              {...register('unidad')}
            />
          )}
          {esResidente && rolElegido === 'propietario' && (
            <>
              <Select label="Cargo en la junta" className="sm:col-span-2" hint="Presidente y tesorero gestionan los medios de pago y validan los pagos de su torre. Secretario y vocal no ganan permisos." {...register('cargo_junta')}>
                <option value="">Ninguno</option>
                {CARGOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
              {cargoElegido && (
                <Select label="Torre de la junta" className="sm:col-span-2" disabled={!complejoElegido || torresJunta.loading} hint={torresJunta.error ? 'No se pudieron cargar las torres.' : 'Sin torre, la junta alcanza todo el condominio.'} {...register('estructura_id')}>
                  <option value="">Todo el condominio</option>
                  {(torresJunta.data?.items ?? []).map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
                </Select>
              )}
            </>
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
        title="Eliminar persona"
        message={`Se eliminará a ${borrar?.nombre ?? ''}. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
      />
    </>
  );
}
