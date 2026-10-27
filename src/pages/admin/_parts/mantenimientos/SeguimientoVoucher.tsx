import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../api';
import { Alert, Button, Spinner } from '../../../../ui';
import { ComprobanteVista } from '../../../shared/ComprobanteVista';
import { EvaluacionPanel } from '../../../shared/evaluacion';
import type { EvaluacionCompleta } from '../../../shared/evaluacion';
import type { DetalleMantenimiento } from '../../../shared/mantenimiento/tipos';
import { INTERVALO_SEGUIMIENTO_MS, MAX_CONSULTAS_SEGUIMIENTO, faseVoucher, motivoEnRevision, sigueRevisando } from './faseVoucher';
import type { PagoSeguimiento } from './faseVoucher';

interface Props {
  reciboId: number;
  unidadId: number;
  /** Pago principal del grupo: el que lleva el voucher y la evaluación. */
  pagoId: number;
  /** El detalle que devolvió el registro (ya trae la evaluación «pendiente»). */
  inicial: DetalleMantenimiento;
  onListo: () => void;
}

/** Tras registrar el pago con voucher: «la IA lo está revisando» y luego el resultado (pagado, o en revisión con el motivo y el análisis). */
export function SeguimientoVoucher({ reciboId, unidadId, pagoId, inicial, onListo }: Props) {
  const [detalle, setDetalle] = useState<DetalleMantenimiento>(inicial);
  const [lecturas, setLecturas] = useState(0);
  const [agotado, setAgotado] = useState(false);
  const consultas = useRef(0);

  const pago = (detalle.pagos.find(p => p.id === pagoId) ?? null) as (PagoSeguimiento & { evaluacion: EvaluacionCompleta | null; monto: string }) | null;
  const fase = faseVoucher(pago, lecturas, agotado);
  const revisando = sigueRevisando(fase);

  useEffect(() => {
    if (!revisando) return;
    let vivo = true;
    const t = setInterval(() => {
      consultas.current += 1;
      api<DetalleMantenimiento>(`/api/recibos/${reciboId}/mantenimientos/${unidadId}`)
        .then(d => {
          if (!vivo) return;
          const p = d.pagos.find(x => x.id === pagoId);
          const ev = p?.evaluacion as { estado: string } | null | undefined;
          setLecturas(n => (p?.estado_validacion === 'por_validar' && ev && ev.estado !== 'pendiente' ? n + 1 : 0));
          setDetalle(d);
        })
        .catch(() => undefined);
      if (consultas.current >= MAX_CONSULTAS_SEGUIMIENTO) { clearInterval(t); if (vivo) setAgotado(true); }
    }, INTERVALO_SEGUIMIENTO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [revisando, reciboId, unidadId, pagoId]);

  return (
    <div className="space-y-4 sm:col-span-2">
      {fase === 'revisando' && <Alert tone="info"><span className="flex items-center gap-2" role="status"><Spinner />Pago registrado: la IA lo está revisando…</span></Alert>}
      {fase === 'pagado' && <Alert tone="ok">{pago?.validado_por_ia ? 'Pago registrado y validado automáticamente por la IA: el mantenimiento quedó pagado.' : 'Pago registrado: el mantenimiento quedó pagado.'}</Alert>}
      {fase === 'en_revision' && <Alert tone="warn">Pago registrado: queda en revisión. {motivoEnRevision(pago, agotado)} Ábrelo en el historial de pagos para validarlo o rechazarlo.</Alert>}
      {fase === 'rechazado' && <Alert tone="bad">El pago fue rechazado{pago?.motivo_rechazo ? `: ${pago.motivo_rechazo}` : ''}.</Alert>}
      {pago && (
        <EvaluacionPanel evaluacion={pago.evaluacion} montoEsperado={detalle.total} validadoPorIA={pago.validado_por_ia} puedeReevaluar={false} reevaluando={false} onReevaluar={() => undefined} />
      )}
      <ComprobanteVista pagoId={pagoId} descripcion="Voucher adjunto al pago" />
      <Button onClick={onListo}>Listo</Button>
    </div>
  );
}
