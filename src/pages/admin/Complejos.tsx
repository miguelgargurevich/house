import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BuildingStorefrontIcon, DocumentTextIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, IconButton, PageHeader, SearchBox, Toolbar, fechaCorta, useToast,
} from '../../ui';
import type { Column } from '../../ui';
import { ContratosModal } from './_parts/personas/ContratosModal';
import { ModalDeComplejo, type FilaComplejo } from './_parts/condominio/ModalDeComplejo';

const cantidad = (f: FilaComplejo) => f._count?.unidades ?? f.unidades_count;

export default function Complejos() {
  const { user } = useAuth();
  const toast = useToast();
  const esSuper = user?.rol === 'superadmin';
  const list = useList<FilaComplejo>('/api/complejos');
  const [editando, setEditando] = useState<FilaComplejo | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<FilaComplejo | null>(null);
  const [contratos, setContratos] = useState<FilaComplejo | null>(null);
  const [busy, setBusy] = useState(false);

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

  const columns: Column<FilaComplejo>[] = [
    { key: 'nombre', header: 'Condominio', cell: f => (
      <div className="min-w-0"><p className="truncate font-medium">{f.nombre}</p>{f.direccion && <p className="truncate text-xs text-muted sm:hidden">{f.direccion}</p>}</div>
    ) },
    { key: 'tipo', header: 'Tipo', cell: f => <Badge tone="brand">{f.tipo}</Badge> },
    { key: 'direccion', header: 'Dirección', hideBelow: 'sm', cell: f => f.direccion ?? '—' },
    { key: 'empresa', header: 'Administrado por', hideBelow: 'md', cell: f => (
      <div className="min-w-0"><p className="truncate">{f.empresa?.nombre ?? '—'}</p>{f.contrato_vigente && <p className="truncate text-xs text-muted">Desde <span className="num">{fechaCorta(f.contrato_vigente.fecha_inicio)}</span></p>}</div>
    ) },
    { key: 'unidades', header: 'Unidades', align: 'right', hideBelow: 'md', cell: f => <span className="num">{cantidad(f) ?? '—'}</span> },
    { key: 'acciones', header: '', align: 'right', cell: f => (
      <div className="flex justify-end gap-1">
        <Link to={`/admin/condominios/${f.id}`} className="inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-brand hover:underline">Ver ficha</Link>
        <IconButton label={`Contratos de administración de ${f.nombre}`} onClick={() => setContratos(f)}><DocumentTextIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Editar ${f.nombre}`} onClick={() => setEditando(f)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Eliminar ${f.nombre}`} onClick={() => setBorrar(f)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Condominios"
        description="Edificios, condominios y conjuntos residenciales que administras. Cada unidad y cada recibo pertenece a uno."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditando('nuevo')}>Nuevo condominio</Button>}
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
            action: list.q ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditando('nuevo')}>Nuevo condominio</Button>,
          }}
        />
      </Card>

      <ModalDeComplejo complejo={editando} esSuper={esSuper} onClose={() => setEditando(null)} onGuardado={() => void list.reload()} />

      {contratos && <ContratosModal complejo={contratos} puedeCambiar={esSuper} onClose={() => setContratos(null)} onCambiado={() => void list.reload()} />}

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
