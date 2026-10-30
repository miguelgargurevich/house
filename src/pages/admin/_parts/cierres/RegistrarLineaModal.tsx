import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CameraIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Input, Modal, Textarea, dinero, useToast } from '../../../../ui';
import { ACCEPT_COMPROBANTE, ErrorDeEnvio, errorDeArchivo, registrarPagoConVoucher, tamanoLegible } from '../../../shared/comprobantes';
import { esTactil } from '../../../residente/_parts/pago';
import type { CierreBlock, LineaCierre } from './tipos';
import { etiquetaDestino, montoSugerido, textoCuenta } from './vista';

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Adónde se paga esta línea, con los datos de la cuenta que haya cargados. */
function Destinatario({ cierre, linea }: { cierre: CierreBlock; linea: LineaCierre }) {
  if (linea.destino === 'administradora') {
    const c = cierre.cuentas.administradora;
    return <CuentaInfo titulo={`Se paga a la empresa administradora${c?.empresa ? ` (${c.empresa})` : ''}`} texto={textoCuenta(c)} falta="La administración aún no cargó la cuenta de la empresa: pídesela." />;
  }
  if (linea.destino === 'central') {
    const cuentas = cierre.cuentas.central.map(m => textoCuenta({ banco: m.banco_otro ?? m.banco, tipo: m.tipo_cuenta, numero: m.numero_cuenta, cci: m.cci, titular: m.titular })).filter(Boolean);
    return <CuentaInfo titulo="Se transfiere a la cuenta de la Junta central" texto={cuentas.join(' | ')} falta="La Junta central aún no tiene una cuenta cargada en Medios de pago." />;
  }
  if (linea.destino === 'proveedor') {
    const p = linea.proveedor;
    return <CuentaInfo titulo={`Se paga a ${p?.razon_social ?? 'el proveedor'}`} texto={textoCuenta(p?.cuenta)} falta={p ? 'La administración aún no cargó la cuenta de este proveedor.' : 'Este concepto no tiene proveedor asignado: la administración debe elegirlo en Conceptos.'} />;
  }
  return <p className="text-sm text-muted">Se paga con la boleta del servicio: escribe el monto que dice la boleta.</p>;
}

function CuentaInfo({ titulo, texto, falta }: { titulo: string; texto: string; falta: string }) {
  return (
    <div className="rounded border border-line bg-surface2 px-4 py-3 text-sm">
      <p className="font-medium">{titulo}</p>
      {texto ? <p className="mt-1 break-words num">{texto}</p> : <p className="mt-1 text-muted">{falta}</p>}
    </div>
  );
}

interface Props { cierre: CierreBlock; linea: LineaCierre | null; onClose: () => void; onHecho: () => void }

