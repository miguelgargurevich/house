import { useState } from 'react';
import { BuildingStorefrontIcon, PencilSquareIcon, PlusIcon, PowerIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../../../api';
import { Bloqueable } from '../../../../app/Bloqueable';
import type { CondominioOpcion } from '../../../../app/condominio';
import { Alert, Badge, Button, Card, ConfirmDialog, DataTable, IconButton, SearchBox, Toolbar, useToast } from '../../../../ui';
import type { Column } from '../../../../ui';
import type { AreaComun } from '../../../shared/_parts/reservas/tipos';
import { AreaModal } from './AreaModal';

/** Las áreas comunes del condominio elegido: crear, editar y activar o desactivar (desactivar no borra ni toca las reservas que ya hay). */
export function AreasTab({ condominios, complejo }: { condominios: CondominioOpcion[]; complejo: string }) {
  const toast = useToast();
  const list = useList<AreaComun>('/api/areas-comunes', { params: { complejo_id: complejo || undefined } });
  const [editando, setEditando] = useState<AreaComun | 'nueva' | null>(null);
  const [apagar, setApagar] = useState<AreaComun | null>(null);
  const [busy, setBusy] = useState(false);

  async function cambiarActiva(a: AreaComun, activa: boolean) {
    setBusy(true);
    try {
      await api(`/api/areas-comunes/${a.id}`, { method: 'PATCH', json: { activa } });
      toast.ok(activa ? 'Área activada: los vecinos ya pueden reservarla' : 'Área desactivada: no admite reservas nuevas');
      setApagar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<AreaComun>[] = [
    { key: 'nombre', header: 'Área', cell: a => (
      <div className="tabla-texto-largo min-w-0 max-w-[18rem]">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium"><span>{a.nombre}</span>{!a.activa && <Badge>Desactivada</Badge>}</p>
        {a.descripcion && <p className="truncate text-xs text-muted">{a.descripcion}</p>}
        <p className="text-xs text-muted sm:hidden">{a.hora_apertura}–{a.hora_cierre} · {a.requiere_aprobacion ? 'Con aprobación' : 'Al instante'}</p>
      </div>
    ) },
    { key: 'condominio', header: 'Condominio', hideBelow: 'md', cell: a => <span className="tabla-texto-largo block">{a.complejo.nombre}</span> },
    { key: 'horario', header: 'Horario', hideBelow: 'sm', cell: a => (
      <span className="block"><span className="num block">{a.hora_apertura}–{a.hora_cierre}</span><span className="block text-xs text-muted">hasta {a.duracion_max_horas} h seguidas</span></span>
    ) },
    { key: 'reglas', header: 'Reservas', hideBelow: 'lg', cell: a => (
      <span className="tabla-texto-largo block"><span className="block">{a.requiere_aprobacion ? 'Con aprobación' : 'Se confirman al instante'}</span><span className="block text-xs text-muted">hasta {a.dias_anticipacion_max} días antes{a.capacidad ? ` · ${a.capacidad} personas` : ''}</span></span>
    ) },
    { key: 'acciones', header: '', align: 'right', cell: a => (
      <div className="flex justify-end gap-1">
        <Bloqueable>{b => <IconButton label={`Editar «${a.nombre}»`} disabled={b} onClick={() => setEditando(a)}><PencilSquareIcon className="h-4 w-4" /></IconButton>}</Bloqueable>
        <Bloqueable>{b => <IconButton label={a.activa ? `Desactivar «${a.nombre}»` : `Activar «${a.nombre}»`} disabled={b || busy} onClick={() => (a.activa ? setApagar(a) : void cambiarActiva(a, true))}><PowerIcon className="h-4 w-4" /></IconButton>}</Bloqueable>
      </div>
    ) },
  ];

  const puedeCrear = condominios.length > 0;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Bloqueable>{b => <Button icon={<PlusIcon className="h-4 w-4" />} disabled={!puedeCrear || b} onClick={() => setEditando('nueva')}>Nueva área</Button>}</Bloqueable>
      </div>
      <Card>
        <Toolbar><SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar un área" /></Toolbar>
        <DataTable
          caption="Áreas comunes"
          columns={columns}
          rows={list.items}
          rowKey={a => a.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: list.q ? 'No hay áreas con esa búsqueda' : 'Aún no hay áreas comunes',
            description: list.q ? 'Prueba con otro nombre.' : 'Crea el salón de eventos, la parrilla o la piscina para que tus vecinos las reserven desde su celular.',
            icon: <BuildingStorefrontIcon />,
            action: puedeCrear && !list.q ? <Bloqueable>{b => <Button disabled={b} onClick={() => setEditando('nueva')}>Nueva área</Button>}</Bloqueable> : undefined,
          }}
        />
      </Card>
      {!puedeCrear && <div className="mt-4"><Alert tone="info">Primero crea un condominio para poder agregarle áreas comunes.</Alert></div>}
      <p className="mt-3 text-xs text-muted">Horario y días se leen en la zona horaria de cada condominio.</p>

      <AreaModal area={editando} condominios={condominios} inicial={complejo} onClose={() => setEditando(null)} onSaved={() => void list.reload()} />
      <ConfirmDialog
        open={!!apagar}
        onClose={() => setApagar(null)}
        onConfirm={() => apagar ? cambiarActiva(apagar, false) : undefined}
        loading={busy}
        danger
        title="Desactivar área"
        message={`«${apagar?.nombre ?? ''}» dejará de admitir reservas nuevas y de verse para los vecinos. Las reservas que ya existen siguen vigentes: cancélalas aparte si hace falta. Puedes activarla de nuevo cuando quieras.`}
        confirmLabel="Desactivar"
      />
    </>
  );
}
