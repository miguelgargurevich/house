import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Button, DefinitionList, Modal, StatusBadge, Textarea, fechaCorta, soles, useToast } from '../../../../ui';
import { ComprobanteVista } from '../../../shared/ComprobanteVista';
import type { ComprobanteMeta } from '../../../shared/comprobantes';
import { tamanoLegible } from '../../../shared/comprobantes';
import { EvaluacionPanel, useEvaluacionCompleta } from '../../../shared/evaluacion';
import type { EvaluacionCompleta } from '../../../shared/evaluacion';
import { metodoLabel } from './comun';

export interface PagoRevisable {
  id: number;
  fecha_pago: string;
  monto: number | string;
  metodo_pago: string | null;
  referencia: string | null;
  observaciones?: string | null;
  estado_validacion: 'por_validar' | 'validado' | 'rechazado';
  motivo_rechazo: string | null;
  validado_at: string | null;
  validado_por?: { nombre: string } | null;
  comprobante: ComprobanteMeta | null;
  /** Departamento, con su torre y su condominio: cada torre tiene su recibo y sus cuentas. */
  unidad?: { codigo: string; estructura?: { id: number; nombre: string | null } | null; complejo?: { id: number; nombre: string } | null } | null;
  concepto?: { nombre: string } | null;
  usuario?: { nombre: string } | null;
  /** Pago del mantenimiento completo: el total del grupo y cuántos conceptos cubre; `null` en un pago suelto antiguo. */
  mantenimiento?: { titulo: string; total: string; conceptos: number } | null;
  /** Sólo la traen los pagos que ve quien valida (admin y junta). */
  evaluacion?: EvaluacionCompleta | null;
  validado_por_ia?: boolean;
}

interface Props { pago: PagoRevisable | null; onClose: () => void; onRevisado: () => void }

