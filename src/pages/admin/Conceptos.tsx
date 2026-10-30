import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { PencilSquareIcon, PlusIcon, TagIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../api';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, PageHeader, SearchBox, Select, Textarea, Toolbar, useToast,
} from '../../ui';
import type { Column } from '../../ui';
import { Interruptor } from './_parts/catalogo/Interruptor';
import { TIPOS_MONTO } from './_parts/catalogo/opciones';
import { DESTINOS, etiquetaDestino } from './_parts/cierres/vista';

interface Fila {
  id: number; nombre: string; descripcion: string | null; tipo_monto: string | null; activo: boolean;
  /** Adónde va lo cobrado con este concepto al cerrar el mes (null = sin clasificar) y, sin destino, lo que sugiere el nombre (nunca se guarda solo). */
  destino: string | null; destino_sugerido: string | null; proveedor_id: number | null; proveedor: { id: number; razon_social: string } | null;
}
interface Form { nombre: string; descripcion: string; tipo_monto: string; activo: boolean; destino: string; proveedor_id: string }

const etiquetaMonto = (v: string | null) => TIPOS_MONTO.find(t => t.value === (v ?? 'fijo'))?.label ?? v ?? '—';

export default function Conceptos() {
  const toast = useToast();
  const list = useList<Fila>('/api/conceptos');
  const proveedores = useList<{ id: number; razon_social: string }>('/api/proveedores', { pageSize: 100 });
  const [editando, setEditando] = useState<Fila | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<Fila | null>(null);
  const [busy, setBusy] = useState(false);
  const [cambiando, setCambiando] = useState<number | null>(null);
  const { register, handleSubmit, reset, setValue, control, formState: { errors, isSubmitting } } = useForm<Form>();
  const destino = useWatch({ control, name: 'destino' });
  const nombre = useWatch({ control, name: 'nombre' });
  const sugerido = editando && editando !== 'nuevo' ? editando.destino_sugerido : null;

  function abrir(f: Fila | 'nuevo') {
    reset(f === 'nuevo'
      ? { nombre: '', descripcion: '', tipo_monto: 'fijo', activo: true, destino: '', proveedor_id: '' }
      : { nombre: f.nombre, descripcion: f.descripcion ?? '', tipo_monto: f.tipo_monto ?? 'fijo', activo: f.activo, destino: f.destino ?? '', proveedor_id: f.proveedor_id ? String(f.proveedor_id) : '' });
    setEditando(f);
  }

  async function guardar(v: Form) {
    const nuevo = editando === 'nuevo';
    const body = {
      nombre: v.nombre.trim(), descripcion: v.descripcion.trim() || null, tipo_monto: v.tipo_monto, activo: v.activo,
      destino: v.destino || null, proveedor_id: v.destino === 'proveedor' && v.proveedor_id ? Number(v.proveedor_id) : null,
    };
    try {
      await api(nuevo ? '/api/conceptos' : `/api/conceptos/${(editando as Fila).id}`, { method: nuevo ? 'POST' : 'PUT', json: body });
      toast.ok(nuevo ? 'Concepto creado' : 'Cambios guardados');
      setEditando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function alternar(f: Fila) {
    setCambiando(f.id);
    try {
      await api(`/api/conceptos/${f.id}`, { method: 'PUT', json: { activo: !f.activo } });
      toast.ok(f.activo ? `«${f.nombre}» desactivado` : `«${f.nombre}» activado`);
      await list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setCambiando(null); }
  }

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/conceptos/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Concepto eliminado');
      setBorrar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Fila>[] = [
    { key: 'nombre', header: 'Concepto', cell: f => (
      <div className="min-w-0"><p className="font-medium">{f.nombre}</p>{f.descripcion && <p className="break-words text-xs text-muted sm:hidden">{f.descripcion}</p>}</div>
    ) },
    { key: 'descripcion', header: 'Descripción', hideBelow: 'sm', cell: f => f.descripcion ?? '—' },
    { key: 'tipo', header: 'Tipo de monto', hideBelow: 'md', cell: f => <Badge>{etiquetaMonto(f.tipo_monto)}</Badge> },
    { key: 'destino', header: 'Destino al cerrar el mes', cell: f => f.destino
      ? <span className="break-words text-sm">{etiquetaDestino(f.destino)}{f.proveedor ? ` · ${f.proveedor.razon_social}` : ''}</span>
      : <span className="break-words text-sm text-warn">Sin clasificar{f.destino_sugerido ? <span className="block text-xs text-muted">Sugerido: {etiquetaDestino(f.destino_sugerido)}</span> : null}</span> },
    { key: 'activo', header: 'Activo', cell: f => (
      <Interruptor
        label={f.activo ? 'Activo' : 'Inactivo'}
        checked={f.activo}
        disabled={cambiando === f.id}
        onChange={() => void alternar(f)}
        className="min-h-0 [&>span:last-child]:text-muted"
      />
    ) },
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
        title="Conceptos"
        description="Lo que se cobra en cada recibo: cuota de mantenimiento, agua, luz de áreas comunes, recargo por mora."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nuevo concepto</Button>}
      />
      <Card>
        <Toolbar><SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar concepto" /></Toolbar>
        <DataTable
          caption="Conceptos de cobro"
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
            title: list.q ? 'Sin resultados' : 'Aún no hay conceptos de cobro',
            description: list.q
              ? 'Prueba con otra búsqueda.'
              : 'Los conceptos son lo que cobras en cada recibo: cuota de mantenimiento, agua, luz de áreas comunes o recargo por mora. Crea al menos uno antes de emitir tu primer recibo.',
            icon: <TagIcon />,
            action: list.q ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => abrir('nuevo')}>Nuevo concepto</Button>,
          }}
        />
      </Card>

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando === 'nuevo' ? 'Nuevo concepto' : 'Editar concepto'}
        footer={<><Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{editando === 'nuevo' ? 'Crear concepto' : 'Guardar cambios'}</Button></>}
      >
        <form onSubmit={handleSubmit(guardar)} className="grid gap-4" noValidate>
          <Input label="Nombre" placeholder="Ej. Cuota de mantenimiento" error={errors.nombre && 'Ingresa el nombre'} {...register('nombre', { required: true, validate: v => !!v.trim() })} />
          <Select
            label="Tipo de monto"
            hint="Fijo: el mismo monto para todas. Variable: lo defines al emitir el recibo. Prorrateo: se reparte entre las unidades."
            {...register('tipo_monto', { required: true })}
          >
            {TIPOS_MONTO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Textarea label="Descripción" {...register('descripcion')} />
          <div className="grid gap-2">
            <Select
              label="Destino al cerrar el mes"
              hint={DESTINOS.find(d => d.value === destino)?.ayuda ?? 'Sin clasificar: este concepto no entra al cierre del mes de los blocks hasta que elijas adónde va.'}
              {...register('destino')}
            >
              <option value="">Sin clasificar</option>
              {DESTINOS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </Select>
            {sugerido && !destino && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                Por el nombre parece «{etiquetaDestino(sugerido)}».
                <Button size="sm" variant="secondary" onClick={() => setValue('destino', sugerido)}>Usar esta sugerencia</Button>
              </p>
            )}
            {destino === 'proveedor' && (
              <Select label="Proveedor" hint={`Quien presta «${nombre?.trim() || 'este servicio'}»: el tesorero ve su cuenta al pagarle.`} {...register('proveedor_id')}>
                <option value="">Sin proveedor</option>
                {proveedores.items.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
              </Select>
            )}
          </div>
          <Interruptor label="Concepto activo" hint="Los conceptos inactivos no se ofrecen al emitir recibos." {...register('activo')} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Eliminar concepto"
        message={`Se eliminará «${borrar?.nombre ?? ''}». Si ya se usó en recibos, mejor desactívalo. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar concepto"
      />
    </>
  );
}
