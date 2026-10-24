import { Button, StatusBadge, fechaCorta, periodo, soles } from '../../../ui';
import { motivoRechazo } from './tipos';
import type { Cargo } from './tipos';

/** Contenido de un recibo en vista móvil. El contenedor (Card o fila) lo pone quien lo usa. */
export function CargoItem({ cargo, onPagar }: { cargo: Cargo; onPagar: (c: Cargo) => void }) {
  const vencido = cargo.estado === 'vencido';
  const rechazo = motivoRechazo(cargo);
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{cargo.concepto.nombre}</p>
          <p className="mt-0.5 text-sm text-muted">{periodo(cargo.recibo.mes, cargo.recibo.anio)} · {cargo.unidad.codigo}</p>
        </div>
        <StatusBadge estado={cargo.estado} />
      </div>
      {rechazo && <p className="mt-2 text-sm text-bad">Pago rechazado: {rechazo}</p>}
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="num text-xl font-semibold">{soles(cargo.monto)}</p>
          <p className={`text-xs ${vencido ? 'text-bad' : 'text-muted'}`}>Vence {fechaCorta(cargo.recibo.fecha_vencimiento)}</p>
        </div>
        {cargo.estado !== 'pagado' && cargo.estado !== 'en_revision' && <Button onClick={() => onPagar(cargo)}>{rechazo ? 'Pagar de nuevo' : 'Pagar'}</Button>}
      </div>
    </div>
  );
}
