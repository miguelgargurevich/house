import { Skeleton, dinero, fechaCorta } from '../../../../ui';
import { useResource } from '../../../../api';
import { MEDIOS, type PagoSuscripcion } from '../../../shared/_parts/comercial';

const MEDIO = Object.fromEntries(MEDIOS) as Record<string, string>;

/** Pagos registrados de un condominio, con el desglose (base + impuesto, como se registró) y el periodo que cubren. */
export function HistorialPagos({ complejoId }: { complejoId: number }) {
  const { data, loading, error } = useResource<{ items: PagoSuscripcion[] }>(`/api/comercial/mi-plan/${complejoId}/pagos`);
  if (loading) return <Skeleton className="h-16 w-full" />;
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data?.items.length) return <p className="text-sm text-muted">Aún no hay pagos registrados.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="sr-only">Pagos registrados</caption>
        <thead><tr className="text-left text-xs text-muted"><th scope="col" className="py-2 pr-3 font-medium">Fecha</th><th scope="col" className="py-2 pr-3 font-medium">Periodo cubierto</th><th scope="col" className="py-2 pr-3 font-medium">Medio</th><th scope="col" className="py-2 text-right font-medium">Monto</th></tr></thead>
        <tbody className="divide-y divide-line">
          {data.items.map(p => (
            <tr key={p.id}>
              <td className="num py-2 pr-3">{fechaCorta(p.fecha_pago)}</td>
              <td className="num py-2 pr-3">{fechaCorta(p.periodo_desde)} – {fechaCorta(p.periodo_hasta)}</td>
              <td className="py-2 pr-3">{MEDIO[p.medio] ?? p.medio}{p.operacion ? <span className="num text-xs text-muted"> · {p.operacion}</span> : null}</td>
              <td className="num py-2 text-right"><span className="font-medium">{dinero(p.monto, p.moneda)}</span><span className="block text-xs text-muted">{dinero(p.base, p.moneda)} + {p.impuesto_nombre} {dinero(p.igv, p.moneda)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
