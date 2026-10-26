import { useState } from 'react';
import { KeyIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList, useResource, type Page } from '../../../../api';
import {
  Button, Card, ConfirmDialog, DataTable, IconButton, SearchBox, StatusBadge, Toolbar, useToast,
} from '../../../../ui';
import type { Column } from '../../../../ui';
import { FiltroSelect } from '../catalogo/FiltroSelect';
import { useOpciones } from '../catalogo/opciones';
import { ModalDeUnidad } from './ModalDeUnidad';
import { ESTADOS_UNIDAD, nombreTorre, type FilaUnidad, type Torre } from './tipos';

interface Props {
  /** Condominio fijo: la lista muestra sólo sus unidades y no ofrece el filtro de condominio. */
  complejoId?: number;
  complejoNombre?: string;
  /** Unidad en edición (`'nuevo'` para el alta). Lo lleva la página para que su cabecera pueda abrir el alta. */
  editando: FilaUnidad | 'nuevo' | null;
  onEditando: (u: FilaUnidad | 'nuevo' | null) => void;
}

/** Tabla de unidades con su filtro de torre. Se usa sola (pantalla Unidades) y dentro de la ficha del condominio. */
export function ListaDeUnidades({ complejoId, complejoNombre, editando, onEditando }: Props) {
  const toast = useToast();
  const [complejo, setComplejo] = useState(complejoId ? String(complejoId) : '');
  const [torre, setTorre] = useState('');
  const [estado, setEstado] = useState('');
  const list = useList<FilaUnidad>('/api/unidades', { params: { complejo_id: complejo || undefined, estructura_id: torre || undefined, estado: estado || undefined } });
  const complejos = useOpciones(complejoId ? null : '/api/complejos');
  const torres = useResource<Page<Torre>>(complejo ? `/api/estructuras?complejo_id=${complejo}&pageSize=100` : null);
  const [borrar, setBorrar] = useState<FilaUnidad | null>(null);
  const [busy, setBusy] = useState(false);

  const filtrado = !!(list.q || torre || estado || (complejoId ? false : complejo));

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

  const columns: Column<FilaUnidad>[] = [
    { key: 'codigo', header: 'Código', cell: f => (
      <div className="min-w-0"><p className="font-medium num">{f.codigo}</p><p className="truncate text-xs text-muted sm:hidden">{f.tipo}{f.estructura ? ` · ${nombreTorre(f.estructura)}` : ''}</p></div>
    ) },
    { key: 'tipo', header: 'Tipo', hideBelow: 'sm', cell: f => f.tipo },
    { key: 'torre', header: 'Torre', hideBelow: 'sm', cell: f => f.estructura ? nombreTorre(f.estructura) : <span className="text-muted">Sin torre</span> },
    { key: 'complejo', header: 'Condominio', hideBelow: 'md', cell: f => f.complejo?.nombre ?? '—' },
    { key: 'propietario', header: 'Propietario', hideBelow: 'md', cell: f => f.propietario?.nombre ?? <span className="text-muted">Sin asignar</span> },
    { key: 'inquilino', header: 'Inquilino', hideBelow: 'lg', cell: f => f.inquilino?.nombre ?? <span className="text-muted">—</span> },
    { key: 'estado', header: 'Estado', cell: f => <StatusBadge estado={f.estado} /> },
    { key: 'acciones', header: '', align: 'right', cell: f => (
      <div className="flex justify-end gap-1">
        <IconButton label={`Editar unidad ${f.codigo}`} onClick={() => onEditando(f)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Eliminar unidad ${f.codigo}`} onClick={() => setBorrar(f)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  const sinComplejos = !complejoId && !complejos.loading && complejos.opciones.length === 0;

  return (
    <>
      <Card>
        {complejoId && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <p className="text-sm text-muted">Las unidades de este condominio, con su torre y su piso.</p>
            <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => onEditando('nuevo')}>Nueva unidad</Button>
          </div>
        )}
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por código" />
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {!complejoId && (
              <FiltroSelect label="Filtrar por condominio" value={complejo} onChange={v => { setComplejo(v); setTorre(''); }} className="sm:w-52">
                <option value="">Todos los condominios</option>
                {complejos.opciones.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </FiltroSelect>
            )}
            <FiltroSelect label="Filtrar por torre" value={torre} onChange={setTorre} className="sm:w-44">
              <option value="">Todas las torres</option>
              {(torres.data?.items ?? []).map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
            </FiltroSelect>
            <FiltroSelect label="Filtrar por estado" value={estado} onChange={setEstado} className="sm:w-40">
              <option value="">Todos los estados</option>
              {ESTADOS_UNIDAD.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
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
            action: filtrado || sinComplejos ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => onEditando('nuevo')}>Nueva unidad</Button>,
          }}
        />
      </Card>

      <ModalDeUnidad
        unidad={editando}
        complejoId={complejoId}
        complejoNombre={complejoNombre}
        onClose={() => onEditando(null)}
        onGuardada={() => { onEditando(null); void list.reload(); }}
      />

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
