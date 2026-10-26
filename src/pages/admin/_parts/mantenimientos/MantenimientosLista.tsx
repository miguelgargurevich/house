import { useEffect, useState } from 'react';
import { HomeModernIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../../api';
import { Button, DataTable, Select, SearchBox, StatusBadge, Toolbar, soles } from '../../../../ui';
import type { Column } from '../../../../ui';
import type { Mantenimiento } from '../../../shared/mantenimiento/tipos';

export const ESTADOS_FILTRO = [
  { value: 'vencido', label: 'Vencidos' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'parcial', label: 'Pago parcial' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'pagado', label: 'Pagados' },
] as const;

interface Props {
  reciboId: number;
  estructuraId?: number;
  /** Casas o edificios sin torre: sólo las unidades sin estructura. */
  sinBlock?: boolean;
  estado?: string;
  q?: string;
  /** Muestra la columna de la torre (lista plana de un condominio con varias torres). */
  mostrarBlock?: boolean;
  /** Barra con búsqueda por código y filtro de estado (si no, los filtros vienen de fuera). */
  conFiltros?: boolean;
  pageSize?: number;
  recargar?: number;
  onVer: (m: Mantenimiento) => void;
}

/** Recibos de departamento de un periodo: una fila por departamento (paginada en el servidor). */
export function MantenimientosLista({ reciboId, estructuraId, sinBlock, estado, q, mostrarBlock, conFiltros, pageSize = 20, recargar = 0, onVer }: Props) {
  const [estadoLocal, setEstadoLocal] = useState('');
  const efectivo = conFiltros ? estadoLocal : estado;
  const list = useList<Mantenimiento>(`/api/recibos/${reciboId}/mantenimientos`, {
    pageSize,
    params: { estructura_id: estructuraId !== undefined ? String(estructuraId) : undefined, sin_block: sinBlock ? 'true' : undefined, estado: efectivo || undefined, q: conFiltros ? undefined : q || undefined },
  });
  const { reload } = list;
  useEffect(() => { if (recargar > 0) void reload(); }, [recargar, reload]);

  const columns: Column<Mantenimiento>[] = [
    { key: 'unidad', header: 'Departamento', cell: m => (
      <button type="button" onClick={() => onVer(m)} className="text-left font-medium hover:text-brand">
        <span className="num">{m.unidad.codigo}</span>
        {mostrarBlock && m.unidad.estructura?.nombre && <span className="block text-xs font-normal text-muted">{m.unidad.estructura.nombre}</span>}
      </button>
    ) },
    { key: 'propietario', header: 'Propietario', hideBelow: 'sm', cell: m => m.propietario?.nombre ?? '—' },
    { key: 'total', header: 'Total', align: 'right', cell: m => <span className="num font-medium">{soles(m.total)}</span> },
    { key: 'cobrado', header: 'Pagado', align: 'right', hideBelow: 'md', cell: m => <span className="num text-muted">{soles(m.cobrado)}</span> },
    { key: 'saldo', header: 'Saldo', align: 'right', hideBelow: 'lg', cell: m => <span className="num">{soles(m.saldo)}</span> },
    { key: 'estado', header: 'Estado', cell: m => <StatusBadge estado={m.estado} /> },
    { key: 'acciones', header: '', align: 'right', cell: m => <Button size="sm" variant="secondary" onClick={() => onVer(m)}>Ver</Button> },
  ];

  return (
    <>
      {conFiltros && (
        <Toolbar>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por departamento (ej. A-101)" label="Buscar departamento" />
          <Select label="Estado" className="w-full sm:w-48 [&_label]:sr-only" value={estadoLocal} onChange={e => setEstadoLocal(e.target.value)}>
            <option value="">Todos los estados</option>
            {ESTADOS_FILTRO.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </Select>
        </Toolbar>
      )}
      <DataTable
        caption="Recibos de departamento del periodo"
        columns={columns}
        rows={list.items}
        rowKey={m => m.unidad_id}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPage={list.setPage}
        onRowClick={onVer}
        empty={{ title: 'No hay departamentos con ese filtro', description: 'Prueba con otro estado, torre o código.', icon: <HomeModernIcon /> }}
      />
    </>
  );
}
