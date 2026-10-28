import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { BuildingOffice2Icon, PencilSquareIcon, PlusIcon, TrashIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../../../api';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, Select, useToast,
} from '../../../../ui';
import type { Column } from '../../../../ui';

export interface Torre {
  id: number;
  nombre: string | null;
  tipo: string;
  complejo_id: number | null;
  unidades_count?: number;
  pisos_count?: number;
  /** «Correo del block» al que se envían los vouchers (sale en el recibo impreso). */
  correo_vouchers?: string | null;
}

interface Form { nombre: string; tipo: string; cantidad_pisos: string; correo_vouchers: string }

const TIPOS = ['Torre', 'Block'];
const nombreDe = (t: Torre) => t.nombre?.trim() || `Torre ${t.id}`;

/** Torres del condominio: alta (con sus pisos), edición, baja y asignación de las unidades que aún no tienen torre. */
export function TorresDelCondominio({ complejoId }: { complejoId: number }) {
  const toast = useToast();
  const list = useList<Torre>('/api/estructuras', { params: { complejo_id: String(complejoId) }, pageSize: 100 });
  const [editando, setEditando] = useState<Torre | 'nueva' | null>(null);
  const [borrar, setBorrar] = useState<Torre | null>(null);
  const [asignando, setAsignando] = useState<Torre | null>(null);
  const [busy, setBusy] = useState(false);

  const columns: Column<Torre>[] = [
    { key: 'nombre', header: 'Torre', cell: t => <span className="font-medium">{nombreDe(t)}</span> },
    { key: 'tipo', header: 'Tipo', hideBelow: 'sm', cell: t => <Badge tone="brand">{t.tipo}</Badge> },
    { key: 'pisos', header: 'Pisos', align: 'right', hideBelow: 'sm', cell: t => <span className="num">{t.pisos_count ?? 0}</span> },
    { key: 'unidades', header: 'Unidades', align: 'right', cell: t => <span className="num">{t.unidades_count ?? 0}</span> },
    { key: 'acciones', header: '', align: 'right', cell: t => (
      <div className="flex justify-end gap-1">
        <IconButton label={`Asignar a ${nombreDe(t)} las unidades que no tienen torre`} onClick={() => setAsignando(t)}><UserPlusIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Editar ${nombreDe(t)}`} onClick={() => setEditando(t)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Eliminar ${nombreDe(t)}`} onClick={() => setBorrar(t)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  async function confirmarBorrado() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/estructuras/${borrar.id}`, { method: 'DELETE' });
      toast.ok(`Torre ${nombreDe(borrar)} eliminada`);
      setBorrar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  async function asignar() {
    if (!asignando) return;
    setBusy(true);
    try {
      const r = await api<{ asignadas: number }>(`/api/estructuras/${asignando.id}/asignar-unidades`, { method: 'POST' });
      toast.ok(r.asignadas === 0
        ? 'No había unidades sin torre en este condominio'
        : `${r.asignadas} ${r.asignadas === 1 ? 'unidad quedó' : 'unidades quedaron'} en ${nombreDe(asignando)}`);
      setAsignando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <p className="text-sm text-muted">Las torres del condominio. Cada unidad puede pertenecer a una torre y a un piso.</p>
          <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva torre</Button>
        </div>
        <DataTable
          caption="Torres"
          columns={columns}
          rows={list.items}
          rowKey={t => t.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: 'Este condominio no tiene torres',
            description: 'Crea la primera torre para después asignarle las unidades.',
            icon: <BuildingOffice2Icon />,
            action: <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva torre</Button>,
          }}
        />
      </Card>

      <ModalTorre
        torre={editando}
        complejoId={complejoId}
        onClose={() => setEditando(null)}
        onGuardada={() => { setEditando(null); void list.reload(); }}
      />

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={confirmarBorrado}
        loading={busy}
        danger
        title="Eliminar torre"
        message={`Se eliminará la torre ${borrar ? nombreDe(borrar) : ''} y sus pisos. No se puede si tiene unidades o usuarios de junta asignados.`}
        confirmLabel="Eliminar torre"
      />

      <ConfirmDialog
        open={!!asignando}
        onClose={() => setAsignando(null)}
        onConfirm={asignar}
        loading={busy}
        title="Asignar torre a las unidades que no tienen"
        message={asignando ? `Todas las unidades de este condominio que todavía no tienen torre pasarán a ${nombreDe(asignando)}.` : ''}
        confirmLabel="Asignar"
      />
    </>
  );
}

function ModalTorre({ torre, complejoId, onClose, onGuardada }: { torre: Torre | 'nueva' | null; complejoId: number; onClose: () => void; onGuardada: () => void }) {
  const toast = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>();
  const esNueva = torre === 'nueva';

  useEffect(() => {
    if (!torre) return;
    reset(esNueva
      ? { nombre: '', tipo: 'Torre', cantidad_pisos: '', correo_vouchers: '' }
      : { nombre: torre.nombre ?? '', tipo: torre.tipo, cantidad_pisos: String(torre.pisos_count ?? ''), correo_vouchers: torre.correo_vouchers ?? '' });
  }, [torre, esNueva, reset]);

  async function guardar(v: Form) {
    const body = {
      nombre: v.nombre.trim() || null,
      tipo: v.tipo,
      complejo_id: complejoId,
      cantidad_pisos: v.cantidad_pisos === '' ? 0 : Number(v.cantidad_pisos),
      correo_vouchers: v.correo_vouchers.trim() || null,
    };
    try {
      await api(esNueva ? '/api/estructuras' : `/api/estructuras/${(torre as Torre).id}`, { method: esNueva ? 'POST' : 'PUT', json: body });
      toast.ok(esNueva ? 'Torre creada' : 'Cambios guardados');
      onGuardada();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={torre !== null}
      onClose={onClose}
      title={esNueva ? 'Nueva torre' : 'Editar torre'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{esNueva ? 'Crear torre' : 'Guardar cambios'}</Button></>}
    >
      <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Nombre" className="sm:col-span-2" placeholder="Ej. Torre 1" error={errors.nombre && 'Ingresa el nombre'} {...register('nombre')} />
        <Select label="Tipo" {...register('tipo', { required: true })}>
          {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Input
          label="Cantidad de pisos"
          type="number"
          min={0}
          max={60}
          placeholder="Ej. 6"
          hint={esNueva ? 'Se crean esos pisos (1, 2, 3…).' : 'Agrega los pisos que falten; los que ya existen no se borran.'}
          {...register('cantidad_pisos')}
        />
        <Input
          label="Correo del block para vouchers"
          type="email"
          className="sm:col-span-2"
          placeholder="juntadirectiva.block1@gmail.com"
          hint="Al que los vecinos envían su voucher de depósito; sale en su recibo."
          error={errors.correo_vouchers && 'Correo inválido'}
          {...register('correo_vouchers', { pattern: /^\S+@\S+\.\S+$|^$/ })}
        />
      </form>
    </Modal>
  );
}