/** Vista del comprobante de un pago y, si está por validar, los botones para validarlo o rechazarlo con motivo. */
export function ValidarPagoModal({ pago, onClose, onRevisado }: Props) {
  const toast = useToast();
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState<'validado' | 'rechazado' | null>(null);

  const ia = useEvaluacionCompleta(pago?.id ?? null, pago?.evaluacion ?? null);

  useEffect(() => { setRechazando(false); setMotivo(''); setErrorMotivo(undefined); }, [pago?.id]);

  async function revisar(estado: 'validado' | 'rechazado') {
    if (!pago) return;
    const texto = motivo.trim();
    if (estado === 'rechazado' && (texto.length < 3 || texto.length > 300)) {
      return void setErrorMotivo(texto.length < 3 ? 'Escribe un motivo de al menos 3 caracteres.' : 'El motivo admite hasta 300 caracteres.');
    }
    setEnviando(estado);
    try {
      await api(`/api/pagos/${pago.id}/validacion`, { method: 'PATCH', json: estado === 'validado' ? { estado } : { estado, motivo: texto } });
      toast.ok(estado === 'validado' ? 'Pago validado. El mantenimiento quedó pagado.' : 'Pago rechazado. El mantenimiento volvió a pendiente.');
      onClose();
      onRevisado();
    } catch (e) { toast.error(errorText(e)); }
    finally { setEnviando(null); }
  }

  const porValidar = pago?.estado_validacion === 'por_validar';
  // Un pago del mantenimiento se revisa por su TOTAL: el comprobante es uno solo y cubre todos los conceptos.
  const monto = pago ? pago.mantenimiento?.total ?? pago.monto : 0;

  return (
    <Modal
      open={pago !== null}
      onClose={onClose}
      title={porValidar ? 'Revisar pago' : 'Detalle del pago'}
      description={pago ? pago.mantenimiento ? pago.mantenimiento.titulo : `${pago.unidad?.codigo ?? 'Unidad'} · ${pago.concepto?.nombre ?? 'Pago'}` : undefined}
      size="lg"
      footer={
        porValidar ? (
          rechazando ? (
            <>
              <Button variant="secondary" onClick={() => { setRechazando(false); setErrorMotivo(undefined); }}>Volver</Button>
              <Button variant="danger" loading={enviando === 'rechazado'} disabled={enviando !== null} onClick={() => void revisar('rechazado')}>Confirmar rechazo</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>Cerrar</Button>
              <Button variant="danger" disabled={enviando !== null} onClick={() => setRechazando(true)}>Rechazar</Button>
              <Button loading={enviando === 'validado'} disabled={enviando !== null} onClick={() => void revisar('validado')}>Validar pago</Button>
            </>
          )
        ) : <Button variant="secondary" onClick={onClose}>Cerrar</Button>
      }
    >
      {pago && (
        <div className="space-y-5">
          <div className="rounded bg-surface2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="num text-2xl font-semibold">{soles(monto)}</p>{pago.mantenimiento && <p className="text-xs text-muted">Mantenimiento completo · {pago.mantenimiento.conceptos} conceptos</p>}</div>
              <StatusBadge estado={pago.estado_validacion} />
            </div>
            <div className="mt-4">
              <DefinitionList
                items={[
                  { label: 'Departamento', value: pago.unidad && <><span className="num">{pago.unidad.codigo}</span>{pago.unidad.estructura?.nombre ? ` · ${pago.unidad.estructura.nombre}` : ''}</> },
                  ...(pago.unidad?.complejo ? [{ label: 'Condominio', value: pago.unidad.complejo.nombre }] : []),
                  { label: 'Pagó', value: pago.usuario?.nombre },
                  { label: 'Fecha', value: fechaCorta(pago.fecha_pago) },
                  { label: 'Método', value: metodoLabel(pago.metodo_pago) },
                  { label: 'Referencia', value: pago.referencia && <span className="num">{pago.referencia}</span> },
                  ...(pago.observaciones ? [{ label: 'Observaciones', value: pago.observaciones }] : []),
                  ...(pago.validado_at ? [{ label: pago.estado_validacion === 'rechazado' ? 'Rechazado el' : 'Validado el', value: `${fechaCorta(pago.validado_at)}${pago.validado_por ? ` · ${pago.validado_por.nombre}` : ''}` }] : []),
                ]}
              />
            </div>
          </div>

          {pago.estado_validacion === 'rechazado' && <Alert tone="bad">Motivo del rechazo: {pago.motivo_rechazo ?? 'sin motivo indicado'}</Alert>}

          <section aria-label="Comprobante">
            <h3 className="mb-2 text-sm font-medium">
              Comprobante{pago.comprobante && <span className="ml-2 font-normal text-muted">{pago.comprobante.nombre} · {tamanoLegible(pago.comprobante.tamano)}</span>}
            </h3>
            {pago.comprobante ? (
              <ComprobanteVista key={pago.comprobante.created_at} pagoId={pago.id} descripcion={`Comprobante de pago de ${pago.unidad?.codigo ?? 'la unidad'}, ${soles(monto)}`} nombre={pago.comprobante.nombre} />
            ) : (
              <Alert tone="warn">{pago.usuario ? `${pago.usuario.nombre} no adjuntó comprobante.` : 'Este pago no tiene comprobante adjunto.'}</Alert>
            )}
          </section>

          {pago.comprobante && (
            <EvaluacionPanel
              evaluacion={ia.ev}
              montoEsperado={monto}
              validadoPorIA={ia.validadoPorIA || pago.validado_por_ia === true}
              puedeReevaluar={porValidar}
              reevaluando={ia.esperando}
              onReevaluar={() => void ia.reevaluar()}
              errorReevaluar={ia.error}
            />
          )}

          {rechazando && (
            <Textarea
              label="Motivo del rechazo"
              hint="El residente lo verá junto a su recibo (de 3 a 300 caracteres)."
              error={errorMotivo}
              value={motivo}
              maxLength={300}
              onChange={e => { setMotivo(e.target.value); setErrorMotivo(undefined); }}
              autoFocus
            />
          )}
        </div>
      )}
    </Modal>
  );
}
