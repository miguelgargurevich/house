import { Modal, Skeleton, fechaCorta, soles } from '../../../../ui';
import { useResource } from '../../../../api';
import { MEDIOS, type PagoSuscripcion, type VistaSuscripcion } from '../../../shared/_parts/comercial';

const MEDIO = Object.fromEntries(MEDIOS) as Record<string, string>;

export function ModalHistorial({ sus, onClose }: { sus: VistaSuscripcion | null; onClose: () => void }) {
  const { data, loading, error } = useResource<{ items: PagoSuscripcion[] }>(sus ? `/api/comercial/suscripciones/${sus.complejo_id}/pagos` : null);
  return (
    <Modal open={!!sus} onClose={onClose} title={sus ? `Pagos · ${sus.complejo}` : ''} size="lg">
      {loading && <Skeleton className="h-20 w-full" />}
      {error && <p className="text-sm text-bad">{error}</p>}
      {data && !data.items.length && <p className="text-sm text-muted">Sin pagos registrados.</p>}
      {data && data.items.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Historial de pagos</caption>
            <thead><tr className="text-left text-xs text-muted"><th scope="col" className="py-2 pr-3 font-medium">Pago</th><th scope="col" className="py-2 pr-3 font-medium">Periodo</th><th scope="col" className="py-2 pr-3 font-medium">Medio · operación</th><th scope="col" className="py-2 text-right font-medium">Monto</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.items.map(p => (
                <tr key={p.id}>
                  <td className="num py-2 pr-3">{fechaCorta(p.fecha_pago)}</td>
                  <td className="num py-2 pr-3">{fechaCorta(p.periodo_desde)} – {fechaCorta(p.periodo_hasta)}</td>
                  <td className="py-2 pr-3">{MEDIO[p.medio] ?? p.medio}{p.operacion ? <span className="num text-xs text-muted"> · {p.operacion}</span> : null}{p.notas ? <span className="block text-xs text-muted">{p.notas}</span> : null}</td>
                  <td className="num py-2 text-right"><span className="font-medium">{soles(p.monto)}</span><span className="block text-xs text-muted">{soles(p.base)} + IGV {soles(p.igv)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
