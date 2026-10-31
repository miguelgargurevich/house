import { useState } from 'react';
import { ArrowTopRightOnSquareIcon, BanknotesIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { api, errorText, useResource } from '../../../../api';
import { Alert, Badge, Button, Card, CardBody, ConfirmDialog, ErrorState, Skeleton, StatStrip, dinero, fechaCorta, nombreDelMes, useToast } from '../../../../ui';
import type { CierreBlock, LineaCierre } from './tipos';
import { QUIEN_CONFIRMA, detalleRegistro, estadoLinea, etiquetaDestino, ESTADO_CIERRE, puedeQuitarPago, puedeRegistrarLinea, textoCuenta } from './vista';
import { abrirVoucher } from './voucher';
import { RegistrarLineaModal } from './RegistrarLineaModal';
import { Bloqueable } from '../../../../app/Bloqueable';

function Monto({ etiqueta, valor, moneda, destacado }: { etiqueta: string; valor: string; moneda: string; destacado?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{etiqueta}</dt>
      <dd className={`num break-words ${destacado ? 'text-lg font-semibold' : 'text-sm font-medium'}`}>{dinero(valor, moneda)}</dd>
    </div>
  );
}

interface LineaProps {
  l: LineaCierre;
  cierre: CierreBlock;
  ocupado: boolean;
  onRegistrar: () => void;
  onVoucher: (egresoId: number) => void;
  onQuitar: () => void;
  onConformidad: (dar: boolean) => void;
}

function TarjetaLinea({ l, cierre, ocupado, onRegistrar, onVoucher, onQuitar, onConformidad }: LineaProps) {
  const est = estadoLinea(l);
  const r = l.registro;
  const cuenta = l.proveedor ? textoCuenta(l.proveedor.cuenta) : '';
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold">{l.nombre}</h3>
          <p className="break-words text-sm text-muted">{etiquetaDestino(l.destino)}{l.proveedor ? ` · ${l.proveedor.razon_social}` : ''}</p>
        </div>
        <Badge tone={l.obsoleta ? 'neutral' : est.tone}>{l.obsoleta ? 'Línea anterior' : est.label}</Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Monto etiqueta="Facturado a los vecinos" valor={l.facturado} moneda={cierre.moneda} />
        <Monto etiqueta="Cobrado (validado)" valor={l.cobrado} moneda={cierre.moneda} />
        {r && <Monto etiqueta={l.destino === 'servicio' || l.destino === 'proveedor' ? 'Pagado (boleta o factura)' : 'Pagado'} valor={r.monto_pagado} moneda={cierre.moneda} destacado />}
      </dl>

      {l.detalle.length > 1 && (
        <p className="mt-2 break-words text-xs text-muted">Incluye: {l.detalle.map(d => `${d.nombre} (${dinero(d.facturado, cierre.moneda)})`).join(', ')}</p>
      )}
      {!r && cuenta && <p className="mt-2 break-words text-xs text-muted">Cuenta de {l.proveedor?.razon_social}: <span className="num">{cuenta}</span></p>}

      {r && (
        <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <p className="break-words text-muted">{detalleRegistro(r, fechaCorta)}</p>
          {r.observaciones && <p className="break-words text-muted">{r.observaciones}</p>}
          {l.lleva_conformidad && (
            <p className={r.conformidad ? 'text-ok' : 'text-muted'}>
              {r.conformidad
                ? <><CheckCircleIcon className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />Conformidad de {r.conformidad.por?.nombre ?? 'la administración'} · {fechaCorta(r.conformidad.at)}</>
                : `Falta la conformidad de ${QUIEN_CONFIRMA[l.destino] ?? 'quien recibe'}: confirma que el dinero llegó a la cuenta.`}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {puedeRegistrarLinea(cierre.puede.registrar, l) && <Bloqueable>{b => <Button size="sm" icon={<BanknotesIcon className="h-4 w-4" />} disabled={b} onClick={onRegistrar}>Registrar pago</Button>}</Bloqueable>}
        {r?.voucher && <Button size="sm" variant="secondary" icon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />} onClick={() => onVoucher(r.id)}>Ver voucher</Button>}
        {r && l.puede_conformidad && (r.conformidad
          ? <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => onConformidad(false)}>Quitar conformidad</Button>
          : <Button size="sm" disabled={ocupado} onClick={() => onConformidad(true)}>Confirmo que llegó a la cuenta</Button>)}
        {puedeQuitarPago(cierre.puede.registrar, l) && <Button size="sm" variant="ghost" disabled={ocupado} onClick={onQuitar}>Quitar pago</Button>}
      </div>
    </li>
  );
}

interface Props { estructuraId: number; mes: number; anio: number; esAdmin: boolean; onCambio?: () => void }

/**
 * El cierre de UN block en un mes: lo facturado y lo cobrado, cada línea por pagar (con su voucher y su conformidad) y el Fondo de ahorros.
 * Lo que cada quien puede hacer lo decide el servidor (`puede.registrar`, `puede_conformidad`): aquí sólo se ofrece.
 */
export function DetalleCierre({ estructuraId, mes, anio, esAdmin, onCambio }: Props) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<CierreBlock>(`/api/cierres/block/${estructuraId}?mes=${mes}&anio=${anio}`);
  const [registrando, setRegistrando] = useState<LineaCierre | null>(null);
  const [quitando, setQuitando] = useState<LineaCierre | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recargar = () => { void reload(); onCambio?.(); };

  async function quitar() {
    if (!quitando?.registro) return;
    setOcupado(true);
    try {
      await api(`/api/cierres/lineas/${quitando.registro.id}`, { method: 'DELETE' });
      toast.ok('Pago quitado');
      setQuitando(null);
      recargar();
    } catch (e) { toast.error(errorText(e)); } finally { setOcupado(false); }
  }

  async function conformidad(l: LineaCierre, dar: boolean) {
    if (!l.registro) return;
    setOcupado(true);
    try {
      await api(`/api/cierres/lineas/${l.registro.id}/conformidad`, { method: dar ? 'PUT' : 'DELETE' });
      toast.ok(dar ? 'Conformidad registrada' : 'Conformidad quitada');
      recargar();
    } catch (e) { toast.error(errorText(e)); } finally { setOcupado(false); }
  }

  if (loading && !data) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (error || !data) return <ErrorState message={error ?? 'No se pudo cargar el cierre'} onRetry={() => void reload()} />;
  const c = data;
  const est = ESTADO_CIERRE[c.estado];
  const periodo = `${nombreDelMes(c.mes)} de ${c.anio}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{c.estructura.nombre ?? 'Block'} · {periodo}</h2>
        <Badge tone={est.tone}>{est.label}</Badge>
      </div>

      {!c.hay_recibo ? (
        <Alert tone="info">Este block no tiene recibo de {periodo}: no hay nada que cerrar.</Alert>
      ) : (
        <>
          {c.sin_clasificar.length > 0 && (
            <Alert tone="warn">
              Hay conceptos del recibo sin destino ({c.sin_clasificar.map(x => x.nombre).join(', ')}): no entran al cierre hasta que la administración los clasifique en{' '}
              {esAdmin ? <Link to="/admin/conceptos" className="font-medium underline">Conceptos</Link> : 'Conceptos'}.
            </Alert>
          )}

          <StatStrip stats={[
            { label: 'Facturado a los vecinos', value: dinero(c.facturado_total, c.moneda) },
            { label: 'Cobrado (validado)', value: dinero(c.cobrado_total, c.moneda) },
            { label: 'Pagado por la junta', value: dinero(c.pagado_total, c.moneda), hint: `${c.lineas_pagadas} de ${c.lineas_total} líneas` },
          ]} />

          {c.lineas.length === 0
            ? <Alert tone="info">Este mes no tiene líneas por pagar.</Alert>
            : (
              <ul className="grid gap-3" aria-label="Líneas del cierre">
                {c.lineas.map(l => (
                  <TarjetaLinea
                    key={l.linea} l={l} cierre={c} ocupado={ocupado}
                    onRegistrar={() => setRegistrando(l)} onVoucher={id => void abrirVoucher(id).catch(e => toast.error(errorText(e)))} onQuitar={() => setQuitando(l)} onConformidad={dar => void conformidad(l, dar)}
                  />
                ))}
              </ul>
            )}

          <Card>
            <CardBody>
              <h3 className="text-base font-semibold">Fondo de ahorros del block</h3>
              <p className="mt-1 text-sm text-muted">Lo que no se paga a nadie y se queda en la cuenta del block: las multas, el fondo de contingencia del block y lo que sobra del mes. Suma sólo los meses con todos sus pagos registrados.</p>
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Monto etiqueta="De multas y contingencia" valor={c.ahorro_mes} moneda={c.moneda} />
                <Monto etiqueta="Sobrante del mes" valor={c.sobrante_mes} moneda={c.moneda} />
                <Monto etiqueta="Fondo de ahorros acumulado" valor={c.fondo_ahorros} moneda={c.moneda} destacado />
              </dl>
              {c.ahorro.conceptos.length > 0 && (
                <p className="mt-2 break-words text-xs text-muted">Facturado a los vecinos para el fondo: {c.ahorro.conceptos.map(x => `${x.nombre} (${dinero(x.facturado, c.moneda)})`).join(', ')}.</p>
              )}
              {!c.registrado_completo && <p className="mt-2 text-xs text-muted">Este mes aún no cuenta en el acumulado: faltan pagos por registrar o conceptos por clasificar.</p>}
            </CardBody>
          </Card>
        </>
      )}

      <RegistrarLineaModal cierre={c} linea={registrando} onClose={() => setRegistrando(null)} onHecho={() => { setRegistrando(null); recargar(); }} />
      <ConfirmDialog
        open={!!quitando} onClose={() => setQuitando(null)} onConfirm={quitar} loading={ocupado} danger
        title="Quitar pago" message={`Se quitará el pago registrado de «${quitando?.nombre ?? ''}» y su voucher. Podrás registrarlo de nuevo.`} confirmLabel="Quitar pago"
      />
    </div>
  );
}