/** Registra el pago de UNA línea del cierre: monto, fecha, referencia y el voucher (obligatorio). Un solo envío: el servidor guarda el pago y el voucher juntos o nada. */
export function RegistrarLineaModal({ cierre, linea, onClose, onHecho }: Props) {
  const toast = useToast();
  const camara = useRef<HTMLInputElement>(null);
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [referencia, setReferencia] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>();
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!linea) return;
    setMonto(montoSugerido(linea)); setFecha(hoyISO()); setReferencia(''); setObservaciones('');
    setArchivo(null); setErrorArchivo(undefined); setErrores({}); setEnviando(false);
  }, [linea]);

  function elegir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    const err = f ? errorDeArchivo(f) : null;
    setArchivo(err ? null : f); setErrorArchivo(err ?? undefined);
    if (err) e.target.value = '';
  }

  async function enviar() {
    if (!linea) return;
    const nuevos: Record<string, string> = {};
    if (!archivo) nuevos.voucher = 'Adjunta el voucher del pago.';
    if (!/^\d+(\.\d{1,2})?$/.test(monto.trim())) nuevos.monto = 'Escribe el monto con hasta 2 decimales.';
    if (!fecha) nuevos.fecha = 'Elige la fecha del pago.';
    setErrores(nuevos);
    if (Object.keys(nuevos).length || !archivo) { if (nuevos.voucher) setErrorArchivo(nuevos.voucher); return; }
    setEnviando(true);
    try {
      await registrarPagoConVoucher(`/api/cierres/block/${cierre.estructura.id}/lineas`, {
        mes: String(cierre.mes), anio: String(cierre.anio), linea: linea.linea, monto_pagado: monto.trim(), fecha_pago: fecha,
        ...(referencia.trim() ? { referencia: referencia.trim() } : {}), ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
      }, archivo);
      toast.ok('Pago registrado');
      onHecho();
    } catch (e) {
      if (e instanceof ErrorDeEnvio && e.campos.voucher) setErrorArchivo(e.message);
      else if (e instanceof ErrorDeEnvio && Object.keys(e.campos).length) setErrores({ ...(e.campos.monto_pagado ? { monto: e.campos.monto_pagado } : {}), ...(e.campos.fecha_pago ? { fecha: e.campos.fecha_pago } : {}) });
      else toast.error(e instanceof Error ? e.message : 'No se pudo registrar el pago');
    } finally { setEnviando(false); }
  }

  const FORM = 'form-registrar-linea';
  return (
    <Modal
      open={linea !== null}
      onClose={onClose}
      title="Registrar pago"
      description={linea ? `${linea.nombre} · ${etiquetaDestino(linea.destino)}` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form={FORM} loading={enviando} disabled={!archivo || enviando}>Registrar pago</Button></>}
    >
      {linea && (
        <form id={FORM} onSubmit={e => { e.preventDefault(); void enviar(); }} noValidate className="grid gap-4">
          <div className="rounded border border-line bg-surface2 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-muted">Facturado a los vecinos</p>
              <p className="num text-xl font-semibold">{dinero(linea.facturado, cierre.moneda)}</p>
            </div>
          </div>
          <Destinatario cierre={cierre} linea={linea} />
          <Input
            label={linea.destino === 'servicio' || linea.destino === 'proveedor' ? 'Monto de la boleta o factura' : 'Monto transferido'}
            inputMode="decimal" autoComplete="off" required aria-required="true"
            hint={linea.destino === 'servicio' || linea.destino === 'proveedor' ? 'El que dice la boleta o la factura, aunque sea distinto de lo facturado.' : 'Por defecto, lo facturado.'}
            error={errores.monto} value={monto} onChange={e => setMonto(e.target.value)}
          />
          <Input label="Fecha del pago" type="date" required aria-required="true" max={hoyISO()} error={errores.fecha} value={fecha} onChange={e => setFecha(e.target.value)} />
          <Input label="N.º de operación o de comprobante (opcional)" autoComplete="off" value={referencia} onChange={e => setReferencia(e.target.value)} />
          <div>
            <Input
              label="Voucher (foto o PDF)" type="file" accept={ACCEPT_COMPROBANTE} required aria-required="true"
              hint="Obligatorio. Hasta 2 MB." error={errorArchivo} onChange={elegir} className="[&_input]:h-auto [&_input]:py-2"
            />
            {esTactil() && (
              <div className="mt-2">
                <Button size="sm" variant="secondary" icon={<CameraIcon className="h-4 w-4" />} onClick={() => camara.current?.click()}>Tomar foto con la cámara</Button>
                <input ref={camara} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={elegir} className="sr-only" tabIndex={-1} aria-label="Tomar una foto del voucher" />
              </div>
            )}
            {archivo && <p className="mt-2 truncate rounded bg-surface2 px-3 py-2 text-sm">{archivo.name} · <span className="num text-muted">{tamanoLegible(archivo.size)}</span></p>}
          </div>
          <Textarea label="Observaciones (opcional)" value={observaciones} onChange={e => setObservaciones(e.target.value)} />
          {linea.destino === 'servicio' && <Alert tone="info">Guarda la boleta: es el respaldo de este pago.</Alert>}
        </form>
      )}
    </Modal>
  );
}
