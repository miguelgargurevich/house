import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CameraIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../../api';
import { Button, Input, Modal, Select, Textarea, nombreDelMes, useToast } from '../../../../ui';
import { ACCEPT_COMPROBANTE, ErrorDeEnvio, errorDeArchivo, registrarPagoConVoucher, tamanoLegible } from '../../../shared/comprobantes';
import { esTactil } from '../../../residente/_parts/pago';
import type { CategoriaCentral, CierreCentral } from './tipos';
import { CATEGORIAS_CENTRAL, camposDeCategoria, erroresDeMovimiento } from './vista';

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Props {
  tipo: 'ingreso' | 'egreso';
  cierre: CierreCentral;
  /** Sólo la administración elige el condominio (`?complejo_id`); la Junta central usa el suyo. */
  complejoId: number | null;
  onClose: () => void;
  onHecho: () => void;
}

/** Registra UN ingreso o egreso de la Junta central con su voucher (obligatorio). Un solo envío: el servidor guarda el movimiento y el voucher juntos o nada. Se monta sólo al abrirlo. */
export function RegistrarMovimientoModal({ tipo, cierre, complejoId, onClose, onHecho }: Props) {
  const toast = useToast();
  const camara = useRef<HTMLInputElement>(null);
  const categorias = cierre.categorias[tipo];
  const [categoria, setCategoria] = useState<CategoriaCentral>(categorias[0]!.value);
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [descripcion, setDescripcion] = useState('');
  const [pagador, setPagador] = useState('');
  const [estacionamiento, setEstacionamiento] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [documento, setDocumento] = useState('');
  const [referencia, setReferencia] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>();
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const campos = camposDeCategoria(categoria);
  const ayuda = CATEGORIAS_CENTRAL.find(c => c.value === categoria)?.ayuda;
  const proveedores = useList<{ id: number; razon_social: string }>('/api/proveedores', { pageSize: 100, params: { complejo_id: complejoId ? String(complejoId) : undefined } });

  function elegir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    const err = f ? errorDeArchivo(f) : null;
    setArchivo(err ? null : f); setErrorArchivo(err ?? undefined);
    if (err) e.target.value = '';
  }

  async function enviar() {
    const nuevos = erroresDeMovimiento({ categoria, monto, fecha, descripcion, pagador, estacionamiento, tieneVoucher: !!archivo });
    setErrores(nuevos);
    if (nuevos.voucher) setErrorArchivo(nuevos.voucher);
    if (Object.keys(nuevos).length || !archivo) return;
    setEnviando(true);
    try {
      await registrarPagoConVoucher(`/api/cierres/central/movimientos${complejoId ? `?complejo_id=${complejoId}` : ''}`, {
        categoria, mes: String(cierre.mes), anio: String(cierre.anio), monto: monto.trim(), fecha,
        ...(descripcion.trim() ? { descripcion: descripcion.trim() } : {}),
        ...(campos.pagador && pagador.trim() ? { pagador: pagador.trim() } : {}),
        ...(campos.estacionamiento && estacionamiento.trim() ? { estacionamiento: estacionamiento.trim() } : {}),
        ...(campos.proveedor && proveedorId ? { proveedor_id: proveedorId } : {}),
        ...(campos.documento && documento.trim() ? { documento: documento.trim() } : {}),
        ...(referencia.trim() ? { referencia: referencia.trim() } : {}),
        ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
      }, archivo);
      toast.ok(tipo === 'ingreso' ? 'Ingreso registrado' : 'Egreso registrado');
      onHecho();
    } catch (e) {
      if (e instanceof ErrorDeEnvio && e.campos.voucher) setErrorArchivo(e.message);
      else if (e instanceof ErrorDeEnvio && Object.keys(e.campos).length) setErrores(e.campos);
      else toast.error(e instanceof Error ? e.message : 'No se pudo registrar');
    } finally { setEnviando(false); }
  }

  const FORM = 'form-registrar-movimiento';
  const esIngreso = tipo === 'ingreso';
  return (
    <Modal
      open
      onClose={onClose}
      title={esIngreso ? 'Registrar ingreso' : 'Registrar egreso'}
      description={`Cuenta en el cierre de ${nombreDelMes(cierre.mes)} de ${cierre.anio}.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form={FORM} loading={enviando} disabled={!archivo || enviando}>{esIngreso ? 'Registrar ingreso' : 'Registrar egreso'}</Button></>}
    >
      <form id={FORM} onSubmit={e => { e.preventDefault(); void enviar(); }} noValidate className="grid gap-4">
        <Select label="Categoría" value={categoria} hint={ayuda} onChange={e => { setCategoria(e.target.value as CategoriaCentral); setErrores({}); }}>
          {categorias.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
        {campos.pagador && <Input label={categoria === 'alquiler_estacionamiento' ? 'Quién paga (vecino o externo)' : 'De quién (opcional)'} autoComplete="off" required={categoria === 'alquiler_estacionamiento'} hint={categoria === 'alquiler_estacionamiento' ? 'Nombre y, si es vecino, su departamento.' : undefined} error={errores.pagador} value={pagador} onChange={e => setPagador(e.target.value)} />}
        {campos.estacionamiento && <Input label="Estacionamiento" autoComplete="off" required placeholder="Ej.: E-12" error={errores.estacionamiento} value={estacionamiento} onChange={e => setEstacionamiento(e.target.value)} />}
        {campos.proveedor && proveedores.items.length > 0 && (
          <Select label="Proveedor (opcional)" value={proveedorId} onChange={e => setProveedorId(e.target.value)}>
            <option value="">Sin elegir</option>
            {proveedores.items.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </Select>
        )}
        {campos.descripcion && <Input label="Detalle" autoComplete="off" required error={errores.descripcion} value={descripcion} onChange={e => setDescripcion(e.target.value)} />}
        {campos.documento && <Input label={categoria === 'servicio' ? 'N.º de la boleta (opcional)' : 'N.º de la factura (opcional)'} autoComplete="off" value={documento} onChange={e => setDocumento(e.target.value)} />}
        <Input label="Monto" inputMode="decimal" autoComplete="off" required aria-required="true" error={errores.monto} value={monto} onChange={e => setMonto(e.target.value)} />
        <Input label={esIngreso ? 'Fecha del cobro' : 'Fecha del pago'} type="date" required aria-required="true" max={hoyISO()} error={errores.fecha} value={fecha} onChange={e => setFecha(e.target.value)} />
        <Input label="N.º de operación (opcional)" autoComplete="off" value={referencia} onChange={e => setReferencia(e.target.value)} />
        <div>
          <Input
            label="Voucher (foto o PDF)" type="file" accept={ACCEPT_COMPROBANTE} required aria-required="true"
            hint={esIngreso ? 'Obligatorio: el comprobante del depósito o la transferencia. Hasta 2 MB.' : 'Obligatorio: el comprobante del pago (y guarda la boleta o la factura). Hasta 2 MB.'} error={errorArchivo} onChange={elegir} className="[&_input]:h-auto [&_input]:py-2"
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
      </form>
    </Modal>
  );
}
