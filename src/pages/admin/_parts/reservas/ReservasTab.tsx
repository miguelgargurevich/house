import { useState } from 'react';
import { CalendarDaysIcon, CheckIcon, NoSymbolIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../../../api';
import { Bloqueable } from '../../../../app/Bloqueable';
import { Badge, Card, DataTable, IconButton, Input, Select, SearchBox, Toolbar, useToast } from '../../../../ui';
import type { Column } from '../../../../ui';
import { EstadoReservaBadge } from '../../../shared/_parts/reservas/EstadoReservaBadge';
import { cuandoDe, diaLargo, esVigente } from '../../../shared/_parts/reservas/tipos';
import type { AreaComun, Reserva } from '../../../shared/_parts/reservas/tipos';
import { MotivoModal } from './MotivoModal';

type Vista = 'proximas' | 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada' | 'todas';
const VISTAS: { id: Vista; label: string }[] = [
  { id: 'proximas', label: 'Próximas' },
  { id: 'pendiente', label: 'Pendientes de aprobar' },
  { id: 'aprobada', label: 'Aprobadas' },
  { id: 'rechazada', label: 'Rechazadas' },
  { id: 'cancelada', label: 'Canceladas' },
  { id: 'todas', label: 'Todas' },
];

type Accion = { tipo: 'rechazar' | 'cancelar'; reserva: Reserva };

/** Las reservas de los condominios de la administración: por día, por estado y por área, con aprobar, rechazar (con motivo) y cancelar. */
export function ReservasTab({ complejo, areas }: { complejo: string; areas: AreaComun[] }) {
  const toast = useToast();
  const [vista, setVista] = useState<Vista>('pendiente');
  const [dia, setDia] = useState('');
  const [area, setArea] = useState('');
  const [accion, setAccion] = useState<Accion | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const asc = vista === 'proximas' || vista === 'pendiente' || !!dia;
  const list = useList<Reserva>('/api/reservas', {
    params: {
      complejo_id: complejo || undefined,
      area_id: area || undefined,
      dia: dia || undefined,
      proximas: vista === 'proximas' ? 'true' : undefined,
      estado: vista === 'todas' || vista === 'proximas' ? undefined : vista,
      orden: asc ? 'inicio:asc' : 'inicio:desc',
    },
  });

  async function aprobar(r: Reserva) {
    setBusy(r.id);
    try {
      await api(`/api/reservas/${r.id}/aprobar`, { method: 'POST' });
      toast.ok('Reserva aprobada');
      void list.reload();
    } catch (e) { toast.error(errorText(e)); void list.reload(); } finally { setBusy(null); }
  }

  async function resolver(motivo: string) {
    if (!accion) return;
    const { tipo, reserva } = accion;
    try {
      await api(`/api/reservas/${reserva.id}/${tipo}`, { method: 'POST', json: motivo ? { motivo } : {} });
      toast.ok(tipo === 'rechazar' ? 'Reserva rechazada: el horario quedó libre' : 'Reserva cancelada: el horario quedó libre');
      setAccion(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); setAccion(null); void list.reload(); }
  }

  const columns: Column<Reserva>[] = [
    { key: 'reserva', header: 'Reserva', cell: r => (
      <div className="tabla-texto-largo min-w-0 max-w-[18rem]">
        <p className="font-medium">{r.area.nombre}</p>
        <p className="text-xs text-muted">Unidad {r.unidad.codigo}{r.usuario ? ` · ${r.usuario.nombre}` : ''}</p>
        <p className="num text-xs text-muted sm:hidden">{cuandoDe(r)}</p>
        {r.motivo && <p className="text-xs text-muted">Motivo: {r.motivo}</p>}
      </div>
    ) },
    { key: 'cuando', header: 'Fecha y hora', hideBelow: 'sm', cell: r => <span className="num block whitespace-nowrap"><span className="block">{diaLargo(r.dia)}</span><span className="block text-xs text-muted">{r.hora_inicio}–{r.hora_fin}</span></span> },
    { key: 'condominio', header: 'Condominio', hideBelow: 'lg', cell: r => <span className="tabla-texto-largo block">{r.area.complejo.nombre}</span> },
    { key: 'estado', header: 'Estado', cell: r => <EstadoReservaBadge estado={r.estado} /> },
    { key: 'acciones', header: '', align: 'right', cell: r => {
      const vigente = esVigente(r);
      if (!vigente) return r.estado === 'pendiente' ? <Badge>Ya pasó</Badge> : null;
      return (
        <div className="flex justify-end gap-1">
          {r.estado === 'pendiente' && (
            <>
              <Bloqueable>{b => <IconButton label={`Aprobar la reserva de ${r.area.nombre} (${cuandoDe(r)})`} disabled={b || busy === r.id} onClick={() => void aprobar(r)}><CheckIcon className="h-4 w-4" /></IconButton>}</Bloqueable>
              <Bloqueable>{b => <IconButton label={`Rechazar la reserva de ${r.area.nombre} (${cuandoDe(r)})`} disabled={b} onClick={() => setAccion({ tipo: 'rechazar', reserva: r })}><NoSymbolIcon className="h-4 w-4" /></IconButton>}</Bloqueable>
            </>
          )}
          <Bloqueable>{b => <IconButton label={`Cancelar la reserva de ${r.area.nombre} (${cuandoDe(r)})`} disabled={b} onClick={() => setAccion({ tipo: 'cancelar', reserva: r })}><XMarkIcon className="h-4 w-4" /></IconButton>}</Bloqueable>
        </div>
      );
    } },
  ];

  const hayFiltros = !!dia || !!area || !!list.q || vista !== 'todas';

  return (
    <>
      <Card>
        <Toolbar>
          <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
            <Select label="Ver" value={vista} onChange={e => setVista(e.target.value as Vista)}>
              {VISTAS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </Select>
            <Select label="Área" value={area} onChange={e => setArea(e.target.value)}>
              <option value="">Todas las áreas</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </Select>
            <Input label="Día" type="date" value={dia} onChange={e => setDia(e.target.value)} />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Buscar</span>
              <SearchBox value={list.q} onChange={list.setQ} placeholder="Unidad, vecino o área" />
            </div>
          </div>
        </Toolbar>
        <DataTable
          caption="Reservas de áreas comunes"
          columns={columns}
          rows={list.items}
          rowKey={r => r.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: vista === 'pendiente' && !dia && !area && !list.q ? 'No hay reservas por aprobar' : hayFiltros ? 'No hay reservas con estos filtros' : 'Aún no hay reservas',
            description: vista === 'pendiente' && !dia && !area && !list.q ? 'Cuando un vecino pida un área que requiere tu aprobación, aparecerá aquí.' : 'Cambia la vista, el área o el día para ver otras reservas.',
            icon: <CalendarDaysIcon />,
          }}
        />
      </Card>
      <MotivoModal
        open={!!accion}
        title={accion?.tipo === 'rechazar' ? 'Rechazar reserva' : 'Cancelar reserva'}
        description={accion ? `${accion.reserva.area.nombre} · ${cuandoDe(accion.reserva)} · unidad ${accion.reserva.unidad.codigo}. El horario quedará libre.` : ''}
        obligatorio={accion?.tipo === 'rechazar'}
        confirmLabel={accion?.tipo === 'rechazar' ? 'Rechazar reserva' : 'Cancelar reserva'}
        onClose={() => setAccion(null)}
        onConfirm={resolver}
      />
    </>
  );
}
