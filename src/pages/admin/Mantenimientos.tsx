import { useState } from 'react';
import { CheckIcon, PencilSquareIcon, PlayIcon, PlusIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { useCondominio } from '../../app/condominio';
import { api, errorText, useList } from '../../api';
import { Button, Card, DataTable, IconButton, PageHeader, SearchBox, StatusBadge, Tabs, Toolbar, fechaCorta, useToast } from '../../ui';
import type { Column } from '../../ui';
import { TareaModal } from './_parts/cobranza/TareaModal';
import type { Tarea } from './_parts/cobranza/TareaModal';

type Filtro = '' | 'pendiente' | 'en_progreso' | 'completada';
const TABS: { id: Filtro; label: string }[] = [
  { id: '', label: 'Todas' },
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'en_progreso', label: 'En progreso' },
  { id: 'completada', label: 'Completadas' },
];

export default function Mantenimientos() {
  const toast = useToast();
  const [filtro, setFiltro] = useState<Filtro>('');
  const [editando, setEditando] = useState<Tarea | 'nueva' | null>(null);
  const [cambiando, setCambiando] = useState<number | null>(null);
  const { complejo } = useCondominio();
  const list = useList<Tarea>('/api/tareas', { params: { estado: filtro || undefined, complejo_id: complejo || undefined } });

  async function cambiarEstado(t: Tarea, estado: 'en_progreso' | 'completada') {
    setCambiando(t.id);
    try {
      await api(`/api/tareas/${t.id}/estado`, { method: 'PATCH', json: { estado } });
      toast.ok(estado === 'completada' ? 'Tarea completada' : 'Tarea en progreso');
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setCambiando(null); }
  }

  const columns: Column<Tarea>[] = [
    { key: 'titulo', header: 'Tarea', cell: t => (
      <div className="min-w-0">
        <p className="tabla-texto-largo max-w-[18rem] font-medium">{t.titulo}</p>
        <p className="truncate text-xs text-muted md:hidden">{[t.unidad?.codigo, t.asignado?.nombre].filter(Boolean).join(' · ') || 'Sin unidad ni responsable'}</p>
      </div>
    ) },
    { key: 'unidad', header: 'Unidad', hideBelow: 'md', cell: t => t.unidad?.codigo ?? '—' },
    { key: 'asignado', header: 'Asignado a', hideBelow: 'md', cell: t => t.asignado?.nombre ?? <span className="text-muted">Sin asignar</span> },
    { key: 'estado', header: 'Estado', cell: t => <StatusBadge estado={t.estado} /> },
    { key: 'creada', header: 'Creada', hideBelow: 'lg', cell: t => fechaCorta(t.fecha_creacion) },
    { key: 'acciones', header: '', align: 'right', cell: t => (
      <div className="flex flex-wrap items-center justify-end gap-1">
        {t.estado === 'pendiente' && (
          <Button variant="secondary" icon={<PlayIcon className="h-4 w-4" />} loading={cambiando === t.id} onClick={() => void cambiarEstado(t, 'en_progreso')}>Iniciar</Button>
        )}
        {t.estado !== 'completada' && (
          <Button variant="secondary" icon={<CheckIcon className="h-4 w-4" />} loading={cambiando === t.id} onClick={() => void cambiarEstado(t, 'completada')}>Completar</Button>
        )}
        <IconButton label={`Editar ${t.titulo}`} onClick={() => setEditando(t)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Mantenimiento"
        description="Tareas de reparación y cuidado de tus condominios, y quién se encarga de cada una."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditando('nueva')}>Nueva tarea</Button>}
      />
      <Card>
        <Toolbar>
          <div className="max-w-full overflow-x-auto"><Tabs value={filtro} onChange={setFiltro} items={TABS} /></div>
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por título" />
        </Toolbar>
        <DataTable
          caption="Tareas de mantenimiento"
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
            title: filtro || list.q ? 'No hay tareas con ese filtro' : 'Aún no hay tareas',
            description: filtro || list.q ? 'Prueba con otra pestaña o búsqueda.' : 'Crea la primera y asígnala al personal de mantenimiento.',
            icon: <WrenchScrewdriverIcon />,
            action: filtro || list.q ? undefined : <Button onClick={() => setEditando('nueva')}>Nueva tarea</Button>,
          }}
        />
      </Card>

      {editando && <TareaModal tarea={editando === 'nueva' ? null : editando} onClose={() => setEditando(null)} onSaved={() => void list.reload()} />}
    </>
  );
}
