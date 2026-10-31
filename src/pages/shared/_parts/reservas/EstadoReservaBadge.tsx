import { Badge } from '../../../../ui';
import { ESTADO_LABEL, ESTADO_TONO } from './tipos';
import type { EstadoReserva } from './tipos';

/** El estado de una reserva: la palabra y el color viajan juntos. */
export function EstadoReservaBadge({ estado }: { estado: EstadoReserva }) {
  return <Badge tone={ESTADO_TONO[estado]}>{ESTADO_LABEL[estado]}</Badge>;
}
