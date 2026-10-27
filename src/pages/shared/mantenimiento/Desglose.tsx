import { Badge, StatusBadge, fechaCorta, soles } from '../../../ui';
import { metodoLabel } from '../../admin/_parts/cobranza/comun';
import { textoFechaPago } from './fechaPago';
import type { ConceptoMantenimiento, PagoMantenimiento } from './tipos';

/** Los conceptos del mantenimiento: sólo el desglose (no se pagan por separado). */
export function ConceptosTabla({ conceptos, total }: { conceptos: ConceptoMantenimiento[]; total: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Detalle del mantenimiento por concepto</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Concepto</th>
            <th scope="col" className="py-2 text-right font-medium">Monto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {conceptos.map(c => (
            <tr key={c.cargo_id}>
              <td className="py-2 pr-3">
                {c.concepto}{c.es_recargo && <span className="ml-1.5 text-xs text-muted">recargo</span>}
                {c.motivo && <span className="block text-xs text-muted">{c.motivo}</span>}
              </td>
              <td className="num py-2 text-right">{soles(c.monto)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold"><th scope="row" className="py-2 pr-3 text-left">Total</th><td className="num py-2 text-right">{soles(total)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Pagos del mantenimiento: uno por operación (los pagos antiguos de un solo concepto se marcan con el concepto). */
export function HistorialPagos({ pagos, onVer }: { pagos: PagoMantenimiento[]; onVer?: (p: PagoMantenimiento) => void }) {
  if (pagos.length === 0) return <p className="text-sm text-muted">Aún no hay pagos de este mantenimiento.</p>;
  return (
    <ul className="divide-y divide-line rounded border border-line" aria-label="Historial de pagos del mantenimiento">
      {pagos.map(p => {
        const cuerpo = (
          <>
            <span className="min-w-0">
              <span className="block text-sm font-medium" title={textoFechaPago(p.fecha_origen)}>{fechaCorta(p.fecha_pago)} · {metodoLabel(p.metodo_pago)}{p.referencia ? <span className="num text-muted"> · {p.referencia}</span> : null}</span>
              <span className="block truncate text-xs text-muted">
                {p.suelto ? `Pago del concepto ${p.conceptos.join(', ')}` : `Pago del mantenimiento completo`}
                {p.estado_validacion === 'rechazado' && p.motivo_rechazo ? ` · Motivo: ${p.motivo_rechazo}` : ''}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="num text-sm font-semibold">{soles(p.monto)}</span>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                <StatusBadge estado={p.estado_validacion === 'por_validar' ? 'en_revision' : p.estado_validacion} />
                {p.validado_por_ia && <Badge tone="brand">Validado por IA</Badge>}
              </span>
            </span>
          </>
        );
        return (
          <li key={p.id}>
            {onVer ? (
              <button type="button" onClick={() => onVer(p)} className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface2/70">{cuerpo}</button>
            ) : (
              <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">{cuerpo}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
