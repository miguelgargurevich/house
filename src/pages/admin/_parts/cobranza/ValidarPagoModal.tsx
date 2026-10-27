import { useEffect, useRef, useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { useAuth } from '../../../../auth/AuthContext';
import { Alert, Button, DefinitionList, Modal, StatusBadge, Textarea, fechaCorta, soles, useToast } from '../../../../ui';
import { ComprobanteVista } from '../../../shared/ComprobanteVista';
import type { ComprobanteMeta } from '../../../shared/comprobantes';
import { ACCEPT_COMPROBANTE, errorDeArchivo, subirComprobante, tamanoLegible } from '../../../shared/comprobantes';
import { EvaluacionPanel, useEvaluacionCompleta } from '../../../shared/evaluacion';
import type { EvaluacionCompleta } from '../../../shared/evaluacion';
import { fechaPorRevisar, textoFechaPago } from '../../../shared/mantenimiento/fechaPago';
import type { FechaOrigen } from '../../../shared/mantenimiento/tipos';
import { metodoLabel } from './comun';

export interface PagoRevisable {
  id: number;
  fecha_pago: string;
  /** De dónde salió `fecha_pago`: la del voucher (leída por la IA), la declarada, o una que no se pudo leer/aplicar. */
  fecha_origen?: FechaOrigen;
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
  const { user } = useAuth();
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState<'validado' | 'rechazado' | null>(null);
  // Quien administra adjunta el voucher que falta; la junta y el residente no (sólo suben el suyo, en su pantalla).
  const puedeAdjuntar = user?.rol === 'admin' || user?.rol === 'superadmin';
  const archivoRef = useRef<HTMLInputElement>(null);
  const [subido, setSubido] = useState<ComprobanteMeta | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorAdjunto, setErrorAdjunto] = useState<string | null>(null);

  const ia = useEvaluacionCompleta(pago?.id ?? null, pago?.evaluacion ?? null);

  useEffect(() => { setRechazando(false); setMotivo(''); setErrorMotivo(undefined); setSubido(null); setErrorAdjunto(null); }, [pago?.id]);

  /** Sube el voucher y sigue la evaluación de la IA; el pago no cambia de estado aquí (sólo la IA o quien valida). */
  async function adjuntar(archivo: File) {
    if (!pago) return;
    const error = errorDeArchivo(archivo);
    if (error) return void setErrorAdjunto(error);
    setSubiendo(true); setErrorAdjunto(null);
    try {
      setSubido(await subirComprobante(pago.id, archivo));
      ia.seguir();
      onRevisado(); // refresca la lista: la fila ya no dice «Sin comprobante»
    } catch (e) { setErrorAdjunto(errorText(e)); }
    finally {
      setSubiendo(false);
      if (archivoRef.current) archivoRef.current.value = '';
    }
  }

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

  // Si la IA validó sola el pago que se acaba de adjuntar, ya no está por validar: se dice y se ocultan los botones.
  const estadoPago = pago && pago.estado_validacion === 'por_validar' && ia.validadoPorIA ? 'validado' : pago?.estado_validacion;
  const porValidar = estadoPago === 'por_validar';
  const comprobante = pago?.comprobante ?? subido;
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
              <StatusBadge estado={estadoPago ?? pago.estado_validacion} />
            </div>
            <div className="mt-4">
              <DefinitionList
                items={[
                  { label: 'Departamento', value: pago.unidad && <><span className="num">{pago.unidad.codigo}</span>{pago.unidad.estructura?.nombre ? ` · ${pago.unidad.estructura.nombre}` : ''}</> },
                  ...(pago.unidad?.complejo ? [{ label: 'Condominio', value: pago.unidad.complejo.nombre }] : []),
                  { label: 'Pagó', value: pago.usuario?.nombre },
                  { label: pago.fecha_origen === 'voucher' ? 'Fecha del voucher' : 'Fecha del pago', value: <>{fechaCorta(pago.fecha_pago)}<span className="ml-2 text-xs text-muted">{textoFechaPago(pago.fecha_origen)}</span></> },
                  { label: 'Método', value: metodoLabel(pago.metodo_pago) },
                  { label: 'Referencia', value: pago.referencia && <span className="num">{pago.referencia}</span> },
                  ...(pago.observaciones ? [{ label: 'Observaciones', value: pago.observaciones }] : []),
                  ...(pago.validado_at ? [{ label: pago.estado_validacion === 'rechazado' ? 'Rechazado el' : 'Validado el', value: `${fechaCorta(pago.validado_at)}${pago.validado_por ? ` · ${pago.validado_por.nombre}` : ''}` }] : []),
                ]}
              />
            </div>
          </div>

          {fechaPorRevisar(pago.fecha_origen) && (
            <Alert tone="warn">
              {pago.fecha_origen === 'invalida'
                ? 'La IA leyó en el voucher una fecha futura o demasiado antigua: no se aplicó y el pago queda para tu revisión. Mientras tanto se usa la fecha declarada.'
                : 'La IA no pudo leer la fecha del voucher: se usa la fecha declarada por quien registró el pago. Revísala contra el comprobante.'}
            </Alert>
          )}

          {pago.estado_validacion === 'rechazado' && <Alert tone="bad">Motivo del rechazo: {pago.motivo_rechazo ?? 'sin motivo indicado'}</Alert>}

          <section aria-label="Comprobante">
            <h3 className="mb-2 text-sm font-medium">
              Comprobante{comprobante && <span className="ml-2 font-normal text-muted">{comprobante.nombre} · {tamanoLegible(comprobante.tamano)}</span>}
            </h3>
            {comprobante ? (
              <ComprobanteVista key={comprobante.created_at} pagoId={pago.id} descripcion={`Comprobante de pago de ${pago.unidad?.codigo ?? 'la unidad'}, ${soles(monto)}`} nombre={comprobante.nombre} />
            ) : (
              <>
                <Alert tone="warn">{pago.usuario ? `${pago.usuario.nombre} no adjuntó comprobante.` : 'Este pago no tiene comprobante adjunto.'}</Alert>
                {puedeAdjuntar && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button variant="secondary" icon={<ArrowUpTrayIcon className="h-4 w-4" />} loading={subiendo} disabled={subiendo} onClick={() => archivoRef.current?.click()}>Adjuntar comprobante</Button>
                    <span className="text-xs text-muted">JPG, PNG, WebP o PDF, hasta 2 MB.</span>
                    <input ref={archivoRef} type="file" accept={ACCEPT_COMPROBANTE} onChange={e => { const f = e.target.files?.[0]; if (f) void adjuntar(f); }} className="sr-only" tabIndex={-1} aria-label="Elegir archivo del comprobante" />
                  </div>
                )}
                {errorAdjunto && <div className="mt-3"><Alert tone="bad">{errorAdjunto}</Alert></div>}
              </>
            )}
            {subido && (
              <div className="mt-3">
                <Alert tone="info">
                  {pago.estado_validacion === 'validado'
                    ? 'El pago ya estaba validado: el voucher queda como respaldo y la IA solo informa lo que leyó.'
                    : estadoPago === 'validado'
                      ? 'La IA revisó el voucher y validó el pago automáticamente.'
                      : 'La IA revisa el voucher. Si coincide con lo esperado, el pago se valida solo; si no, queda en revisión para que lo revises tú.'}
                </Alert>
              </div>
            )}
          </section>

          {comprobante && (
            <EvaluacionPanel
              evaluacion={ia.ev}
              montoEsperado={monto}
              validadoPorIA={ia.validadoPorIA || pago.validado_por_ia === true}
              puedeReevaluar={porValidar}
              reevaluando={ia.esperando}
              onReevaluar={() => void ia.reevaluar()}
              errorReevaluar={ia.error}
              fase={ia.fase}
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
