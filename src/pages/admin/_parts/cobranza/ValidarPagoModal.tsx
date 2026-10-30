import { useEffect, useRef, useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { useAuth } from '../../../../auth/AuthContext';
import { Alert, Button, DefinitionList, Modal, StatusBadge, Textarea, dinero, fechaCorta, useToast } from '../../../../ui';
import { ComprobanteVista } from '../../../shared/ComprobanteVista';
import type { ComprobanteMeta } from '../../../shared/comprobantes';
import { ACCEPT_COMPROBANTE, errorDeArchivo, subirComprobante, tamanoLegible } from '../../../shared/comprobantes';
import { EvaluacionPanel, useEvaluacionCompleta } from '../../../shared/evaluacion';
import type { EvaluacionCompleta } from '../../../shared/evaluacion';
import { fechaPorRevisar, textoFechaPago } from '../../../shared/mantenimiento/fechaPago';
import type { FechaOrigen } from '../../../shared/mantenimiento/tipos';
import { esTesorero, puedeValidar, textoConformidad, TEXTO_VALIDAR_SIN_CONFORMIDAD, vistaConformidad } from './conformidad';
import type { ConformidadPago } from './conformidad';
import { metodoLabel } from './comun';
import type { AvisoMulta } from './morosos';
import { QuitarMultaModal } from './QuitarMultaModal';

export interface PagoRevisable {
  id: number;
  fecha_pago: string;
  /** De dónde salió `fecha_pago`: la del voucher (leída por la IA), la declarada, o una que no se pudo leer/aplicar. */
  fecha_origen?: FechaOrigen;
  monto: number | string;
  /** Moneda del condominio del pago (la trae el servidor en cada pago). */
  moneda?: string;
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
  /** Conformidad del tesorero: la traen los pagos que ve quien valida; `null` = aún no la da. */
  conformidad?: ConformidadPago | null;
  /** ¿El block tiene un tesorero que pueda darla? */
  tesorero_registrado?: boolean;
  /** «Según el voucher pagó a tiempo; tiene la multa de …»: la multa del recibo siguiente que la administración puede quitar; `null` si no hay. */
  aviso_multa?: AvisoMulta | null;
}

interface Props { pago: PagoRevisable | null; onClose: () => void; onRevisado: () => void }

/**
 * Vista del comprobante de un pago y, si está por validar: la administración lo valida o lo rechaza con motivo (y ve si el tesorero ya confirmó que el dinero
 * llegó a la cuenta; si no, se le avisa, sin bloquearla); la junta sólo lo revisa, y su tesorero da o quita la conformidad.
 */
export function ValidarPagoModal({ pago, onClose, onRevisado }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState<'validado' | 'rechazado' | null>(null);
  // Conformidad: lo que respondió el servidor al darla o quitarla desde este diálogo (la fila de la lista es la de antes de abrirlo).
  const [conformidadLocal, setConformidadLocal] = useState<{ valor: ConformidadPago | null } | null>(null);
  const [cambiandoConformidad, setCambiandoConformidad] = useState(false);
  const [confirmandoSinConformidad, setConfirmandoSinConformidad] = useState(false);
  // «Quitar la multa» desde el aviso: abre el motivo; al quitarla el aviso desaparece sin esperar a que la lista se recargue.
  const [quitandoMulta, setQuitandoMulta] = useState(false);
  const [multaQuitada, setMultaQuitada] = useState(false);
  const validador = puedeValidar(user);
  const tesorero = esTesorero(user);
  // Quien administra adjunta el voucher que falta; la junta y el residente no (sólo suben el suyo, en su pantalla).
  const puedeAdjuntar = user?.rol === 'admin' || user?.rol === 'superadmin';
  const archivoRef = useRef<HTMLInputElement>(null);
  const [subido, setSubido] = useState<ComprobanteMeta | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorAdjunto, setErrorAdjunto] = useState<string | null>(null);

  const ia = useEvaluacionCompleta(pago?.id ?? null, pago?.evaluacion ?? null);

  useEffect(() => { setRechazando(false); setMotivo(''); setErrorMotivo(undefined); setSubido(null); setErrorAdjunto(null); setConformidadLocal(null); setConfirmandoSinConformidad(false); setQuitandoMulta(false); setMultaQuitada(false); }, [pago?.id]);

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

  /** El tesorero da o quita su conformidad; el diálogo sigue abierto y la lista se refresca. */
  async function cambiarConformidad(dar: boolean) {
    if (!pago) return;
    setCambiandoConformidad(true);
    try {
      const r = await api<{ conformidad: ConformidadPago | null }>(`/api/pagos/${pago.id}/conformidad`, { method: dar ? 'PUT' : 'DELETE' });
      setConformidadLocal({ valor: r.conformidad });
      toast.ok(dar ? 'Conformidad registrada: la administración verá que el dinero llegó a la cuenta.' : 'Conformidad quitada.');
      onRevisado();
    } catch (e) { toast.error(errorText(e)); }
    finally { setCambiandoConformidad(false); }
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
  // Sin voucher no se valida (el servidor responde 409): se puede rechazar, o quien administra adjunta el archivo que falta.
  const sinVoucher = pago !== null && !comprobante;
  const motivoSinVoucher = puedeAdjuntar ? 'Sin voucher no se puede validar: adjunta el comprobante o rechaza el pago.' : 'Sin voucher no se puede validar: pídele al vecino que lo suba o rechaza el pago.';
  // Un pago del mantenimiento se revisa por su TOTAL: el comprobante es uno solo y cubre todos los conceptos.
  const monto = pago ? pago.mantenimiento?.total ?? pago.monto : 0;
  const conformidad = conformidadLocal ? conformidadLocal.valor : pago?.conformidad;
  const vistaConf = pago ? vistaConformidad({ estado_validacion: estadoPago ?? pago.estado_validacion, conformidad, tesorero_registrado: pago.tesorero_registrado }) : null;
  const faltaConformidad = vistaConf !== null && vistaConf.tipo !== 'dada';

  return (
    <>
    <Modal
      open={pago !== null}
      onClose={onClose}
      title={porValidar ? 'Revisar pago' : 'Detalle del pago'}
      description={pago ? pago.mantenimiento ? pago.mantenimiento.titulo : `${pago.unidad?.codigo ?? 'Unidad'} · ${pago.concepto?.nombre ?? 'Pago'}` : undefined}
      size="lg"
      footer={
        porValidar ? (
          !validador ? (
            <>
              <Button variant="secondary" onClick={onClose}>Cerrar</Button>
              <p className="mr-auto max-w-xs text-xs text-muted">{tesorero ? 'La administración valida el pago: tú confirmas que el dinero llegó a la cuenta.' : 'La administración valida el pago.'}</p>
              {tesorero && (conformidad
                ? <Button variant="secondary" loading={cambiandoConformidad} disabled={cambiandoConformidad} onClick={() => void cambiarConformidad(false)}>Quitar mi conformidad</Button>
                : <Button loading={cambiandoConformidad} disabled={cambiandoConformidad} onClick={() => void cambiarConformidad(true)}>Confirmo que llegó a la cuenta</Button>)}
            </>
          ) : rechazando ? (
            <>
              <Button variant="secondary" onClick={() => { setRechazando(false); setErrorMotivo(undefined); }}>Volver</Button>
              <Button variant="danger" loading={enviando === 'rechazado'} disabled={enviando !== null} onClick={() => void revisar('rechazado')}>Confirmar rechazo</Button>
            </>
          ) : confirmandoSinConformidad ? (
            <>
              <Button variant="secondary" onClick={() => setConfirmandoSinConformidad(false)}>Volver</Button>
              <Button loading={enviando === 'validado'} disabled={enviando !== null} onClick={() => void revisar('validado')}>Validar de todos modos</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>Cerrar</Button>
              {sinVoucher && <p id="motivo-sin-voucher" className="mr-auto max-w-xs text-xs text-muted">{motivoSinVoucher}</p>}
              <Button variant="danger" disabled={enviando !== null} onClick={() => setRechazando(true)}>Rechazar</Button>
              <Button loading={enviando === 'validado'} disabled={enviando !== null || sinVoucher} aria-describedby={sinVoucher ? 'motivo-sin-voucher' : undefined} onClick={() => (faltaConformidad ? setConfirmandoSinConformidad(true) : void revisar('validado'))}>Validar pago</Button>
            </>
          )
        ) : <Button variant="secondary" onClick={onClose}>Cerrar</Button>
      }
    >
      {pago && (
        <div className="space-y-5">
          <div className="rounded bg-surface2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="num text-2xl font-semibold">{dinero(monto, pago.moneda)}</p>{pago.mantenimiento && <p className="text-xs text-muted">Mantenimiento completo · {pago.mantenimiento.conceptos} conceptos</p>}</div>
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

          {vistaConf && (
            <section aria-label="Conformidad del tesorero">
              <Alert tone={vistaConf.tipo === 'dada' ? 'ok' : 'warn'}>{textoConformidad(vistaConf, fechaCorta, tesorero)}</Alert>
              {confirmandoSinConformidad && <div className="mt-3"><Alert tone="warn">{TEXTO_VALIDAR_SIN_CONFORMIDAD}</Alert></div>}
            </section>
          )}

          {pago.aviso_multa && !multaQuitada && (
            <section aria-label="Multa por quitar">
              <Alert tone="warn">
                <p>{pago.aviso_multa.texto} <span className="num">({dinero(pago.aviso_multa.monto, pago.moneda)})</span></p>
                {validador
                  ? <Button size="sm" variant="secondary" className="mt-2" onClick={() => setQuitandoMulta(true)}>Quitar la multa</Button>
                  : <p className="mt-1 text-xs">La administración puede quitarla.</p>}
              </Alert>
            </section>
          )}

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
              <ComprobanteVista key={comprobante.created_at} pagoId={pago.id} descripcion={`Comprobante de pago de ${pago.unidad?.codigo ?? 'la unidad'}, ${dinero(monto, pago.moneda)}`} nombre={comprobante.nombre} />
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
              moneda={pago.moneda}
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
    {quitandoMulta && pago?.aviso_multa && (
      <QuitarMultaModal
        reciboId={pago.aviso_multa.recibo_id}
        unidadId={pago.aviso_multa.unidad_id}
        codigo={pago.unidad?.codigo}
        monto={pago.aviso_multa.monto}
        moneda={pago.moneda}
        onClose={() => setQuitandoMulta(false)}
        onQuitada={() => { setMultaQuitada(true); onRevisado(); }}
      />
    )}
    </>
  );
}
