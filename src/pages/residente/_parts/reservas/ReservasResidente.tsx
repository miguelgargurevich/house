import { useState } from 'react';
import { useList } from '../../../../api';
import { PageHeader } from '../../../../ui';
import type { Reserva } from '../../../shared/_parts/reservas/tipos';
import { MisReservas } from './MisReservas';
import type { VistaMias } from './MisReservas';
import { NuevaReserva } from './NuevaReserva';

/** Reservar áreas comunes (salón, parrilla, piscina…) y ver «Mis reservas», para propietarios e inquilinos. */
export function ReservasResidente() {
  const [vista, setVista] = useState<VistaMias>('proximas');
  const lista = useList<Reserva>('/api/reservas', {
    pageSize: 10,
    params: { proximas: vista === 'proximas' ? 'true' : undefined, orden: vista === 'proximas' ? 'inicio:asc' : 'inicio:desc' },
  });
  return (
    <>
      <PageHeader title="Reservas" description="Reserva el salón, la parrilla u otra área común de tu condominio, mira cuándo está libre y cancela si ya no la necesitas." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <NuevaReserva onCreada={() => void lista.reload()} />
        <div className="min-w-0"><MisReservas vista={vista} onVista={setVista} lista={lista} /></div>
      </div>
    </>
  );
}
