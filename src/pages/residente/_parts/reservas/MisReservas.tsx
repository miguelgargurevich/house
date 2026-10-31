import { useState } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Bloqueable } from '../../../../app/Bloqueable';
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Skeleton, Tabs, useToast } from '../../../../ui';
import { EstadoReservaBadge } from '../../../shared/_parts/reservas/EstadoReservaBadge';
import { cuandoDe, puedeCancelarVecino } from '../../../shared/_parts/reservas/tipos';
import type { Reserva } from '../../../shared/_parts/reservas/tipos';
import { Pager } from '../Pager';

export type VistaMias = 'proximas' | 'historial';
type Lista = { items: Reserva[]; total: number; page: number; pageSize: number; setPage: (p: number) => void; loading: boolean; error: string | null; reload: () => void | Promise<void> };

/** «Mis reservas»: las próximas (con cancelar) y el historial. Sólo ve las que él pidió. */
export function MisReservas({ vista, onVista, lista }: { vista: VistaMias; onVista: (v: VistaMias) => void; lista: Lista }) {
  const toast = useToast();
  const [cancelar, setCancelar] = useState<Reserva | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmar() {
    if (!cancelar) return;
    setBusy(true);
    try {
      await api(`/api/reservas/${cancelar.id}/cancelar`, { method: 'POST', json: {} });
      toast.ok('Reserva cancelada: el horario quedó libre');
      setCancelar(null);
      void lista.reload();
    } catch (e) { toast.error(errorText(e)); setCancelar(null); void lista.reload(); } finally { setBusy(false); }
  }

  return (
    <>
      <Card>
        <CardHeader title="Mis reservas" description="Lo que has reservado. Puedes cancelar las que aún no empiezan." />
        <div className="px-5 py-3">
          <Tabs<VistaMias> value={vista} onChange={onVista} idBase="mis-reservas" label="Mis reservas" items={[{ id: 'proximas', label: 'Próximas' }, { id: 'historial', label: 'Historial' }]} />
        </div>
        {lista.error ? <ErrorState message={lista.error} onRetry={lista.reload} />
          : lista.loading && lista.items.length === 0 ? <div className="space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          : lista.items.length === 0 ? <EmptyState icon={<CalendarDaysIcon />} title={vista === 'proximas' ? 'No tienes reservas próximas' : 'Aún no has reservado nada'} description="Elige un área y un día, y tu reserva aparecerá aquí." />
          : (
            <ul className="divide-y divide-line">
              {lista.items.map(r => (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="break-words font-medium">{r.area.nombre}</span><EstadoReservaBadge estado={r.estado} /></p>
                    <p className="num text-sm text-muted">{cuandoDe(r)} · unidad {r.unidad.codigo}</p>
                    {r.estado === 'pendiente' && <p className="text-xs text-muted">Esperando la aprobación de la administración.</p>}
                    {r.motivo && (r.estado === 'rechazada' || r.estado === 'cancelada') && <p className="break-words text-xs text-muted">Motivo: {r.motivo}</p>}
                  </div>
                  {puedeCancelarVecino(r) && (
                    <Bloqueable>{b => <Button variant="secondary" size="sm" disabled={b} onClick={() => setCancelar(r)}>Cancelar reserva</Button>}</Bloqueable>
                  )}
                </li>
              ))}
            </ul>
          )}
      </Card>
      <Pager page={lista.page} pageSize={lista.pageSize} total={lista.total} onPage={lista.setPage} />
      <ConfirmDialog
        open={!!cancelar}
        onClose={() => setCancelar(null)}
        onConfirm={confirmar}
        loading={busy}
        danger
        title="Cancelar reserva"
        message={cancelar ? `${cancelar.area.nombre} · ${cuandoDe(cancelar)}. El horario quedará libre para otros vecinos.` : ''}
        confirmLabel="Cancelar reserva"
      />
    </>
  );
}
