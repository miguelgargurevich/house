import { Button, StatusBadge, dinero, fechaCorta } from '../../../ui';
import { sePuedePagar } from '../../shared/mantenimiento/tipos';
import type { Mantenimiento } from '../../shared/mantenimiento/tipos';

/** Mantenimiento del mes de un departamento en vista móvil. El contenedor (Card o fila) lo pone quien lo usa. */
export function MantenimientoItem({ mant, rechazo, onPagar, onVer }: { mant: Mantenimiento; rechazo?: string | null; onPagar: (m: Mantenimiento) => void; onVer: (m: Mantenimiento) => void }) {
  const vencido = mant.estado === 'vencido';
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => onVer(mant)} className="min-w-0 text-left">
          <span className="block truncate font-medium hover:text-brand">{mant.titulo.split(' · ')[0]}</span>
          <span className="mt-0.5 block text-sm text-muted">Departamento {mant.unidad.codigo}{mant.unidad.estructura?.nombre ? ` · ${mant.unidad.estructura.nombre}` : ''}</span>
        </button>
        <StatusBadge estado={mant.estado} />
      </div>
      {rechazo && <p className="mt-2 text-sm text-bad">Pago rechazado: {rechazo}</p>}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="num text-xl font-semibold">{dinero(mant.total, mant.moneda)}</p>
          {mant.estado === 'parcial' && <p className="text-xs text-muted">Saldo {dinero(mant.saldo, mant.moneda)}</p>}
          <p className={`text-xs ${vencido ? 'text-bad' : 'text-muted'}`}>Vence {fechaCorta(mant.fecha_vencimiento)}</p>
        </div>
        {/* En el celular los botones pasan a su propia fila a todo el ancho (antes «Pagar mantenimiento» quedaba cortado). */}
        <div className="flex w-full gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          <Button variant="secondary" onClick={() => onVer(mant)}>Ver detalle</Button>
          {sePuedePagar(mant) && <Button onClick={() => onPagar(mant)}>{rechazo ? 'Pagar de nuevo' : 'Pagar mantenimiento'}</Button>}
        </div>
      </div>
    </div>
  );
}
