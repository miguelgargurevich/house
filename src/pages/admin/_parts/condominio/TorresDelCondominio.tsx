import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { BuildingOffice2Icon, ChatBubbleLeftRightIcon, PencilSquareIcon, PlusIcon, TrashIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../../../api';
import {
  Alert, Badge, Button, Card, ConfirmDialog, DataTable, IconButton, Input, Modal, Select, Skeleton, useToast,
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
  /** Grupo de WhatsApp elegido para el block (el nombre que tiene en WhatsApp) y el último problema al escribirle. */
  whatsapp_grupo_nombre?: string | null;
  whatsapp_grupo_aviso?: string | null;
}

interface GruposWhatsapp {
  conectado: boolean;
  grupos: { jid: string; nombre: string }[];
  actual: { jid: string; nombre: string | null; aviso: string | null } | null;
}

interface Form { nombre: string; tipo: string; cantidad_pisos: string; correo_vouchers: string }

const TIPOS = ['Torre', 'Block'];
const nombreDe = (t: Torre) => t.nombre?.trim() || `Block ${t.id}`;

/** Torres del condominio: alta (con sus pisos), edición, baja y asignación de las unidades que aún no tienen torre. */
export function TorresDelCondominio({ complejoId }: { complejoId: number }) {
  const toast = useToast();
  const list = useList<Torre>('/api/estructuras', { params: { complejo_id: String(complejoId) }, pageSize: 100 });
  const [editando, setEditando] = useState<Torre | 'nueva' | null>(null);
  const [borrar, setBorrar] = useState<Torre | null>(null);
  const [asignando, setAsignando] = useState<Torre | null>(null);
  const [grupo, setGrupo] = useState<Torre | null>(null);
  const [busy, setBusy] = useState(false);

  const columns: Column<Torre>[] = [
    { key: 'nombre', header: 'Block', cell: t => (
      <span className="block">
        <span className="font-medium">{nombreDe(t)}</span>
        {t.whatsapp_grupo_aviso && <span className="block text-xs text-bad sm:hidden">{t.whatsapp_grupo_aviso}</span>}
      </span>
    ) },
    { key: 'grupo', header: 'Grupo de WhatsApp', hideBelow: 'sm', cell: t => (
      <span className="tabla-texto-largo block">
        {t.whatsapp_grupo_nombre ? <span className="block">{t.whatsapp_grupo_nombre}</span> : <span className="text-muted">Sin grupo</span>}
        {t.whatsapp_grupo_aviso && <span className="block text-xs text-bad">{t.whatsapp_grupo_aviso}</span>}
      </span>
    ) },
    { key: 'tipo', header: 'Tipo', hideBelow: 'sm', cell: t => <Badge tone="brand">{t.tipo}</Badge> },
    { key: 'pisos', header: 'Pisos', align: 'right', hideBelow: 'sm', cell: t => <span className="num">{t.pisos_count ?? 0}</span> },
    { key: 'unidades', header: 'Unidades', align: 'right', cell: t => <span className="num">{t.unidades_count ?? 0}</span> },
    { key: 'acciones', header: '', align: 'right', cell: t => (
      <div className="flex justify-end gap-1">
        <IconButton label={`Asignar a ${nombreDe(t)} las unidades que no tienen block`} onClick={() => setAsignando(t)}><UserPlusIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Grupo de WhatsApp de ${nombreDe(t)}`} onClick={() => setGrupo(t)}><ChatBubbleLeftRightIcon className="h-4 w-4" /></IconButton>
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
      toast.ok(`Block ${nombreDe(borrar)} eliminado`);
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
        ? 'No había unidades sin block en este condominio'
        : `${r.asignadas} ${r.asignadas === 1 ? 'unidad quedó' : 'unidades quedaron'} en ${nombreDe(asignando)}`);
      setAsignando(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <p className="text-sm text-muted">Los blocks del condominio. Cada unidad puede pertenecer a un block y a un piso.</p>
          <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nuevo block</Button>
        </div>
        <DataTable
          caption="Blocks"
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
            title: 'Este condominio no tiene blocks',
            description: 'Crea el primer block para después asignarle las unidades.',
            icon: <BuildingOffice2Icon />,
            action: <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nuevo block</Button>,
          }}
        />
      </Card>

      <ModalTorre
        torre={editando}
        complejoId={complejoId}
        onClose={() => setEditando(null)}
        onGuardada={() => { setEditando(null); void list.reload(); }}
      />

      <ModalGrupo torre={grupo} onClose={() => setGrupo(null)} onGuardado={() => { setGrupo(null); void list.reload(); }} />

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={confirmarBorrado}
        loading={busy}
        danger
        title="Eliminar block"
        message={`Se eliminará el block ${borrar ? nombreDe(borrar) : ''} y sus pisos. No se puede si tiene unidades o usuarios de junta asignados.`}
        confirmLabel="Eliminar block"
      />

      <ConfirmDialog
        open={!!asignando}
        onClose={() => setAsignando(null)}
        onConfirm={asignar}
        loading={busy}
        title="Asignar block a las unidades que no tienen"
        message={asignando ? `Todas las unidades de este condominio que todavía no tienen block pasarán a ${nombreDe(asignando)}.` : ''}
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
      toast.ok(esNueva ? 'Block creado' : 'Cambios guardados');
      onGuardada();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={torre !== null}
      onClose={onClose}
      title={esNueva ? 'Nuevo block' : 'Editar block'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{esNueva ? 'Crear block' : 'Guardar cambios'}</Button></>}
    >
      <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Nombre" className="sm:col-span-2" placeholder="Ej. Block 1" error={errors.nombre && 'Ingresa el nombre'} {...register('nombre')} />
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
          hint="Al que los vecinos envían su voucher de depósito; sale en su recibo. Es el mismo correo de la junta del block («Juntas directivas»)."
          error={errors.correo_vouchers && 'Correo inválido'}
          {...register('correo_vouchers', { pattern: /^\S+@\S+\.\S+$|^$/ })}
        />
      </form>
    </Modal>
  );
}

/**
 * Elegir el grupo de WhatsApp del block. La lista la trae Torre del número de la administradora (sólo los grupos donde ese número está): nunca se
 * escribe el identificador a mano. Con ese grupo, los comunicados pueden mandar UN mensaje al block en vez de uno por vecino.
 */
function ModalGrupo({ torre, onClose, onGuardado }: { torre: Torre | null; onClose: () => void; onGuardado: () => void }) {
  const toast = useToast();
  const [datos, setDatos] = useState<GruposWhatsapp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jid, setJid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!torre) return;
    let vivo = true;
    setDatos(null);
    setError(null);
    api<GruposWhatsapp>(`/api/estructuras/${torre.id}/grupos-whatsapp`)
      .then(r => { if (vivo) { setDatos(r); setJid(r.actual?.jid ?? ''); } })
      .catch(e => { if (vivo) setError(errorText(e)); });
    return () => { vivo = false; };
  }, [torre]);

  async function guardar(nuevo: string | null) {
    if (!torre) return;
    setBusy(true);
    try {
      await api(`/api/estructuras/${torre.id}/grupo-whatsapp`, { method: 'PUT', json: { jid: nuevo } });
      toast.ok(nuevo ? 'Grupo de WhatsApp guardado' : 'Grupo de WhatsApp quitado');
      onGuardado();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const nombre = torre ? nombreDe(torre) : '';
  // El grupo guardado puede haber desaparecido de la lista (ya no está el número): se avisa en vez de ofrecerlo como si nada.
  const huerfano = !!datos?.actual && !datos.grupos.some(g => g.jid === datos.actual!.jid);
  return (
    <Modal
      open={torre !== null}
      onClose={onClose}
      title={`Grupo de WhatsApp de ${nombre}`}
      description="Los comunicados pueden avisar a todo el block con un solo mensaje a su grupo, en vez de uno por vecino."
      footer={<>
        {datos?.actual && <Button variant="secondary" loading={busy} onClick={() => void guardar(null)}>Quitar grupo</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={busy} disabled={!datos?.conectado || !jid || jid === datos.actual?.jid} onClick={() => void guardar(jid)}>Guardar</Button>
      </>}
    >
      {error ? <Alert tone="bad">{error}</Alert>
        : !datos ? <Skeleton className="h-16 w-full" />
        : !datos.conectado ? (
          <Alert tone="warn">
            Primero conecta tu número de WhatsApp: sin él Torre no puede traer tus grupos. <Link to="/admin/whatsapp" className="font-medium underline">Conectar WhatsApp</Link>
          </Alert>
        ) : (
          <div className="grid gap-3">
            {datos.grupos.length === 0 && <Alert tone="warn">Tu número no está en ningún grupo. Agrégalo al grupo del block desde WhatsApp y vuelve a abrir esta ventana.</Alert>}
            {datos.actual?.aviso && <Alert tone="bad">{datos.actual.aviso}. Revisa que el número siga en el grupo.</Alert>}
            {huerfano && <Alert tone="warn">El grupo «{datos.actual?.nombre}» ya no aparece entre los grupos de tu número. Elige otro o quítalo.</Alert>}
            <Select label="Grupo del block" hint="Sólo se listan los grupos donde está el número de tu administradora." value={jid} onChange={e => setJid(e.target.value)}>
              <option value="">Elige un grupo</option>
              {datos.grupos.map(g => <option key={g.jid} value={g.jid}>{g.nombre}</option>)}
            </Select>
          </div>
        )}
    </Modal>
  );
}
